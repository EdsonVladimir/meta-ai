//! Comandos de renombrado: envoltorios finos sobre `ruth-api`.
//!
//! Renombrar no toca identidades, versiones, fuentes ni aprobaciones; exige
//! el nombre esperado y pasa por `transact`: validar con el núcleo,
//! persistir en una transacción y publicar solo tras confirmar.

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
