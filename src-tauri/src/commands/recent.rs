//! Saved workspaces (recents): list, touch and remove.
//!
//! Thin wrappers over `ruth-api` validation and `ruth-store`
//! persistence. References only: listing reports each stored path
//! with a live missing flag (folders may vanish outside Ruth;
//! rows are kept until removed explicitly).

use std::path::Path;

use tauri::State;

use ruth_api::{now_utc_iso8601, ApiError};
use ruth_store::StoredRecent;

use super::{lock, ready};
use crate::state::AppState;

/// Recent entry served to the UI, with live path presence.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDto {
    pub id: String,
    pub label: String,
    pub project_id: Option<String>,
    pub root_paths: Vec<String>,
    pub missing_paths: Vec<String>,
    pub last_opened: String,
    pub created_at: String,
}

impl RecentDto {
    pub(crate) fn of(recent: &StoredRecent) -> Self {
        let missing_paths = recent
            .root_paths
            .iter()
            .filter(|path| !Path::new(path).is_dir())
            .cloned()
            .collect();
        Self {
            id: recent.id.clone(),
            label: recent.label.clone(),
            project_id: recent.project_id.clone(),
            root_paths: recent.root_paths.clone(),
            missing_paths,
            last_opened: recent.last_opened.clone(),
            created_at: recent.created_at.clone(),
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TouchRecentInput {
    pub id: Option<String>,
    pub label: String,
    pub project_id: Option<String>,
    pub root_paths: Vec<String>,
}

#[tauri::command]
pub fn recent_list(state: State<AppState>) -> Result<Vec<RecentDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    Ok(ready.recents.recents().iter().map(RecentDto::of).collect())
}

#[tauri::command]
pub fn recent_touch(
    state: State<AppState>,
    input: TouchRecentInput,
) -> Result<RecentDto, ApiError> {
    let touch =
        ruth_api::recents::validate_touch(&input.label, input.project_id, input.root_paths)?;
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let now = now_utc_iso8601();
    let id = input
        .id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| ready.ids.workspace());
    let checkpoint = ready.ids.checkpoint();
    let created_at = ready
        .recents
        .recents()
        .iter()
        .find(|recent| recent.id == id)
        .map(|recent| recent.created_at.clone())
        .unwrap_or_else(|| now.clone());
    let entry = StoredRecent {
        id,
        label: touch.label,
        project_id: touch.project_id,
        root_paths: touch.root_paths,
        last_opened: now,
        created_at,
    };
    let next = ruth_api::recents::apply_touch(ready.recents.recents(), entry.clone());
    // Persist before publishing; on failure the id does not advance.
    if let Err(err) = ready.db.save_recents(&next, checkpoint) {
        *ready.ids = ruth_api::IdGen::restore(checkpoint);
        return Err(ApiError::storage(err));
    }
    let mut log = ruth_store::RecentLog::new();
    log.replace(next);
    let saved = log
        .recents()
        .iter()
        .find(|recent| {
            recent.label == entry.label
                && recent.last_opened == entry.last_opened
                && recent.root_paths == entry.root_paths
        })
        .cloned()
        .unwrap_or(entry);
    *ready.recents = log;
    Ok(RecentDto::of(&saved))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveRecentInput {
    pub id: String,
}

#[tauri::command]
pub fn recent_remove(state: State<AppState>, input: RemoveRecentInput) -> Result<(), ApiError> {
    let id = input.id.trim().to_string();
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let next = ruth_api::recents::apply_remove(ready.recents.recents(), &id);
    if next.len() == ready.recents.recents().len() {
        return Ok(());
    }
    let checkpoint = ready.ids.checkpoint();
    if let Err(err) = ready.db.save_recents(&next, checkpoint) {
        return Err(ApiError::storage(err));
    }
    let mut log = ruth_store::RecentLog::new();
    log.replace(next);
    *ready.recents = log;
    Ok(())
}
