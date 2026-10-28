//! Comandos de requisitos: envoltorios finos sobre `ruth-api`.
//!
//! Las mutaciones pasan por `transact`: validar con el núcleo, persistir en
//! una transacción y publicar solo tras confirmar. Las lecturas usan la
//! memoria (igual al último guardado confirmado). Las invariantes las valida
//! el núcleo; aquí no se duplican reglas.

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, ApproveVersionInput, ArtifactDto, CreateModuleInput,
    CreateRequirementInput, GetRequirementInput, ListModulesInput, ListRequirementsInput,
    ModuleDto, ProjectDto, RequirementDetail, SaveVersionInput,
};

use super::{lock, ready};
use crate::state::{AppState, AppStateInner};

/// Estado del almacenamiento local para la interfaz.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStatus {
    pub ready: bool,
    pub message: Option<String>,
    pub db_path: Option<String>,
}

#[tauri::command]
pub fn core_status(state: State<AppState>) -> Result<CoreStatus, ApiError> {
    let guard = lock(&state.inner)?;
    let db_path = state.db_path.to_string_lossy().to_string();
    match &*guard {
        AppStateInner::Ready(..) => Ok(CoreStatus {
            ready: true,
            message: None,
            db_path: Some(db_path),
        }),
        AppStateInner::Unavailable { message } => Ok(CoreStatus {
            ready: false,
            message: Some(message.clone()),
            db_path: Some(db_path),
        }),
    }
}

#[tauri::command]
pub fn core_create_project(state: State<AppState>) -> Result<ProjectDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, i| {
        ruth_api::create_project(s, i)
    })
}

#[tauri::command]
pub fn core_list_projects(state: State<AppState>) -> Result<Vec<ProjectDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    Ok(ruth_api::list_projects(ready.store))
}

#[tauri::command]
pub fn core_create_module(
    state: State<AppState>,
    input: CreateModuleInput,
) -> Result<ModuleDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, i| {
        ruth_api::create_module(s, i, input)
    })
}

#[tauri::command]
pub fn core_list_modules(
    state: State<AppState>,
    input: ListModulesInput,
) -> Result<Vec<ModuleDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_modules(ready.store, input)
}

#[tauri::command]
pub fn core_create_requirement(
    state: State<AppState>,
    input: CreateRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, i| {
        ruth_api::create_requirement(s, i, input)
    })
}

#[tauri::command]
pub fn core_list_requirements(
    state: State<AppState>,
    input: ListRequirementsInput,
) -> Result<Vec<ArtifactDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_requirements(ready.store, input)
}

#[tauri::command]
pub fn core_get_requirement(
    state: State<AppState>,
    input: GetRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::get_requirement(ready.store, input)
}

#[tauri::command]
pub fn core_save_version(
    state: State<AppState>,
    input: SaveVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::save_version(s, input)
    })
}

#[tauri::command]
pub fn core_approve_version(
    state: State<AppState>,
    input: ApproveVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::approve_version(s, input, &now_utc_iso8601())
    })
}
