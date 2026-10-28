//! Comandos de baselines y exportación: envoltorios finos sobre `ruth-api`.
//!
//! Preparar y previsualizar son consultas puras. Crear la baseline usa el
//! camino atómico de la API (validar, persistir dominio+metadatos, publicar).
//! Guardar el ZIP escribe mediante un temporal y lo publica con un renombre:
//! nunca queda un archivo parcial como entrega exitosa, y cancelar el diálogo
//! (que vive en el frontend) ni siquiera llega a este comando.

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

/// Escribe el ZIP junto al destino con un nombre temporal y lo publica con
/// un renombre atómico. Ante cualquier fallo limpia el temporal: el destino
/// conserva su contenido anterior o no existe. Compartida con las entregas
/// de trabajo: el mismo guardado seguro para ambas clases.
pub(super) fn write_zip_atomic(dest: &Path, zip: &[u8]) -> Result<(), ApiError> {
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| {
            invalid_path("El destino no indica una carpeta válida. Elige otro destino.")
        })?;
    if !parent.is_dir() {
        return Err(invalid_path(format!(
            "La carpeta {} no existe o no es accesible.",
            parent.display()
        )));
    }
    let name = dest
        .file_name()
        .ok_or_else(|| invalid_path("El destino no tiene un nombre de archivo válido."))?;
    let mut temp_name = OsString::from(name);
    temp_name.push(format!(".ruth-part-{}", std::process::id()));
    let temp: PathBuf = parent.join(temp_name);
    let failed = |temp: &Path, message: String| {
        let _ = std::fs::remove_file(temp);
        ApiError::coded("export_failed", message)
    };
    let mut file = std::fs::File::create(&temp)
        .map_err(|e| failed(&temp, format!("No se pudo crear el temporal: {e}")))?;
    file.write_all(zip)
        .map_err(|e| failed(&temp, format!("No se pudo escribir el ZIP: {e}")))?;
    file.sync_all()
        .map_err(|e| failed(&temp, format!("No se pudo confirmar el ZIP: {e}")))?;
    drop(file);
    std::fs::rename(&temp, dest)
        .map_err(|e| failed(&temp, format!("No se pudo publicar el ZIP: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn core_export_save(
    state: State<AppState>,
    input: ExportSaveInput,
) -> Result<ExportSaveDto, ApiError> {
    if input.dest_path.trim().is_empty() {
        return Err(invalid_path(
            "Sin destino no hay guardado: vuelve a elegir dónde guardar el ZIP.",
        ));
    }
    // Bloqueo corto: el paquete se construye desde la memoria y el bloqueo
    // se suelta antes de tocar el disco.
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
            format!("Ya existe {}. Confirma para reemplazarlo.", dest.display()),
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
        std::fs::create_dir_all(&dir).expect("carpeta");
        dir
    }

    fn leftovers(dir: &Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .expect("leer")
            .map(|e| {
                e.expect("entrada")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn atomic_write_publishes_complete_file_without_temp_leftovers() {
        let dir = scratch("ok");
        let dest = dir.join("entrega.zip");
        write_zip_atomic(&dest, b"PK-falso").expect("guardar");
        assert_eq!(std::fs::read(&dest).expect("leer"), b"PK-falso");
        assert_eq!(leftovers(&dir), vec!["entrega.zip".to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_parent_writes_nothing() {
        let dir = scratch("sin-padre");
        let dest = dir.join("no-existe").join("entrega.zip");
        let err = write_zip_atomic(&dest, b"PK-falso").expect_err("sin carpeta");
        assert_eq!(err.kind, "export_invalid_path");
        assert!(!dest.exists());
        assert!(leftovers(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn unwritable_dir_fails_without_partial_file() {
        use std::os::unix::fs::PermissionsExt;

        let dir = scratch("sin-permiso");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).expect("bloquear");
        let dest = dir.join("entrega.zip");
        let err = write_zip_atomic(&dest, b"PK-falso").expect_err("sin escritura");
        assert_eq!(err.kind, "export_failed");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).expect("abrir");
        assert!(!dest.exists());
        assert!(leftovers(&dir).is_empty(), "sin temporales abandonados");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
