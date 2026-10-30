//! Work/draft delivery commands: thin wrappers over
//! `ruth-api`.
//!
//! A work delivery is a snapshot of saved versions WITHOUT requiring
//! approval (living design). Reuses the baselines' atomic ZIP saving;
//! the package identifies pendings and never presents itself as
//! coherent or verified.

use std::path::PathBuf;

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, DeliveryCreateInput, DeliveryDto, DeliveryExportPreviewDto,
    DeliveryExportPreviewInput, DeliveryExportSaveDto, DeliveryExportSaveInput, DeliveryGetInput,
    DeliveryListInput, DeliveryPrepareInput, DeliveryPreviewDto, DeliverySummaryDto,
};

use super::baseline::{invalid_path, write_zip_atomic};
use super::{lock, ready};
use crate::state::AppState;

#[tauri::command]
pub fn core_prepare_delivery(
    state: State<AppState>,
    input: DeliveryPrepareInput,
) -> Result<DeliveryPreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::prepare_work_delivery(ready.store, input)
}

#[tauri::command]
pub fn core_create_delivery(
    state: State<AppState>,
    input: DeliveryCreateInput,
) -> Result<DeliveryDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::create_work_delivery(ready.store, ready.ids, ready.db, input, &now_utc_iso8601())
}

#[tauri::command]
pub fn core_get_delivery(
    state: State<AppState>,
    input: DeliveryGetInput,
) -> Result<DeliveryDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::get_work_delivery(ready.store, &input.project_id, &input.delivery_id)
}

#[tauri::command]
pub fn core_list_deliveries(
    state: State<AppState>,
    input: DeliveryListInput,
) -> Result<Vec<DeliverySummaryDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_work_deliveries(ready.store, &input.project_id)
}

#[tauri::command]
pub fn core_export_delivery_preview(
    state: State<AppState>,
    input: DeliveryExportPreviewInput,
) -> Result<DeliveryExportPreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::export_delivery_preview(ready.store, &input.project_id, &input.delivery_id)
}

#[tauri::command]
pub fn core_export_delivery_save(
    state: State<AppState>,
    input: DeliveryExportSaveInput,
) -> Result<DeliveryExportSaveDto, ApiError> {
    if input.dest_path.trim().is_empty() {
        return Err(invalid_path(
            "No destination, no saving: pick again where to save the ZIP.",
        ));
    }
    // Short lock: the package builds from memory and the lock
    // releases before touching disk.
    let (zip, sha256) = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let files =
            ruth_api::build_delivery_files(ready.store, &input.project_id, &input.delivery_id)?;
        let zip = ruth_api::package_to_zip(&files)?;
        let sha256 = ruth_api::zip_sha256(&zip);
        (zip, sha256)
    };
    let dest = PathBuf::from(&input.dest_path);
    if dest.exists() && !input.overwrite {
        return Err(ApiError::coded(
            "export_exists",
            format!("{} already exists. Confirm to replace it.", dest.display()),
        ));
    }
    write_zip_atomic(&dest, &zip)?;
    Ok(DeliveryExportSaveDto {
        delivery_id: input.delivery_id,
        path: dest.to_string_lossy().to_string(),
        bytes: zip.len() as u64,
        sha256,
    })
}
