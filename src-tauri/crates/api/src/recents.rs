//! Saved workspaces (recents): validation and pure list updates.
//!
//! Touch matches by id when reopening a known entry, otherwise by
//! identical root-path set, so restoring the same folders never
//! duplicates the list. References only: labels, project ids and
//! paths; file contents are never stored here.

use ruth_store::{StoredRecent, MAX_RECENT_WORKSPACES};

use crate::error::ApiError;

/// Longest accepted workspace label (chars, trimmed).
pub const MAX_RECENT_LABEL_CHARS: usize = 120;
/// Most root paths kept per entry.
pub const MAX_RECENT_PATHS: usize = 32;
/// Longest accepted single path (chars, trimmed).
pub const MAX_RECENT_PATH_CHARS: usize = 1024;

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::coded("recent_invalid", message)
}

/// Validated touch payload: trimmed label, deduplicated paths.
pub struct RecentTouch {
    pub label: String,
    pub project_id: Option<String>,
    pub root_paths: Vec<String>,
}

/// Validates a touch request. Empty paths are allowed (a project
/// without code yet); empty labels and oversized payloads are not.
pub fn validate_touch(
    label: &str,
    project_id: Option<String>,
    root_paths: Vec<String>,
) -> Result<RecentTouch, ApiError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(invalid("the workspace needs a label"));
    }
    if label.chars().count() > MAX_RECENT_LABEL_CHARS {
        return Err(invalid("the label is too long"));
    }
    let mut paths = Vec::new();
    for raw in root_paths {
        let path = raw.trim().to_string();
        if path.is_empty() {
            continue;
        }
        if path.chars().count() > MAX_RECENT_PATH_CHARS {
            return Err(invalid("a root path is too long"));
        }
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    if paths.len() > MAX_RECENT_PATHS {
        return Err(invalid("too many root paths"));
    }
    Ok(RecentTouch {
        label: label.to_string(),
        project_id: project_id
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty()),
        root_paths: paths,
    })
}

fn path_set(paths: &[String]) -> Vec<String> {
    let mut sorted = paths.to_vec();
    sorted.sort();
    sorted
}

/// Applies a touch to the list: same id wins, then same project,
/// then same non-empty path set reuses the entry (keeping id and
/// creation time); anything else is appended. A project keeps one
/// entry, so its other entries are dropped: a stale one would
/// restore folders the person removed. Sorted by last_opened,
/// newest first, pruned to the kept cap. Two entries never match
/// by path set when the set is empty, so folder-less projects
/// keep separate entries.
pub fn apply_touch(recents: &[StoredRecent], entry: StoredRecent) -> Vec<StoredRecent> {
    let same_project =
        |recent: &StoredRecent| entry.project_id.is_some() && recent.project_id == entry.project_id;
    let same_paths = |recent: &StoredRecent| {
        !entry.root_paths.is_empty() && path_set(&recent.root_paths) == path_set(&entry.root_paths)
    };
    let target = recents
        .iter()
        .position(|recent| recent.id == entry.id)
        .or_else(|| recents.iter().position(same_project))
        .or_else(|| recents.iter().position(same_paths));
    let mut next: Vec<StoredRecent> = Vec::with_capacity(recents.len() + 1);
    for (index, recent) in recents.iter().enumerate() {
        if Some(index) == target {
            next.push(StoredRecent {
                id: recent.id.clone(),
                created_at: recent.created_at.clone(),
                ..entry.clone()
            });
        } else if !same_project(recent) {
            next.push(recent.clone());
        }
    }
    if target.is_none() {
        next.push(entry);
    }
    next.sort_by(|a, b| {
        b.last_opened
            .cmp(&a.last_opened)
            .then_with(|| b.id.cmp(&a.id))
    });
    next.truncate(MAX_RECENT_WORKSPACES);
    next
}

/// Removes one entry by id. Unknown ids are a no-op, never an error.
pub fn apply_remove(recents: &[StoredRecent], id: &str) -> Vec<StoredRecent> {
    recents
        .iter()
        .filter(|recent| recent.id != id)
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, paths: &[&str], opened: &str) -> StoredRecent {
        StoredRecent {
            id: id.to_string(),
            label: format!("label-{id}"),
            project_id: None,
            root_paths: paths.iter().map(|p| p.to_string()).collect(),
            last_opened: opened.to_string(),
            created_at: "2026-10-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn touch_validates_and_dedupes() {
        let touch = validate_touch(
            "  Shop  ",
            Some("proy-1".to_string()),
            vec![
                "/b".to_string(),
                "/a".to_string(),
                "/b".to_string(),
                " ".to_string(),
            ],
        )
        .expect("valid");
        assert_eq!(touch.label, "Shop");
        assert_eq!(touch.root_paths, vec!["/b".to_string(), "/a".to_string()]);
        assert!(validate_touch("  ", None, vec![]).is_err());
        assert!(validate_touch(&"x".repeat(121), None, vec![]).is_err());
        assert!(validate_touch("ok", None, vec!["x".repeat(1025)]).is_err());
    }

    #[test]
    fn touch_reuses_same_paths_without_duplicating() {
        let list = vec![entry("ws-1", &["/a", "/b"], "2026-10-28T00:00:00Z")];
        let touched = StoredRecent {
            label: "renamed".to_string(),
            last_opened: "2026-10-29T00:00:00Z".to_string(),
            ..entry("ws-9", &["/b", "/a"], "2026-10-29T00:00:00Z")
        };
        let next = apply_touch(&list, touched);
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "ws-1");
        assert_eq!(next[0].label, "renamed");
        assert_eq!(next[0].created_at, "2026-10-01T00:00:00Z");
    }

    #[test]
    fn touch_appends_and_sorts_newest_first() {
        let list = vec![entry("ws-1", &["/a"], "2026-10-28T00:00:00Z")];
        let next = apply_touch(&list, entry("ws-2", &["/b"], "2026-10-29T00:00:00Z"));
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, "ws-2");
    }

    #[test]
    fn touch_keeps_folderless_projects_in_separate_entries() {
        // Two projects without folders share the empty path set, so
        // it must never match: each keeps its own entry. Reopening
        // the same entry still reuses it by id.
        let first = StoredRecent {
            project_id: Some("proy-1".to_string()),
            ..entry("ws-1", &[], "2026-10-28T00:00:00Z")
        };
        let second = StoredRecent {
            project_id: Some("proy-2".to_string()),
            ..entry("ws-2", &[], "2026-10-29T00:00:00Z")
        };
        let next = apply_touch(&[first.clone()], second);
        assert_eq!(next.len(), 2);
        assert_eq!(next[0].id, "ws-2");
        assert_eq!(next[1], first);
        let reopened = StoredRecent {
            label: "Shop again".to_string(),
            last_opened: "2026-10-30T00:00:00Z".to_string(),
            ..entry("ws-1", &[], "2026-10-30T00:00:00Z")
        };
        let again = apply_touch(&next, reopened);
        assert_eq!(again.len(), 2);
        assert_eq!(again[0].id, "ws-1");
        assert_eq!(again[0].label, "Shop again");
    }

    fn project_entry(id: &str, project: &str, paths: &[&str], opened: &str) -> StoredRecent {
        StoredRecent {
            project_id: Some(project.to_string()),
            ..entry(id, paths, opened)
        }
    }

    #[test]
    fn touch_reuses_the_project_entry_when_its_folders_change() {
        // A touch with a new id and other paths is still the same
        // project: the old paths must go, or reopening the entry
        // would restore a folder the person removed.
        let list = vec![project_entry(
            "ws-1",
            "proy-1",
            &["/a", "/b"],
            "2026-10-28T00:00:00Z",
        )];
        let touched = project_entry("ws-9", "proy-1", &["/b"], "2026-10-29T00:00:00Z");
        let next = apply_touch(&list, touched);
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "ws-1");
        assert_eq!(next[0].root_paths, vec!["/b".to_string()]);
        assert_eq!(next[0].created_at, "2026-10-01T00:00:00Z");
    }

    #[test]
    fn touch_folds_duplicate_entries_of_one_project() {
        // Lists written before this rule can hold several entries for
        // one project: the touched one survives, the stale ones go.
        let list = vec![
            project_entry("ws-2", "proy-1", &["/a", "/b"], "2026-10-29T00:00:00Z"),
            project_entry("ws-1", "proy-1", &["/b"], "2026-10-28T00:00:00Z"),
            project_entry("ws-3", "proy-2", &["/c"], "2026-10-27T00:00:00Z"),
        ];
        let touched = project_entry("ws-1", "proy-1", &["/b"], "2026-10-30T00:00:00Z");
        let next = apply_touch(&list, touched);
        let ids: Vec<&str> = next.iter().map(|recent| recent.id.as_str()).collect();
        assert_eq!(ids, vec!["ws-1", "ws-3"]);
    }

    #[test]
    fn remove_is_idempotent() {
        let list = vec![entry("ws-1", &["/a"], "2026-10-28T00:00:00Z")];
        assert!(apply_remove(&list, "ws-9").len() == 1);
        assert!(apply_remove(&list, "ws-1").is_empty());
    }

    #[test]
    fn remove_forgets_one_entry_and_keeps_the_rest_intact() {
        // Forgetting a recent drops its row only: the surviving
        // entries keep their project reference, label and paths
        // byte-identical, and project data lives in other tables
        // this function cannot reach.
        let list = vec![
            entry("ws-1", &["/a"], "2026-10-28T00:00:00Z"),
            StoredRecent {
                project_id: Some("proy-1".to_string()),
                ..entry("ws-2", &["/b"], "2026-10-29T00:00:00Z")
            },
        ];
        let next = apply_remove(&list, "ws-1");
        assert_eq!(next, vec![list[1].clone()]);
    }
}
