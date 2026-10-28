//! Comandos de archivo y borrado: envoltorios finos sobre `ruth-api`.
//!
//! El resumen previo es consultivo (no muta); la ejecución revalida las
//! condiciones en Rust y pasa por `transact`: validar con el núcleo,
//! persistir en una transacción y publicar solo tras confirmar.

use tauri::State;

use ruth_api::{
    ApiError, ArchiveModuleInput, ArchivePreviewDto, ArchivePreviewInput, ArchiveRequirementInput,
    DeleteModuleInput, DeleteRequirementInput, ModuleDto, RequirementDetail,
};

use super::{lock, ready};
use crate::state::AppState;

#[tauri::command]
pub fn core_archive_preview(
    state: State<AppState>,
    input: ArchivePreviewInput,
) -> Result<ArchivePreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::archive_preview(
        ready.store,
        ready.log,
        ready.designs,
        ready.baseline_meta,
        input,
    )
}

#[tauri::command]
pub fn core_archive_module(
    state: State<AppState>,
    input: ArchiveModuleInput,
) -> Result<ModuleDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::archive_module(s, input)
    })
}

#[tauri::command]
pub fn core_restore_module(
    state: State<AppState>,
    input: ArchiveModuleInput,
) -> Result<ModuleDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::restore_module(s, input)
    })
}

#[tauri::command]
pub fn core_delete_module(
    state: State<AppState>,
    input: DeleteModuleInput,
) -> Result<String, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    // Los registros se inspeccionan dentro de la misma sección crítica que
    // la mutación: nada puede colarse entre la revalidación y el borrado.
    let log = &*ready.log;
    let designs = &*ready.designs;
    let metalog = &*ready.baseline_meta;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::delete_module_checked(s, log, designs, metalog, input)
    })
}

#[tauri::command]
pub fn core_archive_requirement(
    state: State<AppState>,
    input: ArchiveRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::archive_requirement(s, input)
    })
}

#[tauri::command]
pub fn core_restore_requirement(
    state: State<AppState>,
    input: ArchiveRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::restore_requirement(s, input)
    })
}

#[tauri::command]
pub fn core_delete_requirement(
    state: State<AppState>,
    input: DeleteRequirementInput,
) -> Result<String, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let log = &*ready.log;
    let designs = &*ready.designs;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::delete_requirement_checked(s, log, designs, input)
    })
}
