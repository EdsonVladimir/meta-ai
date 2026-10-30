//! Rename commands: thin wrappers over `ruth-api`.
//!
//! Renaming touches no identities, versions, sources or approvals; it
//! requires the expected name and goes through `transact`: validate with
//! the core, persist in one transaction and publish only after commit.

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, ModuleDto, ProjectDto, RenameArtifactInput, RenameModuleInput,
    RenameProjectInput, RequirementDetail,
};

use super::{lock, ready};
use crate::state::AppState;

#[tauri::command]
pub fn core_rename_project(
    state: State<AppState>,
    input: RenameProjectInput,
) -> Result<ProjectDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::rename_project(s, input)
    })
}

#[tauri::command]
pub fn core_rename_module(
    state: State<AppState>,
    input: RenameModuleInput,
) -> Result<ModuleDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::rename_module(s, input)
    })
}

#[tauri::command]
pub fn core_rename_requirement(
    state: State<AppState>,
    input: RenameArtifactInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let now = now_utc_iso8601();
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::rename_requirement(s, input, &now)
    })
}

#[tauri::command]
pub fn core_rename_design(
    state: State<AppState>,
    input: RenameArtifactInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let now = now_utc_iso8601();
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::rename_design(s, input, &now)
    })
}
