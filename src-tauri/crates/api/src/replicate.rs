//! Structure replication: code folders → empty Ruth modules.
//!
//! From a workspace root, the preview suggests the base
//! (`src/app` with the Angular pattern, `src` otherwise) and lists
//! child folders as future modules; running creates in ONE
//! transaction the project (when new), the empty modules with
//! name = folder, the root↔project association and the manual
//! module↔path links. No invented requirements, no AI titles,
//! no code analysis: structure only.
//!
//! Rules: directories only; documented exclusions (hidden,
//! `node_modules`, `dist`, `build`, `target`, `coverage`,
//! `__pycache__`, `.git`); no escapes or links; at most 50 per
//! replication; idempotent by link (root, path), not by name;
//! a root already bound to another project blocks with an explicit message.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use ruth_code::{CodeRoot, CodeWorkspace, EntryKind};
use ruth_core::application::Store;
use ruth_core::domain::{CoreError, ModuleId, Name, ProjectId};
use ruth_store::{CodeLinkLog, LinkScope};

use crate::error::ApiError;
use crate::ids::IdGen;

fn coded(kind: &str, message: impl Into<String>) -> ApiError {
    ApiError::coded(kind, message)
}

/// Maximum modules per replication: excess blocks, never truncates.
pub const MAX_REPLICATE_MODULES: usize = 50;

/// Excluded besides `EXCLUDED_DIR_NAMES` and hidden ones (`.`).
const EXTRA_EXCLUDED: &[&str] = &["build", "coverage", "__pycache__"];

fn code_err(err: ruth_code::CodeError) -> ApiError {
    ApiError::coded(err.kind(), err.message().to_string())
}

/// Policy-excluded folder (never proposes modules).
pub fn is_excluded_dir(name: &str) -> bool {
    name.starts_with('.')
        || ruth_code::EXCLUDED_DIR_NAMES.contains(&name)
        || EXTRA_EXCLUDED.contains(&name)
}

/// Real directory: exists, is a folder and is not a link.
fn is_real_dir(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|meta| meta.is_dir() && !meta.file_type().is_symlink())
        .unwrap_or(false)
}

fn has_subdir(dir: &Path) -> Result<bool, ApiError> {
    let read = std::fs::read_dir(dir).map_err(|e| {
        ApiError::coded(
            "replicate_io",
            format!("Could not read {}: {e}", dir.display()),
        )
    })?;
    for entry in read {
        let entry =
            entry.map_err(|e| ApiError::coded("replicate_io", format!("Could not read: {e}")))?;
        if is_real_dir(&entry.path()) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Suggests the base: `src/app` when it exists with subdirectories (the
/// Angular pattern), `src` otherwise. Without `src` there is no honest replication.
pub fn suggest_base(root_path: &Path) -> Result<(String, String), ApiError> {
    if !is_real_dir(&root_path.join("src")) {
        // Without src (monorepo, sibling microservices, loose script):
        // the root itself is the base and each child a service or
        // package. Base "" = root throughout the flow.
        return Ok((
            String::new(),
            "No src: each root child folder is a service or package.".to_string(),
        ));
    }
    let app = root_path.join("src").join("app");
    if is_real_dir(&app) && has_subdir(&app)? {
        return Ok((
            "src/app".to_string(),
            "Angular pattern: features live in src/app.".to_string(),
        ));
    }
    Ok(("src".to_string(), "Features live in src.".to_string()))
}

/// Valid base: plain relative, confined, a real folder right now.
/// The empty string means the workspace root.
fn resolve_base(root_path: &Path, base: &str) -> Result<String, ApiError> {
    let base = base.trim();
    let resolved = ruth_code::resolve_within(root_path, base).map_err(code_err)?;
    if !is_real_dir(&resolved) {
        let shown = if base.is_empty() { "the root" } else { base };
        return Err(coded(
            "replicate_base",
            format!("Base \"{shown}\" is no longer a folder; review the preview."),
        ));
    }
    Ok(base.to_string())
}

/// Future folder→module, with its existing link if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicateEntry {
    pub name: String,
    pub rel: String,
    /// Module already linked to this path (`None` = free).
    pub linked_module: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicatePreview {
    pub root_id: String,
    pub base: String,
    pub suggested: bool,
    pub reason: String,
    pub entries: Vec<ReplicateEntry>,
    pub excluded: Vec<String>,
    pub truncated: bool,
    pub over_cap: bool,
}

/// Preview without creating anything: base (suggested or chosen) +
/// candidate children with their link state. Stable order (the
/// listing's); read-only.
pub fn preview_replication(
    store: &Store,
    links: &CodeLinkLog,
    root: &CodeRoot,
    base: Option<&str>,
) -> Result<ReplicatePreview, ApiError> {
    let root_path = PathBuf::from(&root.path);
    let (base, reason, suggested) = match base {
        Some(explicit) => (
            resolve_base(&root_path, explicit)?,
            "Base elegida.".to_string(),
            false,
        ),
        None => {
            let (base, reason) = suggest_base(&root_path)?;
            (base, reason, true)
        }
    };
    let listing = ruth_code::list_dir(&root_path, &base).map_err(code_err)?;
    let mut entries = Vec::new();
    let mut excluded = Vec::new();
    for entry in listing.entries {
        if entry.kind != EntryKind::Dir {
            continue;
        }
        if is_excluded_dir(&entry.name) {
            excluded.push(entry.name);
            continue;
        }
        let linked_module = links
            .by_root(&root.id)
            .iter()
            .find(|link| link.scope == LinkScope::Module && link.rel == entry.rel)
            .and_then(|link| store.module(&ModuleId::new(link.owner_id.clone()).ok()?))
            .map(|module| module.name().to_string());
        entries.push(ReplicateEntry {
            name: entry.name,
            rel: entry.rel,
            linked_module,
        });
    }
    excluded.sort();
    Ok(ReplicatePreview {
        root_id: root.id.clone(),
        base,
        suggested,
        reason,
        over_cap: entries.len() > MAX_REPLICATE_MODULES,
        entries,
        excluded,
        truncated: listing.truncated,
    })
}

/// Destination: new project (validated name) or existing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReplicateTarget {
    New { name: String },
    Existing { project_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicateInput {
    pub root_id: String,
    pub base: String,
    pub rels: Vec<String>,
    pub target: ReplicateTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedModule {
    pub name: String,
    pub rel: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplicatePlan {
    pub root_id: String,
    pub project_id: String,
    pub project_name: Option<String>,
    pub modules: Vec<PlannedModule>,
    pub already_linked: Vec<String>,
}

/// Validates the replication without mutating anything: root, destination,
/// base, selection (confined, real folders now, no excluded, cap) and
/// new/linked partition by link (root, path).
pub fn plan_replication(
    store: &Store,
    roots: &CodeWorkspace,
    links: &CodeLinkLog,
    input: &ReplicateInput,
) -> Result<ReplicatePlan, ApiError> {
    let Some(root) = roots.get(&input.root_id) else {
        return Err(coded("code_root_not_found", "Folder outside the workspace"));
    };
    let (project_id, project_name) = match &input.target {
        ReplicateTarget::New { name } => {
            let valid = Name::new(name.clone())?;
            (String::new(), Some(valid.as_str().to_string()))
        }
        ReplicateTarget::Existing { project_id } => {
            let project = ProjectId::new(project_id.clone())?;
            if store.project(&project).is_none() {
                return Err(CoreError::ProjectNotFound { project }.into());
            }
            (project_id.clone(), None)
        }
    };
    if let Some(bound) = root.project_id.as_deref() {
        let same = match &input.target {
            ReplicateTarget::Existing { project_id } => bound == project_id,
            ReplicateTarget::New { .. } => false,
        };
        if !same {
            return Err(coded(
                "replicate_bound_elsewhere",
                "This folder is already bound to another project; unlink it first.",
            ));
        }
    }
    if input.rels.is_empty() {
        return Err(coded(
            "replicate_empty",
            "Pick at least one folder to replicate.",
        ));
    }
    if input.rels.len() > MAX_REPLICATE_MODULES {
        return Err(coded(
            "replicate_too_many",
            format!(
                "Too many folders ({} of {} at most); uncheck some.",
                input.rels.len(),
                MAX_REPLICATE_MODULES
            ),
        ));
    }
    let root_path = PathBuf::from(&root.path);
    let base = resolve_base(&root_path, &input.base)?;
    let mut seen = HashSet::new();
    let mut modules = Vec::new();
    let mut already_linked = Vec::new();
    for rel in &input.rels {
        if !seen.insert(rel.clone()) {
            return Err(coded(
                "replicate_duplicate",
                format!("Repeated folder: {rel}."),
            ));
        }
        // Direct child of the base; with base "" (root) the whole
        // rel is the name.
        let name = if base.is_empty() {
            if rel.is_empty() {
                return Err(coded(
                    "replicate_entry",
                    "\"\" is not a direct child of the root.".to_string(),
                ));
            }
            rel.as_str()
        } else {
            let Some(name) = rel.strip_prefix(&format!("{base}/")) else {
                return Err(coded(
                    "replicate_entry",
                    format!("\"{rel}\" is not a direct child of {base}."),
                ));
            };
            name
        };
        if name.is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name == "."
            || name == ".."
        {
            return Err(coded(
                "replicate_entry",
                format!("\"{rel}\" is not a direct child of {base}."),
            ));
        }
        if is_excluded_dir(name) {
            return Err(coded(
                "replicate_excluded",
                format!("\"{name}\" is excluded by policy."),
            ));
        }
        let gone = || {
            coded(
                "replicate_entry_gone",
                format!("\"{rel}\" is no longer a folder; generate the preview again."),
            )
        };
        // Lexically already validated above: when it does not resolve or is
        // not a real folder, it vanished or changed under our feet.
        let resolved = ruth_code::resolve_within(&root_path, rel).map_err(|_| gone())?;
        if !is_real_dir(&resolved) {
            return Err(gone());
        }
        let folder = Name::new(name.to_string())?;
        let taken = links
            .by_root(&root.id)
            .iter()
            .any(|link| link.scope == LinkScope::Module && link.rel == *rel);
        if taken {
            already_linked.push(rel.clone());
        } else {
            modules.push(PlannedModule {
                name: folder.as_str().to_string(),
                rel: rel.clone(),
            });
        }
    }
    if modules.is_empty() {
        return Err(coded(
            "replicate_nothing_new",
            "Everything chosen is already linked; pick other folders.",
        ));
    }
    Ok(ReplicatePlan {
        root_id: root.id.clone(),
        project_id,
        project_name,
        modules,
        already_linked,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedModule {
    pub module_id: String,
    pub name: String,
    pub rel: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppliedReplication {
    pub project_id: String,
    pub project_created: bool,
    pub modules: Vec<AppliedModule>,
}

/// Applies the plan over a domain draft (project when new + empty
/// modules with name = folder). Touches neither disk nor
/// links: the command persists everything together later.
pub fn apply_replication(
    store: &mut Store,
    ids: &mut IdGen,
    plan: &ReplicatePlan,
) -> Result<AppliedReplication, ApiError> {
    let (project, project_created) = match plan.project_name.as_deref() {
        Some(name) => {
            let created = store.create_project(ids.project())?;
            let expected = created.id().as_str().to_string();
            let renamed =
                store.rename_project(created.id(), &expected, Name::new(name.to_string())?)?;
            (renamed.id().clone(), true)
        }
        None => (ProjectId::new(plan.project_id.clone())?, false),
    };
    let mut modules = Vec::with_capacity(plan.modules.len());
    for planned in &plan.modules {
        let created = store.create_module(&project, ids.module())?;
        let expected = created.id().as_str().to_string();
        let renamed = store.rename_module(
            &project,
            created.id(),
            &expected,
            Name::new(planned.name.clone())?,
        )?;
        modules.push(AppliedModule {
            module_id: renamed.id().as_str().to_string(),
            name: renamed.name().to_string(),
            rel: planned.rel.clone(),
        });
    }
    Ok(AppliedReplication {
        project_id: project.as_str().to_string(),
        project_created,
        modules,
    })
}

/// Builds the manual module↔path links over the already applied
/// draft (revalidates disk and duplicates; draft IDs).
pub fn build_replication_links(
    store: &Store,
    roots: &[CodeRoot],
    links: &CodeLinkLog,
    ids: &mut IdGen,
    root_id: &str,
    applied: &AppliedReplication,
    now: &str,
) -> Result<Vec<ruth_store::StoredCodeLink>, ApiError> {
    let mut out = Vec::with_capacity(applied.modules.len());
    for module in &applied.modules {
        out.push(crate::code_links::build_module_link(
            store,
            roots,
            links,
            ids,
            crate::code_links::AddModuleLinkInput {
                module_id: module.module_id.clone(),
                root_id: root_id.to_string(),
                rel: module.rel.clone(),
            },
            now,
        )?);
    }
    Ok(out)
}
