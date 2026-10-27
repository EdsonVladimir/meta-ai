//! Ruth IDE: comandos Tauri.
//!
//! - `commands::meta`: prueba de conexión con Meta (hito 1).
//! - `commands::requirements`: requisitos sobre `ruth-core` con persistencia
//!   local (hitos 3–4).
//! - `commands::proposals`: generación asistida con Meta (hito 5).

mod commands;
mod state;

use tauri::Manager;

use commands::design::{
    core_accept_design, core_approve_design, core_design_context, core_discard_design,
    core_generate_design, core_list_artifacts, core_list_designs, core_validate_design,
};
use commands::meta::{meta_status, test_meta_connection, TestLock};
use commands::proposals::{
    core_accept_proposal, core_discard_proposal, core_generation_context, core_list_generations,
    core_propose_requirements,
};
use commands::requirements::{
    core_approve_version, core_create_module, core_create_project, core_create_requirement,
    core_get_requirement, core_list_modules, core_list_projects, core_list_requirements,
    core_save_version, core_status,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TestLock::default())
        .setup(|app| {
            // La base vive en el directorio de datos de la aplicación
            // (p. ej. ~/.local/share/ide.ruth.app/ruth.db en Linux), nunca en
            // el repositorio ni en rutas fijas. Si no puede abrirse, la app
            // arranca igual en modo degradado: la interfaz muestra el error
            // recuperable sin borrar ni reemplazar nada.
            let path = app.path().app_data_dir().map(|dir| dir.join("ruth.db"));
            let state = match path {
                Ok(path) => match ruth_store::DbActor::spawn(&path) {
                    Ok((db, loaded)) => AppState::ready(
                        path,
                        loaded.store,
                        ruth_api::IdGen::restore(loaded.next_id),
                        db,
                        loaded.proposals,
                        loaded.designs,
                    ),
                    Err(err) => AppState::unavailable(path, err.to_string()),
                },
                Err(err) => AppState::unavailable(
                    std::path::PathBuf::from("desconocida"),
                    format!("no se pudo resolver el directorio de datos: {err}"),
                ),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            meta_status,
            test_meta_connection,
            core_status,
            core_create_project,
            core_list_projects,
            core_create_module,
            core_list_modules,
            core_create_requirement,
            core_list_requirements,
            core_get_requirement,
            core_save_version,
            core_approve_version,
            core_generation_context,
            core_propose_requirements,
            core_list_generations,
            core_accept_proposal,
            core_discard_proposal,
            core_design_context,
            core_generate_design,
            core_list_designs,
            core_validate_design,
            core_accept_design,
            core_discard_design,
            core_approve_design,
            core_list_artifacts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ruth IDE");
}
