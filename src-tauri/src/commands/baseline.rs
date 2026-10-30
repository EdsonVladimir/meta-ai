//! Baseline and export commands: thin wrappers over `ruth-api`.
//!
//! Preparing and previewing are pure queries. Creating the baseline uses
//! the API's atomic path (validate, persist domain+metadata, publish).
//! Saving the ZIP writes through a temp file and publishes with a rename:
//! a partial file never stands as a successful delivery, and cancelling the
//! dialog (which lives in the frontend) never even reaches this command.

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, BaselineCreateInput, BaselineDto, BaselineGetInput,
    BaselineListInput, BaselinePrepareInput, BaselinePreviewDto, BaselineSummaryDto,
    ExportPreviewDto, ExportPreviewInput, ExportSaveDto, ExportSaveInput,
};

use super::{lock, ready};
use crate::state::AppState;

#[tauri::command]
pub fn core_prepare_baseline(
    state: State<AppState>,
    input: BaselinePrepareInput,
) -> Result<BaselinePreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::prepare_baseline(ready.store, input)
}

#[tauri::command]
pub fn core_create_baseline(
    state: State<AppState>,
    input: BaselineCreateInput,
) -> Result<BaselineDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::create_baseline(
        ready.store,
        ready.ids,
        ready.baseline_meta,
        ready.db,
        input,
        &now_utc_iso8601(),
    )
}

#[tauri::command]
pub fn core_get_baseline(
    state: State<AppState>,
    input: BaselineGetInput,
) -> Result<BaselineDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::get_baseline(
        ready.store,
        ready.baseline_meta,
        &input.project_id,
        &input.baseline_id,
    )
}

#[tauri::command]
pub fn core_list_baselines(
    state: State<AppState>,
    input: BaselineListInput,
) -> Result<Vec<BaselineSummaryDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_baselines(ready.store, ready.baseline_meta, &input.project_id)
}

#[tauri::command]
pub fn core_export_preview(
    state: State<AppState>,
    input: ExportPreviewInput,
) -> Result<ExportPreviewDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::export_preview(
        ready.store,
        ready.baseline_meta,
        &input.project_id,
        &input.baseline_id,
    )
}

pub(super) fn invalid_path(message: impl Into<String>) -> ApiError {
    ApiError::coded("export_invalid_path", message)
}

/// Writes the ZIP next to the destination with a temp name and publishes
/// it with an atomic rename. On any failure it cleans the temp: the
/// destination keeps its previous content or does not exist. Shared with
/// work deliveries: the same safe saving for both kinds.
pub(super) fn write_zip_atomic(dest: &Path, zip: &[u8]) -> Result<(), ApiError> {
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            invalid_path("The destination points to no valid folder. Pick another destination.")
        })?;
    if !parent.is_dir() {
        return Err(invalid_path(format!(
            "Folder {} does not exist or is not accessible.",
            parent.display()
        )));
    }
    let name = dest
        .file_name()
        .ok_or_else(|| invalid_path("The destination has no valid file name."))?;
    let mut temp_name = OsString::from(name);
    temp_name.push(format!(".ruth-part-{}", std::process::id()));
    let temp: PathBuf = parent.join(temp_name);
    let failed = |temp: &Path, message: String| {
        let _ = std::fs::remove_file(temp);
        ApiError::coded("export_failed", message)
    };
    let mut file = std::fs::File::create(&temp)
        .map_err(|e| failed(&temp, format!("Could not create the temp file: {e}")))?;
    file.write_all(zip)
        .map_err(|e| failed(&temp, format!("Could not write the ZIP: {e}")))?;
    file.sync_all()
        .map_err(|e| failed(&temp, format!("Could not flush the ZIP: {e}")))?;
    drop(file);
    std::fs::rename(&temp, dest)
        .map_err(|e| failed(&temp, format!("Could not publish the ZIP: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn core_export_save(
    state: State<AppState>,
    input: ExportSaveInput,
) -> Result<ExportSaveDto, ApiError> {
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
        let files = ruth_api::build_export_files(
            ready.store,
            ready.baseline_meta,
            &input.project_id,
            &input.baseline_id,
        )?;
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
    Ok(ExportSaveDto {
        baseline_id: input.baseline_id,
        path: dest.to_string_lossy().to_string(),
        bytes: zip.len() as u64,
        sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ruth-export-save-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("folder");
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("read")
            .map(|e| e.expect("entry").file_name().to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn atomic_write_publishes_complete_file_without_temp_leftovers() {
        let dir = scratch("ok");
        let dest = dir.join("delivery.zip");
        write_zip_atomic(&dest, b"PK-fake").expect("save");
        assert_eq!(std::fs::read(&dest).expect("read"), b"PK-fake");
        assert_eq!(leftovers(&dir), vec!["delivery.zip".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_parent_writes_nothing() {
        let dir = scratch("no-parent");
        let dest = dir.join("missing").join("delivery.zip");
        let err = write_zip_atomic(&dest, b"PK-fake").expect_err("no folder");
        assert_eq!(err.kind, "export_invalid_path");
        assert!(!dest.exists());
        assert!(leftovers(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unwritable_dir_fails_without_partial_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("no-permission");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).expect("lock down");
        let dest = dir.join("delivery.zip");
        let err = write_zip_atomic(&dest, b"PK-fake").expect_err("no write");
        assert_eq!(err.kind, "export_failed");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("open");
        assert!(!dest.exists());
        assert!(leftovers(&dir).is_empty(), "no abandoned temp files");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
