//! Code↔knowledge links and structure snapshots: validation and
//! pure queries over the `Store` and logs, no Tauri or SQL.
//!
//! Every link is born from an explicit action: never deduced from
//! name matches. Linking modifies no code, creates no core
//! dependencies and writes no metadata into the repository: the
//! only source of truth is the local database. None of this calls Meta
//! or stores file contents or secrets.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use ruth_code::CodeRoot;
use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ModuleId, ProjectId};
use ruth_store::{
    CodeLinkLog, LinkKind, LinkScope, SnapshotFile, SnapshotLog, StoredCodeLink, StoredSnapshot,
    SymbolRef,
};

use crate::error::ApiError;
use crate::ids::IdGen;

/// Caps of the structure result accepted in snapshots (the same as
/// the analyzer's; here to avoid dragging the frontend).
pub const MAX_SNAPSHOT_SYMBOLS: usize = 300;
pub const MAX_SNAPSHOT_RELATIONS: usize = 500;
pub const MAX_SNAPSHOT_ENDPOINTS: usize = 200;
pub const MAX_SNAPSHOT_CALLS: usize = 200;

/// Root needed for validation (id + absolute path).
pub fn root_by_id<'a>(roots: &'a [CodeRoot], root_id: &str) -> Option<&'a CodeRoot> {
    roots.iter().find(|root| root.id == root_id)
}

fn coded(kind: &str, message: impl Into<String>) -> ApiError {
    ApiError::coded(kind, message)
}

/// Resolves `rel` inside the root with the `ruth-code` rules and requires
/// it to exist on disk. Rejects escapes, symlinks and absences.
/// Only reads metadata: never writes into the repository.
pub fn resolve_existing(root_path: &str, rel: &str) -> Result<PathBuf, ApiError> {
    let resolved = ruth_code::resolve_within(Path::new(root_path), rel)
        .map_err(|e| coded(e.kind(), e.message().to_string()))?;
    let meta = std::fs::symlink_metadata(&resolved).map_err(|_| {
        coded(
            "code_not_found",
            format!("\"{rel}\" does not exist on disk"),
        )
    })?;
    if meta.file_type().is_symlink() {
        let err = ruth_code::CodeError::symlink();
        return Err(coded(err.kind(), err.message().to_string()));
    }
    Ok(resolved)
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/// Input for linking a module with a folder or file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddModuleLinkInput {
    pub module_id: String,
    pub root_id: String,
    pub rel: String,
}

/// Symbol with source evidence (just as the analyzer delivers it).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolInput {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub start_line: i64,
    pub start_col: i64,
    pub end_line: i64,
    pub end_col: i64,
    pub hash: String,
}

/// Input for linking an artifact with a detected symbol.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddSymbolLinkInput {
    pub artifact_id: String,
    pub root_id: String,
    pub rel: String,
    pub symbol: SymbolInput,
}

fn non_empty(value: &str, what: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(coded("code_link_invalid", format!("{what} is empty")));
    }
    if value.len() > 512 {
        return Err(coded("code_link_invalid", format!("{what} is too long")));
    }
    Ok(())
}

/// Builds (validated, unpersisted) a manual module ↔ path link.
pub fn build_module_link(
    store: &Store,
    roots: &[CodeRoot],
    links: &CodeLinkLog,
    ids: &mut IdGen,
    input: AddModuleLinkInput,
    now: &str,
) -> Result<StoredCodeLink, ApiError> {
    let module = ModuleId::new(input.module_id)?;
    let stored = store.module(&module).ok_or_else(|| {
        Into::<ApiError>::into(ruth_core::domain::CoreError::ModuleNotFound {
            module: module.clone(),
        })
    })?;
    if stored.archived() {
        return Err(coded(
            "code_link_archived",
            "Restore the module before linking code to it",
        ));
    }
    let root = root_by_id(roots, &input.root_id)
        .ok_or_else(|| coded("code_root_not_found", "Folder outside the workspace"))?;
    resolve_existing(&root.path, &input.rel)?;
    if links
        .by_owner(LinkScope::Module, module.as_str())
        .iter()
        .any(|link| link.root_id == root.id && link.rel == input.rel)
    {
        return Err(coded("code_link_duplicate", "That link already exists"));
    }
    Ok(StoredCodeLink {
        id: ids.code_link(),
        scope: LinkScope::Module,
        owner_id: module.as_str().to_string(),
        root_id: root.id.clone(),
        rel: input.rel,
        symbol: None,
        kind: LinkKind::Manual,
        created_at: now.to_string(),
    })
}

/// Builds (validated, unpersisted) an artifact ↔ symbol link.
pub fn build_symbol_link(
    store: &Store,
    roots: &[CodeRoot],
    links: &CodeLinkLog,
    ids: &mut IdGen,
    input: AddSymbolLinkInput,
    now: &str,
) -> Result<StoredCodeLink, ApiError> {
    let artifact = ArtifactId::new(input.artifact_id)?;
    if store.artifact(&artifact).is_none() {
        return Err(Into::<ApiError>::into(
            ruth_core::domain::CoreError::ArtifactNotFound {
                artifact: artifact.clone(),
            },
        ));
    }
    if store.is_effectively_archived(&artifact) {
        return Err(coded(
            "code_link_archived",
            "Restore the artifact (and its module) before linking code to it",
        ));
    }
    let root = root_by_id(roots, &input.root_id)
        .ok_or_else(|| coded("code_root_not_found", "Folder outside the workspace"))?;
    resolve_existing(&root.path, &input.rel)?;
    let symbol = input.symbol;
    non_empty(&symbol.id, "symbol identity")?;
    non_empty(&symbol.name, "symbol name")?;
    non_empty(&symbol.kind, "symbol kind")?;
    if symbol.start_line < 1
        || symbol.start_col < 1
        || symbol.end_line < 1
        || symbol.end_col < 1
        || (symbol.end_line, symbol.end_col) < (symbol.start_line, symbol.start_col)
    {
        return Err(coded("code_link_invalid", "invalid symbol range"));
    }
    if symbol.hash.trim().is_empty()
        || symbol.hash.len() > 128
        || !symbol.hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(coded(
            "code_link_invalid",
            "the symbol brings no valid source hash",
        ));
    }
    if links
        .by_owner(LinkScope::Artifact, artifact.as_str())
        .iter()
        .any(|link| {
            link.root_id == root.id
                && link.rel == input.rel
                && link.symbol.as_ref().is_some_and(|s| s.id == symbol.id)
        })
    {
        return Err(coded("code_link_duplicate", "That link already exists"));
    }
    Ok(StoredCodeLink {
        id: ids.code_link(),
        scope: LinkScope::Artifact,
        owner_id: artifact.as_str().to_string(),
        root_id: root.id.clone(),
        rel: input.rel,
        symbol: Some(SymbolRef {
            id: symbol.id,
            name: symbol.name,
            kind: symbol.kind,
            start_line: symbol.start_line,
            start_col: symbol.start_col,
            end_line: symbol.end_line,
            end_col: symbol.end_col,
            hash: symbol.hash,
        }),
        kind: LinkKind::Detected,
        created_at: now.to_string(),
    })
}

/// Blocks removing a root with links: no silent cascades.
pub fn check_root_removable(links: &CodeLinkLog, root_id: &str) -> Result<(), ApiError> {
    let count = links.by_root(root_id).len();
    if count > 0 {
        return Err(coded(
            "code_root_has_links",
            format!(
                "\"{root_id}\" has {count} link(s) with the project: unlink them before removing the folder (files stay untouched)"
            ),
        ));
    }
    Ok(())
}

/// Blocks deleting a module with code links.
pub fn check_module_deletable(links: &CodeLinkLog, module_id: &str) -> Result<(), ApiError> {
    let count = links.by_owner(LinkScope::Module, module_id).len();
    if count > 0 {
        return Err(coded(
            "delete_has_code_links",
            format!("{module_id} has {count} link(s) with code: unlink them or archive it"),
        ));
    }
    Ok(())
}

/// Blocks deleting an artifact with linked symbols.
pub fn check_artifact_deletable(links: &CodeLinkLog, artifact_id: &str) -> Result<(), ApiError> {
    let count = links.by_owner(LinkScope::Artifact, artifact_id).len();
    if count > 0 {
        return Err(coded(
            "delete_has_code_links",
            format!("{artifact_id} has {count} linked symbol(s): unlink them or archive it"),
        ));
    }
    Ok(())
}

/// The project's links, split by scope and ordered by id.
pub fn links_for_project<'a>(
    store: &Store,
    links: &'a CodeLinkLog,
    project_id: &str,
) -> Result<(Vec<&'a StoredCodeLink>, Vec<&'a StoredCodeLink>), ApiError> {
    let project = ProjectId::new(project_id)?;
    if store.project(&project).is_none() {
        return Err(Into::<ApiError>::into(
            ruth_core::domain::CoreError::ProjectNotFound { project },
        ));
    }
    let mut modules = Vec::new();
    let mut artifacts = Vec::new();
    for link in links.all() {
        match link.scope {
            LinkScope::Module => {
                if let Ok(id) = ModuleId::new(link.owner_id.clone()) {
                    if store
                        .module(&id)
                        .is_some_and(|m| m.project().as_str() == project_id)
                    {
                        modules.push(link);
                    }
                }
            }
            LinkScope::Artifact => {
                if let Ok(id) = ArtifactId::new(link.owner_id.clone()) {
                    if store
                        .artifact(&id)
                        .is_some_and(|a| a.project().as_str() == project_id)
                    {
                        artifacts.push(link);
                    }
                }
            }
        }
    }
    modules.sort_by(|a, b| a.id.cmp(&b.id));
    artifacts.sort_by(|a, b| a.id.cmp(&b.id));
    Ok((modules, artifacts))
}

// ---------------------------------------------------------------------------
// Structure snapshots
// ---------------------------------------------------------------------------

/// Input for saving an analysis result. Files derive from
/// `result.files` (same source = no inconsistencies).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSnapshotInput {
    pub project_id: Option<String>,
    pub name: Option<String>,
    pub result: serde_json::Value,
}

/// Validated snapshot ready to persist.
#[derive(Debug, Clone)]
pub struct ValidatedSnapshot {
    pub project_id: Option<String>,
    pub name: String,
    pub files_json: String,
    pub result_json: String,
}

fn has_content_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => map
            .iter()
            .any(|(k, v)| k == "content" || has_content_key(v)),
        serde_json::Value::Array(items) => items.iter().any(has_content_key),
        _ => false,
    }
}

/// Validates a snapshot: existing project, bounded name, files
/// inside authorized roots and an IR-shaped result, with no
/// `content` key at any level (no content is stored).
pub fn validate_snapshot(
    store: &Store,
    roots: &[CodeRoot],
    input: SaveSnapshotInput,
) -> Result<ValidatedSnapshot, ApiError> {
    let project_id = match input.project_id {
        Some(raw) => {
            let project = ProjectId::new(raw)?;
            if store.project(&project).is_none() {
                return Err(Into::<ApiError>::into(
                    ruth_core::domain::CoreError::ProjectNotFound { project },
                ));
            }
            Some(project.as_str().to_string())
        }
        None => None,
    };
    let name = input.name.unwrap_or_default().trim().to_string();
    let name_chars = name.chars().count();
    if name_chars == 0 || name_chars > ruth_store::snapshots::MAX_SNAPSHOT_NAME_CHARS {
        return Err(coded("code_snapshot_invalid", "invalid snapshot name"));
    }
    let result_json = serde_json::to_string(&input.result)
        .map_err(|_| coded("code_snapshot_invalid", "result not serializable"))?;
    if result_json.len() > ruth_store::snapshots::MAX_RESULT_BYTES {
        return Err(coded("code_snapshot_invalid", "the result exceeds 1 MiB"));
    }
    if has_content_key(&input.result) {
        return Err(coded(
            "code_snapshot_invalid",
            "the result brings file content: it is not stored",
        ));
    }
    let files = input
        .result
        .get("files")
        .and_then(|v| v.as_array())
        .ok_or_else(|| coded("code_snapshot_invalid", "the result brings no files"))?;
    if files.is_empty() || files.len() > ruth_store::snapshots::MAX_SNAPSHOT_FILES {
        return Err(coded("code_snapshot_invalid", "invalid file count"));
    }
    let symbols = input
        .result
        .get("symbols")
        .and_then(|v| v.as_array())
        .ok_or_else(|| coded("code_snapshot_invalid", "the result brings no symbols"))?;
    if symbols.len() > MAX_SNAPSHOT_SYMBOLS {
        return Err(coded("code_snapshot_invalid", "too many symbols"));
    }
    let relations = input
        .result
        .get("relations")
        .and_then(|v| v.as_array())
        .ok_or_else(|| coded("code_snapshot_invalid", "the result brings no relations"))?;
    if relations.len() > MAX_SNAPSHOT_RELATIONS {
        return Err(coded("code_snapshot_invalid", "too many relations"));
    }
    // New keys (API milestone): optional to avoid breaking
    // earlier snapshots; when present, capped like the rest.
    for (key, max, what) in [
        ("endpoints", MAX_SNAPSHOT_ENDPOINTS, "too many endpoints"),
        ("calls", MAX_SNAPSHOT_CALLS, "too many calls"),
    ] {
        if let Some(value) = input.result.get(key) {
            let items = value
                .as_array()
                .ok_or_else(|| coded("code_snapshot_invalid", "the result brings invalid APIs"))?;
            if items.len() > max {
                return Err(coded("code_snapshot_invalid", what));
            }
        }
    }
    let mut snapshot_files = Vec::with_capacity(files.len());
    for file in files {
        let root_id = file
            .get("rootId")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let rel = file.get("rel").and_then(|v| v.as_str()).unwrap_or_default();
        let hash = file
            .get("hash")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let bytes = file.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
        let root = root_by_id(roots, root_id)
            .ok_or_else(|| coded("code_root_not_found", "Folder outside the workspace"))?;
        ruth_code::resolve_within(Path::new(&root.path), rel)
            .map_err(|e| coded(e.kind(), e.message().to_string()))?;
        if hash.trim().is_empty() {
            return Err(coded("code_snapshot_invalid", "file without a source hash"));
        }
        snapshot_files.push(serde_json::json!({
            "rootId": root.id,
            "rel": rel,
            "hash": hash,
            "bytes": bytes,
        }));
    }
    let files_json = serde_json::to_string(&snapshot_files)
        .map_err(|_| coded("code_snapshot_invalid", "files not serializable"))?;
    Ok(ValidatedSnapshot {
        project_id,
        name,
        files_json,
        result_json,
    })
}

/// A snapshot file's state on verify.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SnapshotFileStatus {
    Fresh,
    Stale,
    Missing,
    Error(String),
}

/// Current read of a file for comparing (the command fetches it).
#[derive(Debug, Clone)]
pub enum CurrentFile {
    /// FNV hash of the current content.
    Hash(String),
    /// The root is no longer in the workspace.
    RootGone,
    /// The folder or file is no longer on disk.
    Gone,
    /// Changed and no longer readable as text (binary, huge...).
    UnreadableChanged(String),
    /// Another read failure (honest message).
    Unreadable(String),
}

/// Compares the stored hash with the current read. Pure and testable.
pub fn snapshot_file_status(stored_hash: &str, current: &CurrentFile) -> SnapshotFileStatus {
    match current {
        CurrentFile::Hash(hash) if hash == stored_hash => SnapshotFileStatus::Fresh,
        CurrentFile::Hash(_) => SnapshotFileStatus::Stale,
        CurrentFile::RootGone | CurrentFile::Gone => SnapshotFileStatus::Missing,
        CurrentFile::UnreadableChanged(_) => SnapshotFileStatus::Stale,
        CurrentFile::Unreadable(message) => SnapshotFileStatus::Error(message.clone()),
    }
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SymbolRefDto {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub start_line: i64,
    pub start_col: i64,
    pub end_line: i64,
    pub end_col: i64,
    pub hash: String,
}

impl SymbolRefDto {
    pub fn of(symbol: &SymbolRef) -> Self {
        Self {
            id: symbol.id.clone(),
            name: symbol.name.clone(),
            kind: symbol.kind.clone(),
            start_line: symbol.start_line,
            start_col: symbol.start_col,
            end_line: symbol.end_line,
            end_col: symbol.end_col,
            hash: symbol.hash.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeLinkDto {
    pub id: String,
    pub scope: String,
    pub owner_id: String,
    pub root_id: String,
    pub root_name: Option<String>,
    pub root_missing: bool,
    pub rel: String,
    pub symbol: Option<SymbolRefDto>,
    pub kind: String,
    pub created_at: String,
}

impl CodeLinkDto {
    pub fn of(link: &StoredCodeLink, roots: &[CodeRoot]) -> Self {
        let root = root_by_id(roots, &link.root_id);
        Self {
            id: link.id.clone(),
            scope: link.scope.as_str().to_string(),
            owner_id: link.owner_id.clone(),
            root_id: link.root_id.clone(),
            root_name: root.map(|r| r.name.clone()),
            root_missing: root.is_none_or(|r| !Path::new(&r.path).exists()),
            rel: link.rel.clone(),
            symbol: link.symbol.as_ref().map(SymbolRefDto::of),
            kind: link.kind.as_str().to_string(),
            created_at: link.created_at.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFileDto {
    pub root_id: String,
    pub root_name: Option<String>,
    pub rel: String,
    pub hash: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMetaDto {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub created_at: String,
    pub files: Vec<SnapshotFileDto>,
    pub symbol_count: usize,
    pub relation_count: usize,
}

impl SnapshotMetaDto {
    pub fn of(snapshot: &StoredSnapshot, roots: &[CodeRoot]) -> Self {
        let files: Vec<SnapshotFile> =
            ruth_store::snapshots::parse_files(&snapshot.files_json).unwrap_or_default();
        let result: serde_json::Value =
            serde_json::from_str(&snapshot.result_json).unwrap_or(serde_json::Value::Null);
        Self {
            id: snapshot.id.clone(),
            project_id: snapshot.project_id.clone(),
            name: snapshot.name.clone(),
            created_at: snapshot.created_at.clone(),
            files: files
                .into_iter()
                .map(|file| {
                    let root = root_by_id(roots, &file.root_id);
                    SnapshotFileDto {
                        root_id: file.root_id,
                        root_name: root.map(|r| r.name.clone()),
                        rel: file.rel,
                        hash: file.hash,
                        bytes: file.bytes,
                    }
                })
                .collect(),
            symbol_count: result
                .get("symbols")
                .and_then(|v| v.as_array())
                .map_or(0, |a| a.len()),
            relation_count: result
                .get("relations")
                .and_then(|v| v.as_array())
                .map_or(0, |a| a.len()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVerifyFileDto {
    pub root_id: String,
    pub rel: String,
    pub status: String,
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// Future portability (.ruth/): contracts only, no sync
// ---------------------------------------------------------------------------

/// Portable associations format version. On change, old readers
/// must reject it (never guess).
pub const PORTABILITY_VERSION: u32 = 1;

/// Portable export of a project: roots, links and snapshots
/// (metadata + IR, no contents or secrets). Future base of the
/// shared `.ruth/` format; this milestone writes and syncs nothing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableExport {
    pub version: u32,
    pub exported_at: String,
    pub project_id: Option<String>,
    pub roots: Vec<PortableRoot>,
    pub links: Vec<PortableLink>,
    pub snapshots: Vec<PortableSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableRoot {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableLink {
    pub id: String,
    pub scope: String,
    pub owner_id: String,
    pub root_id: String,
    pub rel: String,
    pub symbol_id: Option<String>,
    pub symbol_name: Option<String>,
    pub symbol_kind: Option<String>,
    pub range: Option<[i64; 4]>,
    pub evidence_hash: Option<String>,
    pub kind: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableSnapshot {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub files_json: String,
    pub result_json: String,
}

/// Builds the export validating each piece with the same logs as
/// the database (what would not pass loading is not exported).
pub fn export_portable(
    project_id: Option<&str>,
    roots: &[CodeRoot],
    links: &[StoredCodeLink],
    snapshots: &[StoredSnapshot],
    now: &str,
) -> Result<PortableExport, ApiError> {
    let mut link_log = CodeLinkLog::new();
    let mut snapshot_log = SnapshotLog::new();
    let mut portable_links = Vec::with_capacity(links.len());
    for link in links {
        link_log
            .record(link.clone())
            .map_err(|e| coded("portable_invalid", e.to_string()))?;
        portable_links.push(PortableLink {
            id: link.id.clone(),
            scope: link.scope.as_str().to_string(),
            owner_id: link.owner_id.clone(),
            root_id: link.root_id.clone(),
            rel: link.rel.clone(),
            symbol_id: link.symbol.as_ref().map(|s| s.id.clone()),
            symbol_name: link.symbol.as_ref().map(|s| s.name.clone()),
            symbol_kind: link.symbol.as_ref().map(|s| s.kind.clone()),
            range: link
                .symbol
                .as_ref()
                .map(|s| [s.start_line, s.start_col, s.end_line, s.end_col]),
            evidence_hash: link.symbol.as_ref().map(|s| s.hash.clone()),
            kind: link.kind.as_str().to_string(),
            created_at: link.created_at.clone(),
        });
    }
    let mut portable_snapshots = Vec::with_capacity(snapshots.len());
    for snapshot in snapshots {
        snapshot_log
            .record(snapshot.clone())
            .map_err(|e| coded("portable_invalid", e.to_string()))?;
        portable_snapshots.push(PortableSnapshot {
            id: snapshot.id.clone(),
            name: snapshot.name.clone(),
            created_at: snapshot.created_at.clone(),
            files_json: snapshot.files_json.clone(),
            result_json: snapshot.result_json.clone(),
        });
    }
    Ok(PortableExport {
        version: PORTABILITY_VERSION,
        exported_at: now.to_string(),
        project_id: project_id.map(str::to_string),
        roots: roots
            .iter()
            .map(|root| PortableRoot {
                id: root.id.clone(),
                path: root.path.clone(),
                name: root.name.clone(),
            })
            .collect(),
        links: portable_links,
        snapshots: portable_snapshots,
    })
}

/// Reads a portable export validating version and pieces. An unknown
/// version or an invalid piece = complete rejection, no guessing.
pub fn parse_portable_export(json: &str) -> Result<PortableExport, ApiError> {
    let export: PortableExport =
        serde_json::from_str(json).map_err(|_| coded("portable_invalid", "invalid JSON"))?;
    if export.version != PORTABILITY_VERSION {
        return Err(coded(
            "portable_invalid",
            format!("unsupported portable version {}", export.version),
        ));
    }
    let mut link_log = CodeLinkLog::new();
    for link in &export.links {
        let scope = ruth_store::code_links::LinkScope::parse(&link.scope)
            .ok_or_else(|| coded("portable_invalid", "invalid scope"))?;
        let kind = ruth_store::code_links::LinkKind::parse(&link.kind)
            .ok_or_else(|| coded("portable_invalid", "invalid kind"))?;
        let symbol = match (&link.symbol_id, &link.evidence_hash) {
            (Some(id), Some(hash)) => Some(SymbolRef {
                id: id.clone(),
                name: link.symbol_name.clone().unwrap_or_default(),
                kind: link.symbol_kind.clone().unwrap_or_default(),
                start_line: link.range.map(|r| r[0]).unwrap_or(0),
                start_col: link.range.map(|r| r[1]).unwrap_or(0),
                end_line: link.range.map(|r| r[2]).unwrap_or(0),
                end_col: link.range.map(|r| r[3]).unwrap_or(0),
                hash: hash.clone(),
            }),
            (None, None) => None,
            _ => return Err(coded("portable_invalid", "incomplete symbol")),
        };
        link_log
            .record(StoredCodeLink {
                id: link.id.clone(),
                scope,
                owner_id: link.owner_id.clone(),
                root_id: link.root_id.clone(),
                rel: link.rel.clone(),
                symbol,
                kind,
                created_at: link.created_at.clone(),
            })
            .map_err(|e| coded("portable_invalid", e.to_string()))?;
    }
    let mut snapshot_log = SnapshotLog::new();
    for snapshot in &export.snapshots {
        snapshot_log
            .record(StoredSnapshot {
                id: snapshot.id.clone(),
                project_id: export.project_id.clone(),
                name: snapshot.name.clone(),
                created_at: snapshot.created_at.clone(),
                files_json: snapshot.files_json.clone(),
                result_json: snapshot.result_json.clone(),
            })
            .map_err(|e| coded("portable_invalid", e.to_string()))?;
    }
    // No contents: the same guard as when saving.
    for snapshot in &export.snapshots {
        let value: serde_json::Value = serde_json::from_str(&snapshot.result_json)
            .map_err(|_| coded("portable_invalid", "invalid result"))?;
        if has_content_key(&value) {
            return Err(coded("portable_invalid", "the result brings content"));
        }
    }
    Ok(export)
}
