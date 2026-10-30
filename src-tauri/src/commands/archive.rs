//! Archive and delete commands: thin wrappers over `ruth-api`.
//!
//! The advance summary is advisory (mutates nothing); execution revalidates
//! the conditions in Rust and goes through `transact`: validate with
//! the core, persist in one transaction and publish only after commit.

use tauri::State;

use ruth_api::{
    ApiError, ArchiveModuleInput, ArchivePreviewDto, ArchivePreviewInput, ArchiveRequirementInput,
    DeleteModuleInput, DeleteProjectInput, DeleteRequirementInput, ModuleDto, RequirementDetail,
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
        ready.code_links,
        ready.code_roots,
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
    // Logs inspect inside the same critical section as
    // the mutation: nothing can slip between revalidation and deletion.
    let log = &*ready.log;
    let designs = &*ready.designs;
    let metalog = &*ready.baseline_meta;
    let links = &*ready.code_links;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::delete_module_checked(s, log, designs, metalog, links, input)
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
pub fn core_delete_project(
    state: State<AppState>,
    input: DeleteProjectInput,
) -> Result<String, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let log = &*ready.log;
    let designs = &*ready.designs;
    let roots = &*ready.code_roots;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::delete_project_checked(s, log, designs, roots, input)
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
    let links = &*ready.code_links;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::delete_requirement_checked(s, log, designs, links, input)
    })
}
