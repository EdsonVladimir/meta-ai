//! Code-workspace commands: roots, listing and reading.
//!
//! Thin wrappers over `ruth-code` (confinement and reading) and
//! `ruth-store` (root persistence). The frontend only sends root
//! ID + relative path; Rust resolves and validates. Adding/removing
//! roots persists before publishing in memory. Reads never touch the
//! database: they use the stored root and the disk.
//!
//! This boundary does NOT limit what the terminal runs: confinement
//! is for the file API, not a process sandbox.

use std::path::{Path, PathBuf};

use tauri::State;

use ruth_api::ApiError;
use ruth_code::{CodeRoot, CodeWorkspace};

use super::{lock, ready};
use crate::state::AppState;

fn code_err(err: ruth_code::CodeError) -> ApiError {
    ApiError::coded(err.kind(), err.message().to_string())
}

/// Root served to the UI, with absence computed live (the folder may
/// be deleted outside Ruth; the row stays until removed).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeRootDto {
    pub id: String,
    pub path: String,
    pub name: String,
    pub missing: bool,
    pub project_id: Option<String>,
}

impl CodeRootDto {
    pub(crate) fn of(root: &CodeRoot) -> Self {
        Self {
            id: root.id.clone(),
            path: root.path.clone(),
            name: root.name.clone(),
            missing: !Path::new(&root.path).is_dir(),
            project_id: root.project_id.clone(),
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryDto {
    pub name: String,
    pub rel: String,
    pub kind: String,
    pub size: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListingDto {
    pub entries: Vec<DirEntryDto>,
    pub truncated: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentDto {
    pub text: String,
    pub fingerprint: String,
    pub size: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRootInput {
    /// Absolute path chosen with the native dialog.
    pub path: String,
    pub name: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootIdInput {
    pub root_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRootProjectInput {
    pub root_id: String,
    pub project_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootPathInput {
    pub root_id: String,
    /// Path relative to the root (`""` = the root).
    pub rel: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcomeDto {
    pub fingerprint: String,
    pub size: u64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteFileInput {
    pub root_id: String,
    pub rel: String,
    /// Fingerprint of the read; if it changed on disk and there is no `force`,
    /// `code_conflict` without touching anything.
    pub expected_fingerprint: String,
    pub content: String,
    /// Explicit replacement after a conflict (the person already compared).
    pub force: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRustInput {
    /// Saved files to analyze (bounded by the extractor).
    pub files: Vec<RootPathInput>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureRangeDto {
    pub start_line: usize,
    pub start_col: usize,
    pub end_line: usize,
    pub end_col: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureMemberDto {
    pub kind: String,
    pub name: String,
    pub detail: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureSymbolDto {
    pub id: String,
    pub language: String,
    pub kind: String,
    pub name: String,
    pub root_id: String,
    pub rel: String,
    pub range: StructureRangeDto,
    pub members: Vec<StructureMemberDto>,
    pub members_truncated: bool,
    pub heuristic: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureRelationDto {
    pub id: String,
    pub kind: String,
    pub from: String,
    pub to: Option<String>,
    pub to_name: String,
    pub status: String,
    pub evidence: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureFileDto {
    pub root_id: String,
    pub rel: String,
    pub hash: String,
    pub bytes: usize,
    pub language: Option<String>,
    pub status: String,
    pub message: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureLimitsDto {
    pub max_files: usize,
    pub max_symbols: usize,
    pub max_relations: usize,
    pub max_members: usize,
    pub max_endpoints: usize,
    pub max_calls: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiPointDto {
    pub id: String,
    pub method: String,
    pub url: String,
    pub root_id: String,
    pub rel: String,
    pub range: StructureRangeDto,
    pub evidence: String,
    pub note: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureResultDto {
    pub files: Vec<StructureFileDto>,
    pub symbols: Vec<StructureSymbolDto>,
    pub relations: Vec<StructureRelationDto>,
    pub endpoints: Vec<ApiPointDto>,
    pub calls: Vec<ApiPointDto>,
    pub symbols_truncated: bool,
    pub relations_truncated: bool,
    pub endpoints_truncated: bool,
    pub calls_truncated: bool,
    pub limits: StructureLimitsDto,
}

pub(crate) fn workspace_of(log: &ruth_store::CodeRootLog) -> CodeWorkspace {
    CodeWorkspace::from_roots(log.roots().to_vec())
}

#[tauri::command]
pub fn code_list_roots(state: State<AppState>) -> Result<Vec<CodeRootDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    Ok(ready
        .code_roots
        .roots()
        .iter()
        .map(CodeRootDto::of)
        .collect())
}

#[tauri::command]
pub fn code_add_root(state: State<AppState>, input: AddRootInput) -> Result<CodeRootDto, ApiError> {
    let path = input.path.trim().to_string();
    if path.is_empty() {
        return Err(code_err(ruth_code::CodeError::not_a_directory("")));
    }
    let candidate = PathBuf::from(&path);
    if !candidate.is_dir() {
        return Err(code_err(ruth_code::CodeError::not_a_directory(&path)));
    }
    // Canonical for comparing duplicates (the same folder through two
    // different paths counts as a single root).
    let canonical = candidate
        .canonicalize()
        .map_err(|e| ApiError::internal(format!("could not resolve '{path}': {e}")))?;
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    for existing in ready.code_roots.roots() {
        let same = PathBuf::from(&existing.path)
            .canonicalize()
            .map(|p| p == canonical)
            .unwrap_or_else(|_| existing.path == canonical.to_string_lossy());
        if same {
            return Err(ApiError::coded(
                "code_root_duplicate",
                format!("'{}' is already in the workspace", existing.name),
            ));
        }
    }
    let id = ready.ids.code_root();
    let checkpoint = ready.ids.checkpoint();
    let name = input
        .name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| ruth_code::default_root_name(&canonical));
    let root = CodeRoot {
        id,
        path: canonical.to_string_lossy().into_owned(),
        name,
        // New folders enter unlinked; linking them is explicit.
        project_id: None,
    };
    let mut workspace = workspace_of(ready.code_roots);
    workspace.add(root.clone()).map_err(code_err)?;
    let roots = workspace.roots().to_vec();
    // Persist before publishing; on failure the ID does not advance.
    if let Err(err) = ready.db.save_code_roots(&roots, checkpoint) {
        *ready.ids = ruth_api::IdGen::restore(checkpoint);
        return Err(ApiError::storage(err));
    }
    let mut log = ruth_store::CodeRootLog::new();
    for root in &roots {
        log.rehydrate(
            root.id.clone(),
            root.path.clone(),
            root.name.clone(),
            root.project_id.clone(),
        );
    }
    *ready.code_roots = log;
    Ok(CodeRootDto::of(&root))
}

#[tauri::command]
pub fn code_remove_root(
    state: State<AppState>,
    input: RootIdInput,
) -> Result<CodeRootDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    // No cascades: with links you must unlink first.
    ruth_api::check_root_removable(ready.code_links, &input.root_id)?;
    let mut workspace = workspace_of(ready.code_roots);
    let removed = workspace.remove(&input.root_id).map_err(code_err)?;
    let roots = workspace.roots().to_vec();
    if let Err(err) = ready.db.save_code_roots(&roots, ready.ids.checkpoint()) {
        return Err(ApiError::storage(err));
    }
    let mut log = ruth_store::CodeRootLog::new();
    for root in &roots {
        log.rehydrate(
            root.id.clone(),
            root.path.clone(),
            root.name.clone(),
            root.project_id.clone(),
        );
    }
    *ready.code_roots = log;
    Ok(CodeRootDto::of(&removed))
}

/// Links a root to a project (`project_id`) or leaves it unlinked (`None`).
/// Unlinking deletes neither files nor the root: only the pointer.
#[tauri::command]
pub fn code_set_root_project(
    state: State<AppState>,
    input: SetRootProjectInput,
) -> Result<CodeRootDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    if let Some(raw) = input.project_id.as_deref() {
        let project = ruth_core::domain::ProjectId::new(raw.to_string())?;
        if ready.store.project(&project).is_none() {
            return Err(ruth_core::domain::CoreError::ProjectNotFound { project }.into());
        }
    }
    let mut roots: Vec<CodeRoot> = ready.code_roots.roots().to_vec();
    let root = roots
        .iter_mut()
        .find(|r| r.id == input.root_id)
        .ok_or_else(|| code_err(ruth_code::CodeError::root_not_found(&input.root_id)))?;
    root.project_id = input.project_id;
    if let Err(err) = ready.db.save_code_roots(&roots, ready.ids.checkpoint()) {
        return Err(ApiError::storage(err));
    }
    let mut log = ruth_store::CodeRootLog::new();
    for root in &roots {
        log.rehydrate(
            root.id.clone(),
            root.path.clone(),
            root.name.clone(),
            root.project_id.clone(),
        );
    }
    *ready.code_roots = log;
    let updated = roots
        .iter()
        .find(|r| r.id == input.root_id)
        .expect("the root exists: it was just saved");
    Ok(CodeRootDto::of(updated))
}

#[tauri::command]
pub fn code_list_dir(
    state: State<AppState>,
    input: RootPathInput,
) -> Result<DirListingDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let root = ready
        .code_roots
        .roots()
        .iter()
        .find(|r| r.id == input.root_id)
        .cloned()
        .ok_or_else(|| code_err(ruth_code::CodeError::root_not_found(&input.root_id)))?;
    // Disk is touched while holding the lock but with no network or SQL: the
    // operation is bounded (one folder, 500 entries). It never sleeps
    // inside the lock on any path.
    let listing = ruth_code::list_dir(Path::new(&root.path), &input.rel).map_err(code_err)?;
    Ok(DirListingDto {
        entries: listing
            .entries
            .into_iter()
            .map(|e| DirEntryDto {
                name: e.name,
                rel: e.rel,
                kind: match e.kind {
                    ruth_code::EntryKind::File => "file".to_string(),
                    ruth_code::EntryKind::Dir => "dir".to_string(),
                    ruth_code::EntryKind::Other => "other".to_string(),
                },
                size: e.size,
            })
            .collect(),
        truncated: listing.truncated,
    })
}

#[tauri::command]
pub fn code_read_file(
    state: State<AppState>,
    input: RootPathInput,
) -> Result<FileContentDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let root = ready
        .code_roots
        .roots()
        .iter()
        .find(|r| r.id == input.root_id)
        .cloned()
        .ok_or_else(|| code_err(ruth_code::CodeError::root_not_found(&input.root_id)))?;
    let content = ruth_code::read_file(Path::new(&root.path), &input.rel).map_err(code_err)?;
    Ok(FileContentDto {
        text: content.text,
        fingerprint: content.fingerprint,
        size: content.size,
    })
}

#[tauri::command]
pub fn code_write_file(
    state: State<AppState>,
    input: WriteFileInput,
) -> Result<WriteOutcomeDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let root = ready
        .code_roots
        .roots()
        .iter()
        .find(|r| r.id == input.root_id)
        .cloned()
        .ok_or_else(|| code_err(ruth_code::CodeError::root_not_found(&input.root_id)))?;
    // Bounded write with no network or SQL under the lock; the conflict
    // is detected by fingerprint before touching disk.
    let outcome = ruth_code::write_file(
        Path::new(&root.path),
        &input.rel,
        &input.expected_fingerprint,
        &input.content,
        input.force,
    )
    .map_err(code_err)?;
    Ok(WriteOutcomeDto {
        fingerprint: outcome.fingerprint,
        size: outcome.size,
    })
}

#[tauri::command]
pub fn code_analyze_rust(
    state: State<AppState>,
    input: AnalyzeRustInput,
) -> Result<StructureResultDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    // Bounded reads (cap on files and on bytes per file) with no
    // network or SQL under the lock. Each failure is per file.
    let mut loaded: Vec<(String, String, String, String)> = Vec::new();
    let mut read_errors: Vec<StructureFileDto> = Vec::new();
    for file in input
        .files
        .iter()
        .take(ruth_code::structure::MAX_STRUCTURE_FILES)
    {
        let root = ready
            .code_roots
            .roots()
            .iter()
            .find(|candidate| candidate.id == file.root_id)
            .cloned();
        let root = match root {
            Some(root) => root,
            None => {
                read_errors.push(StructureFileDto {
                    root_id: file.root_id.clone(),
                    rel: file.rel.clone(),
                    hash: String::new(),
                    bytes: 0,
                    language: None,
                    status: "error".to_string(),
                    message: Some(format!("Folder '{}' outside the workspace", file.root_id)),
                });
                continue;
            }
        };
        match ruth_code::read_file(Path::new(&root.path), &file.rel) {
            Ok(content) => loaded.push((
                file.root_id.clone(),
                file.rel.clone(),
                content.text.clone(),
                ruth_code::fnv1a_hex(&content.text),
            )),
            Err(err) => read_errors.push(StructureFileDto {
                root_id: file.root_id.clone(),
                rel: file.rel.clone(),
                hash: String::new(),
                bytes: 0,
                language: None,
                status: "error".to_string(),
                message: Some(err.message().to_string()),
            }),
        }
    }
    let analyzed = ruth_code::analyze_rust_files(&loaded);
    let mut files: Vec<StructureFileDto> = analyzed
        .files
        .into_iter()
        .map(|file| StructureFileDto {
            root_id: file.root_id,
            rel: file.rel,
            hash: file.hash,
            bytes: file.bytes,
            language: Some("rust".to_string()),
            status: file.status,
            message: file.message,
        })
        .collect();
    files.extend(read_errors);
    Ok(StructureResultDto {
        files,
        symbols: analyzed
            .symbols
            .into_iter()
            .map(|symbol| StructureSymbolDto {
                id: symbol.id,
                language: "rust".to_string(),
                kind: symbol.kind,
                name: symbol.name,
                root_id: symbol.root_id,
                rel: symbol.rel,
                range: StructureRangeDto {
                    start_line: symbol.range.start_line,
                    start_col: symbol.range.start_col,
                    end_line: symbol.range.end_line,
                    end_col: symbol.range.end_col,
                },
                members: symbol
                    .members
                    .into_iter()
                    .map(|member| StructureMemberDto {
                        kind: member.kind,
                        name: member.name,
                        detail: member.detail,
                    })
                    .collect(),
                members_truncated: symbol.members_truncated,
                heuristic: None,
            })
            .collect(),
        relations: analyzed
            .relations
            .into_iter()
            .map(|relation| StructureRelationDto {
                id: relation.id,
                kind: relation.kind,
                from: relation.from,
                to: relation.to,
                to_name: relation.to_name,
                status: relation.status,
                evidence: relation.evidence,
            })
            .collect(),
        endpoints: analyzed
            .endpoints
            .into_iter()
            .map(|point| ApiPointDto {
                id: point.id,
                method: point.method,
                url: point.url,
                root_id: point.root_id,
                rel: point.rel,
                range: StructureRangeDto {
                    start_line: point.range.start_line,
                    start_col: point.range.start_col,
                    end_line: point.range.end_line,
                    end_col: point.range.end_col,
                },
                evidence: point.evidence,
                note: point.note,
            })
            .collect(),
        calls: analyzed
            .calls
            .into_iter()
            .map(|point| ApiPointDto {
                id: point.id,
                method: point.method,
                url: point.url,
                root_id: point.root_id,
                rel: point.rel,
                range: StructureRangeDto {
                    start_line: point.range.start_line,
                    start_col: point.range.start_col,
                    end_line: point.range.end_line,
                    end_col: point.range.end_col,
                },
                evidence: point.evidence,
                note: point.note,
            })
            .collect(),
        symbols_truncated: analyzed.symbols_truncated,
        relations_truncated: analyzed.relations_truncated,
        endpoints_truncated: analyzed.endpoints_truncated,
        calls_truncated: analyzed.calls_truncated,
        limits: StructureLimitsDto {
            max_files: ruth_code::structure::MAX_STRUCTURE_FILES,
            max_symbols: ruth_code::structure::MAX_STRUCTURE_SYMBOLS,
            max_relations: ruth_code::structure::MAX_STRUCTURE_RELATIONS,
            max_members: ruth_code::structure::MAX_STRUCTURE_MEMBERS,
            max_endpoints: ruth_code::structure::MAX_STRUCTURE_ENDPOINTS,
            max_calls: ruth_code::structure::MAX_STRUCTURE_CALLS,
        },
    })
}
