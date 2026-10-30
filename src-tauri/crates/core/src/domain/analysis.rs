//! Pure version analysis: freshness, impact and cycles.
//!
//! Everything computes from immutable views; there are no stored flags
//! that could contradict the dependencies. Recalculating never mutates.

use crate::domain::{ArtifactId, VersionId};

/// Minimal version view for dependency analysis.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VersionView {
    pub id: VersionId,
    pub artifact: ArtifactId,
    pub sources: Vec<VersionId>,
    pub is_current: bool,
}

/// Computed version freshness: it is fresh when all its exact sources
/// are still their artifacts current ones.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Validity {
    pub version: VersionId,
    pub valid: bool,
    pub stale_sources: Vec<VersionId>,
}

impl Validity {
    pub fn of(view: &VersionView, all: &[VersionView]) -> Self {
        let stale_sources = stale_sources(view, all);
        Self {
            version: view.id.clone(),
            valid: stale_sources.is_empty(),
            stale_sources,
        }
    }
}

/// Version sources that are no longer current. An unknown source counts
/// as stale out of caution (it cannot be proven current).
pub fn stale_sources(view: &VersionView, all: &[VersionView]) -> Vec<VersionId> {
    view.sources
        .iter()
        .filter(|source| {
            let Some(source_artifact) = all.iter().find(|v| &v.id == *source).map(|v| &v.artifact)
            else {
                return true;
            };
            let Some(current) = all
                .iter()
                .find(|v| &v.artifact == source_artifact && v.is_current)
            else {
                return true;
            };
            &current.id != *source
        })
        .cloned()
        .collect()
}

pub fn version_is_valid(view: &VersionView, all: &[VersionView]) -> bool {
    stale_sources(view, all).is_empty()
}

/// Artifact affected by a change, with the paths justifying it. Each
/// path runs from a changed artifact to the affected one, both included.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactedArtifact {
    pub artifact: ArtifactId,
    pub paths: Vec<Vec<ArtifactId>>,
}

/// Impact report: affected artifacts and explanatory paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImpactReport {
    pub changed: Vec<ArtifactId>,
    pub affected: Vec<ImpactedArtifact>,
}

/// Computes direct and indirect derivatives needing review when
/// artifacts change. Impact flows through current derivations: when B
/// derives from A and C derives from B, a change in A affects B and C
/// even when C pin still points at B current version.
pub fn compute_impact(changed: &[ArtifactId], all: &[VersionView]) -> ImpactReport {
    let mut roots: Vec<&ArtifactId> = changed.iter().collect();
    roots.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    roots.dedup();

    // Dependent → source edges between artifacts, from current versions.
    let mut edges: Vec<(&ArtifactId, &ArtifactId)> = Vec::new();
    for view in all.iter().filter(|v| v.is_current) {
        for source in &view.sources {
            if let Some(source_artifact) = all.iter().find(|v| &v.id == source).map(|v| &v.artifact)
            {
                if !edges.contains(&(&view.artifact, source_artifact)) {
                    edges.push((&view.artifact, source_artifact));
                }
            }
        }
    }

    // Source → dependents adjacency, ordered for determinism.
    let mut next: Vec<(&ArtifactId, Vec<&ArtifactId>)> = Vec::new();
    for (dependent, source) in &edges {
        match next.iter_mut().find(|(s, _)| s == source) {
            Some((_, dependents)) => dependents.push(*dependent),
            None => next.push((*source, vec![*dependent])),
        }
    }
    for (_, dependents) in &mut next {
        dependents.sort_by(|a, b| a.as_str().cmp(b.as_str()));
        dependents.dedup();
    }
    let successors = |node: &ArtifactId| -> Vec<&ArtifactId> {
        next.iter()
            .find(|(s, _)| *s == node)
            .map(|(_, d)| d.clone())
            .unwrap_or_default()
    };

    // Reachable (affected) nodes, excluding the changed roots.
    let is_root = |node: &ArtifactId| roots.contains(&node);
    let mut affected: Vec<&ArtifactId> = Vec::new();
    let mut stack: Vec<&ArtifactId> = roots.clone();
    let mut seen: Vec<&ArtifactId> = roots.clone();
    while let Some(node) = stack.pop() {
        for dep in successors(node) {
            if !seen.contains(&dep) {
                seen.push(dep);
                stack.push(dep);
                if !is_root(dep) {
                    affected.push(dep);
                }
            }
        }
    }
    affected.sort_by(|a, b| a.as_str().cmp(b.as_str()));

    // Simple paths from each root to each affected node.
    let mut paths_of: Vec<(&ArtifactId, Vec<Vec<ArtifactId>>)> =
        affected.iter().map(|a| (*a, Vec::new())).collect();
    for root in &roots {
        let mut path: Vec<&ArtifactId> = vec![root];
        let mut stack: Vec<(usize, Vec<&ArtifactId>)> = vec![(0, successors(root))];
        while let Some((index, siblings)) = stack.last_mut() {
            if *index >= siblings.len() {
                stack.pop();
                path.pop();
                continue;
            }
            let node = siblings[*index];
            *index += 1;
            if path.contains(&node) {
                continue;
            }
            path.push(node);
            if !is_root(node) {
                if let Some((_, paths)) = paths_of.iter_mut().find(|(a, _)| *a == node) {
                    paths.push(path.iter().map(|id| (*id).clone()).collect());
                }
            }
            stack.push((0, successors(node)));
        }
    }

    ImpactReport {
        changed: changed.to_vec(),
        affected: paths_of
            .into_iter()
            .map(|(artifact, paths)| ImpactedArtifact {
                artifact: artifact.clone(),
                paths,
            })
            .collect(),
    }
}

/// Cycle path that adding a version with those sources would create, or
/// `None` when the graph stays acyclic. Since versions are immutable and
/// sources must exist, the only reachable cycle is self-reference.
pub fn dependency_cycle(
    new_id: &VersionId,
    sources: &[VersionId],
    all: &[VersionView],
) -> Option<Vec<VersionId>> {
    for source in sources {
        if source == new_id {
            return Some(vec![new_id.clone(), new_id.clone()]);
        }
        if let Some(mut path) = path_to(source, new_id, all, &mut Vec::new()) {
            let mut cycle = vec![new_id.clone()];
            cycle.append(&mut path);
            return Some(cycle);
        }
    }
    None
}

fn path_to(
    from: &VersionId,
    to: &VersionId,
    all: &[VersionView],
    visited: &mut Vec<VersionId>,
) -> Option<Vec<VersionId>> {
    if from == to {
        return Some(vec![to.clone()]);
    }
    if visited.contains(from) {
        return None;
    }
    visited.push(from.clone());
    let view = all.iter().find(|v| &v.id == from)?;
    for source in &view.sources {
        if let Some(mut path) = path_to(source, to, all, visited) {
            let mut full = vec![from.clone()];
            full.append(&mut path);
            return Some(full);
        }
    }
    None
}

/// Searches for a cycle in the full dependency graph. Returns a
/// closed path (`[a, b, a]`) when one exists, or `None` when acyclic.
/// Used when reconstituting persisted state, which could be tampered.
pub fn find_cycle(all: &[VersionView]) -> Option<Vec<VersionId>> {
    use std::collections::HashMap;
    fn successors<'a>(id: &VersionId, all: &'a [VersionView]) -> &'a [VersionId] {
        all.iter()
            .find(|v| &v.id == id)
            .map(|v| v.sources.as_slice())
            .unwrap_or(&[])
    }
    // 0 = unvisited, 1 = on path, 2 = done.
    let mut state: HashMap<&VersionId, u8> = all.iter().map(|v| (&v.id, 0)).collect();
    for root in all {
        if state[&root.id] != 0 {
            continue;
        }
        let mut path: Vec<&VersionId> = vec![&root.id];
        let mut indexes: Vec<usize> = vec![0];
        state.insert(&root.id, 1);
        while let Some(top) = path.last().copied() {
            let index = indexes.last_mut().expect("path and indexes go together");
            let succs = successors(top, all);
            if *index >= succs.len() {
                state.insert(top, 2);
                path.pop();
                indexes.pop();
                continue;
            }
            let next = &succs[*index];
            *index += 1;
            match state.get(next).copied().unwrap_or(2) {
                1 => {
                    let start = path
                        .iter()
                        .position(|n| *n == next)
                        .expect("gray is on the path");
                    let mut cycle: Vec<VersionId> =
                        path[start..].iter().map(|n| (*n).clone()).collect();
                    cycle.push(next.clone());
                    return Some(cycle);
                }
                0 => {
                    state.insert(next, 1);
                    path.push(next);
                    indexes.push(0);
                }
                _ => {}
            }
        }
    }
    None
}

/// Validates duplicate sources within one version.
pub fn duplicate_source(sources: &[VersionId]) -> Option<VersionId> {
    let mut seen = Vec::new();
    for source in sources {
        if seen.contains(source) {
            return Some(source.clone());
        }
        seen.push(source.clone());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(id: &str, artifact: &str, sources: &[&str], is_current: bool) -> VersionView {
        VersionView {
            id: VersionId::new(id).expect("id"),
            artifact: ArtifactId::new(artifact).expect("id"),
            sources: sources
                .iter()
                .map(|s| VersionId::new(*s).expect("id"))
                .collect(),
            is_current,
        }
    }

    #[test]
    fn fresh_pins_are_valid() {
        let all = vec![
            view("req1", "req", &[], false),
            view("req2", "req", &[], true),
            view("flow1", "flow", &["req2"], true),
        ];
        let validity = Validity::of(&all[2], &all);
        assert!(validity.valid);
        assert!(validity.stale_sources.is_empty());
    }

    #[test]
    fn old_pins_are_stale() {
        let all = vec![
            view("req1", "req", &[], false),
            view("req2", "req", &[], true),
            view("flow1", "flow", &["req1"], true),
        ];
        let validity = Validity::of(&all[2], &all);
        assert!(!validity.valid);
        assert_eq!(
            validity.stale_sources,
            vec![VersionId::new("req1").expect("id")]
        );
    }

    #[test]
    fn version_without_sources_is_valid() {
        let all = vec![view("req1", "req", &[], true)];
        assert!(version_is_valid(&all[0], &all));
    }

    #[test]
    fn impact_is_transitive_with_paths() {
        let all = vec![
            view("req2", "req", &[], true),
            view("flow1", "flow", &["req2"], true),
            view("data1", "data", &["flow1"], true),
        ];
        let changed = vec![ArtifactId::new("req").expect("id")];
        let report = compute_impact(&changed, &all);
        assert_eq!(report.changed, changed);
        let names: Vec<&str> = report
            .affected
            .iter()
            .map(|a| a.artifact.as_str())
            .collect();
        assert_eq!(names, vec!["data", "flow"]);
        let flow = report
            .affected
            .iter()
            .find(|a| a.artifact.as_str() == "flow")
            .expect("flow");
        assert_eq!(flow.paths.len(), 1);
        let data = report
            .affected
            .iter()
            .find(|a| a.artifact.as_str() == "data")
            .expect("data");
        assert_eq!(data.paths.len(), 1);
        let path: Vec<&str> = data.paths[0].iter().map(|a| a.as_str()).collect();
        assert_eq!(path, vec!["req", "flow", "data"]);
    }

    #[test]
    fn diamond_collects_every_path() {
        let all = vec![
            view("a1", "a", &[], true),
            view("b1", "b", &["a1"], true),
            view("c1", "c", &["a1"], true),
            view("d1", "d", &["b1", "c1"], true),
        ];
        let changed = vec![ArtifactId::new("a").expect("id")];
        let report = compute_impact(&changed, &all);
        let d = report
            .affected
            .iter()
            .find(|a| a.artifact.as_str() == "d")
            .expect("d");
        assert_eq!(d.paths.len(), 2);
    }

    #[test]
    fn self_dependency_is_a_cycle() {
        let all = vec![view("req1", "req", &[], true)];
        let new_id = VersionId::new("flow1").expect("id");
        let sources = vec![VersionId::new("flow1").expect("id")];
        let cycle = dependency_cycle(&new_id, &sources, &all).expect("cycle");
        assert_eq!(cycle, vec![new_id.clone(), new_id]);
    }

    #[test]
    fn detects_longer_cycle_at_pure_level() {
        let all = vec![view("x1", "x", &["y1"], true), view("y1", "y", &[], true)];
        let new_id = VersionId::new("y1").expect("id");
        let sources = vec![VersionId::new("x1").expect("id")];
        assert!(dependency_cycle(&new_id, &sources, &all).is_some());
    }

    #[test]
    fn acyclic_sources_have_no_cycle() {
        let all = vec![view("req1", "req", &[], true)];
        let new_id = VersionId::new("flow1").expect("id");
        let sources = vec![VersionId::new("req1").expect("id")];
        assert_eq!(dependency_cycle(&new_id, &sources, &all), None);
    }

    #[test]
    fn acyclic_graph_has_no_cycle() {
        let all = vec![
            view("a1", "a", &[], true),
            view("b1", "b", &["a1"], true),
            view("c1", "c", &["a1", "b1"], true),
        ];
        assert_eq!(find_cycle(&all), None);
    }

    #[test]
    fn finds_closed_cycle_path() {
        let all = vec![
            view("a1", "a", &["c1"], true),
            view("b1", "b", &["a1"], true),
            view("c1", "c", &["b1"], true),
        ];
        let cycle = find_cycle(&all).expect("cycle");
        assert!(cycle.len() >= 2);
        assert_eq!(cycle.first(), cycle.last());
    }

    #[test]
    fn finds_duplicate_source() {
        let a = VersionId::new("a1").expect("id");
        assert_eq!(duplicate_source(&[a.clone(), a.clone()]), Some(a.clone()));
        let b = VersionId::new("b1").expect("id");
        assert_eq!(duplicate_source(&[a, b]), None);
    }
}
