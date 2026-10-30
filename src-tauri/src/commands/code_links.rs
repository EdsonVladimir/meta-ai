//! Code↔knowledge link commands and structure snapshots.
//!
//! Thin wrappers over `ruth-api`: validate, persist in a transaction and
//! publish only after confirming. Reads use memory (equal to the last
//! confirmed save). Nothing here calls Meta or stores file contents:
//! only paths, symbols, ranges and hashes.

use std::path::Path;

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, CodeLinkDto, CurrentFile, SnapshotMetaDto, SnapshotVerifyFileDto,
};

use super::{lock, ready};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinksQueryInput {
    pub scope: Option<String>,
    pub owner_id: Option<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLinksDto {
    pub module_links: Vec<CodeLinkDto>,
    pub artifact_links: Vec<CodeLinkDto>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkIdInput {
    pub id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIdInput {
    pub project_id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotsQueryInput {
    pub project_id: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotIdInput {
    pub id: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub meta: SnapshotMetaDto,
    pub result: serde_json::Value,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotVerifyDto {
    pub files: Vec<SnapshotVerifyFileDto>,
    pub stale: bool,
}

#[tauri::command]
pub fn code_add_module_link(
    state: State<AppState>,
    input: ruth_api::AddModuleLinkInput,
) -> Result<CodeLinkDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let checkpoint = ready.ids.checkpoint();
    let link = match ruth_api::build_module_link(
        ready.store,
        ready.code_roots.roots(),
        ready.code_links,
        ready.ids,
        input,
        &now_utc_iso8601(),
    ) {
        Ok(link) => link,
        Err(err) => {
            *ready.ids = ruth_api::IdGen::restore(checkpoint);
            return Err(err);
        }
    };
    if let Err(err) = ready.db.save_code_link(&link, ready.ids.checkpoint()) {
        *ready.ids = ruth_api::IdGen::restore(checkpoint);
        return Err(ApiError::storage(err));
    }
    ready
        .code_links
        .record(link.clone())
        .map_err(ApiError::storage)?;
    Ok(CodeLinkDto::of(&link, ready.code_roots.roots()))
}

#[tauri::command]
pub fn code_add_symbol_link(
    state: State<AppState>,
    input: ruth_api::AddSymbolLinkInput,
) -> Result<CodeLinkDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let checkpoint = ready.ids.checkpoint();
    let link = match ruth_api::build_symbol_link(
        ready.store,
        ready.code_roots.roots(),
        ready.code_links,
        ready.ids,
        input,
        &now_utc_iso8601(),
    ) {
        Ok(link) => link,
        Err(err) => {
            *ready.ids = ruth_api::IdGen::restore(checkpoint);
            return Err(err);
        }
    };
    if let Err(err) = ready.db.save_code_link(&link, ready.ids.checkpoint()) {
        *ready.ids = ruth_api::IdGen::restore(checkpoint);
        return Err(ApiError::storage(err));
    }
    ready
        .code_links
        .record(link.clone())
        .map_err(ApiError::storage)?;
    Ok(CodeLinkDto::of(&link, ready.code_roots.roots()))
}

#[tauri::command]
pub fn code_remove_link(state: State<AppState>, input: LinkIdInput) -> Result<String, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    if ready.code_links.get(&input.id).is_none() {
        return Err(ApiError::coded("code_link_not_found", "Missing link"));
    }
    if let Err(err) = ready.db.delete_code_link(&input.id) {
        return Err(ApiError::storage(err));
    }
    ready
        .code_links
        .remove(&input.id)
        .map_err(ApiError::storage)?;
    Ok(input.id)
}

#[tauri::command]
pub fn code_list_links(
    state: State<AppState>,
    input: LinksQueryInput,
) -> Result<Vec<CodeLinkDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = ready.code_roots.roots();
    let links: Vec<&ruth_store::StoredCodeLink> =
        match (input.scope.as_deref(), input.owner_id.as_deref()) {
            (None, None) => ready.code_links.all().iter().collect(),
            (Some(scope), Some(owner_id)) => {
                let parsed = ruth_store::LinkScope::parse(scope).ok_or_else(|| {
                    ApiError::coded(
                        "code_link_invalid",
                        "invalid scope (use module or artifact)",
                    )
                })?;
                ready.code_links.by_owner(parsed, owner_id)
            }
            _ => {
                return Err(ApiError::coded(
                    "code_link_invalid",
                    "scope and owner_id go together or both are omitted",
                ))
            }
        };
    Ok(links
        .into_iter()
        .map(|link| CodeLinkDto::of(link, roots))
        .collect())
}

#[tauri::command]
pub fn code_project_links(
    state: State<AppState>,
    input: ProjectIdInput,
) -> Result<ProjectLinksDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let roots = ready.code_roots.roots();
    let (modules, artifacts) =
        ruth_api::links_for_project(ready.store, ready.code_links, &input.project_id)?;
    Ok(ProjectLinksDto {
        module_links: modules
            .into_iter()
            .map(|link| CodeLinkDto::of(link, roots))
            .collect(),
        artifact_links: artifacts
            .into_iter()
            .map(|link| CodeLinkDto::of(link, roots))
            .collect(),
    })
}

#[tauri::command]
pub fn code_save_snapshot(
    state: State<AppState>,
    input: ruth_api::SaveSnapshotInput,
) -> Result<SnapshotMetaDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let validated = ruth_api::validate_snapshot(ready.store, ready.code_roots.roots(), input)?;
    let checkpoint = ready.ids.checkpoint();
    let snapshot = ruth_store::StoredSnapshot {
        id: ready.ids.snapshot(),
        project_id: validated.project_id,
        name: validated.name,
        created_at: now_utc_iso8601(),
        files_json: validated.files_json,
        result_json: validated.result_json,
    };
    if let Err(err) = ready.db.save_snapshot(&snapshot, ready.ids.checkpoint()) {
        *ready.ids = ruth_api::IdGen::restore(checkpoint);
        return Err(ApiError::storage(err));
    }
    ready
        .snapshots
        .record(snapshot.clone())
        .map_err(ApiError::storage)?;
    Ok(SnapshotMetaDto::of(&snapshot, ready.code_roots.roots()))
}

#[tauri::command]
pub fn code_list_snapshots(
    state: State<AppState>,
    input: SnapshotsQueryInput,
) -> Result<Vec<SnapshotMetaDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    if let Some(raw) = input.project_id.as_deref() {
        let project = ruth_core::domain::ProjectId::new(raw.to_string())?;
        if ready.store.project(&project).is_none() {
            return Err(ruth_core::domain::CoreError::ProjectNotFound { project }.into());
        }
    }
    let roots = ready.code_roots.roots();
    Ok(ready
        .snapshots
        .by_project(input.project_id.as_deref())
        .into_iter()
        .map(|snapshot| SnapshotMetaDto::of(snapshot, roots))
        .collect())
}

#[tauri::command]
pub fn code_get_snapshot(
    state: State<AppState>,
    input: SnapshotIdInput,
) -> Result<SnapshotDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let snapshot = ready
        .snapshots
        .get(&input.id)
        .cloned()
        .ok_or_else(|| ApiError::coded("code_snapshot_not_found", "Missing snapshot"))?;
    let result: serde_json::Value = serde_json::from_str(&snapshot.result_json)
        .map_err(|_| ApiError::internal("corrupt snapshot result"))?;
    let meta = SnapshotMetaDto::of(&snapshot, ready.code_roots.roots());
    Ok(SnapshotDto { meta, result })
}

#[tauri::command]
pub fn code_delete_snapshot(
    state: State<AppState>,
    input: SnapshotIdInput,
) -> Result<String, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    if ready.snapshots.get(&input.id).is_none() {
        return Err(ApiError::coded(
            "code_snapshot_not_found",
            "Missing snapshot",
        ));
    }
    if let Err(err) = ready.db.delete_snapshot(&input.id) {
        return Err(ApiError::storage(err));
    }
    ready
        .snapshots
        .remove(&input.id)
        .map_err(ApiError::storage)?;
    Ok(input.id)
}

/// Re-reads the snapshot files and compares hashes. Pure query:
/// mutates nothing. Files are read with the same read caps.
#[tauri::command]
pub fn code_verify_snapshot(
    state: State<AppState>,
    input: SnapshotIdInput,
) -> Result<SnapshotVerifyDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let snapshot = ready
        .snapshots
        .get(&input.id)
        .cloned()
        .ok_or_else(|| ApiError::coded("code_snapshot_not_found", "Missing snapshot"))?;
    let files = ruth_store::snapshots::parse_files(&snapshot.files_json)
        .map_err(|_| ApiError::internal("corrupt snapshot files"))?;
    let roots = ready.code_roots.roots().to_vec();
    let mut out = Vec::with_capacity(files.len());
    let mut stale = false;
    for file in &files {
        let current = match roots.iter().find(|root| root.id == file.root_id) {
            None => CurrentFile::RootGone,
            Some(root) => match ruth_code::read_file(Path::new(&root.path), &file.rel) {
                Ok(content) => CurrentFile::Hash(ruth_code::structure::fnv1a_hex(&content.text)),
                Err(err) => match err.kind() {
                    "code_not_found" | "code_root_missing" => CurrentFile::Gone,
                    "code_binary" | "code_too_large" | "code_invalid_utf8" => {
                        CurrentFile::UnreadableChanged(err.message().to_string())
                    }
                    _ => CurrentFile::Unreadable(err.message().to_string()),
                },
            },
        };
        let status = ruth_api::snapshot_file_status(&file.hash, &current);
        let (status_name, message) = match (&status, &current) {
            (ruth_api::SnapshotFileStatus::Fresh, _) => ("fresh", None),
            (ruth_api::SnapshotFileStatus::Stale, CurrentFile::UnreadableChanged(reason)) => (
                "stale",
                Some(format!("changed and no longer reads as text: {reason}")),
            ),
            (ruth_api::SnapshotFileStatus::Stale, _) => ("stale", None),
            (ruth_api::SnapshotFileStatus::Missing, _) => ("missing", None),
            (ruth_api::SnapshotFileStatus::Error(reason), _) => ("error", Some(reason.clone())),
        };
        if status_name != "fresh" {
            stale = true;
        }
        out.push(SnapshotVerifyFileDto {
            root_id: file.root_id.clone(),
            rel: file.rel.clone(),
            status: status_name.to_string(),
            message,
        });
    }
    Ok(SnapshotVerifyDto { files: out, stale })
}
