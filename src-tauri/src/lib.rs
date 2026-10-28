//! Ruth IDE: comandos Tauri.
//!
//! - `commands::meta`: prueba de conexión con Meta (hito 1).
//! - `commands::requirements`: requisitos sobre `ruth-core` con persistencia
//!   local (hitos 3–4).
//! - `commands::proposals`: generación asistida con Meta (hito 5).
//! - `commands::design`: diseño vinculado a requisitos (hito 6) y
//!   propuestas de actualización de diseños (hito 8).
//! - `commands::impact`: consulta de impacto sobre el núcleo (hito 7).

mod commands;
mod state;

use tauri::{Emitter, Manager, WindowEvent};

use commands::archive::{
    core_archive_module, core_archive_preview, core_archive_requirement, core_delete_module,
    core_delete_requirement, core_restore_module, core_restore_requirement,
};
use commands::baseline::{
    core_create_baseline, core_export_preview, core_export_save, core_get_baseline,
    core_list_baselines, core_prepare_baseline,
};
use commands::delivery::{
    core_create_delivery, core_export_delivery_preview, core_export_delivery_save,
    core_get_delivery, core_list_deliveries, core_prepare_delivery,
};
use commands::design::{
    core_accept_design, core_approve_design, core_design_context, core_design_diff,
    core_design_layout, core_discard_design, core_generate_design, core_list_artifacts,
    core_list_designs, core_propose_design_update, core_save_design_layout,
    core_save_design_version, core_update_context, core_validate_design,
};
use commands::impact::core_impact_report;
use commands::meta::{meta_status, test_meta_connection, TestLock};
use commands::mockup::{
    core_create_mockup, core_generate_design_from_mockups, core_mockup_context,
    core_mockup_sources, core_save_mockup_version, core_validate_mockup,
};
use commands::proposals::{
    core_accept_proposal, core_discard_proposal, core_generation_context, core_list_generations,
    core_propose_requirements,
};
use commands::rename::{
    core_rename_design, core_rename_module, core_rename_project, core_rename_requirement,
};
use commands::requirements::{
    core_approve_version, core_create_module, core_create_project, core_create_requirement,
    core_get_requirement, core_list_modules, core_list_projects, core_list_requirements,
    core_save_version, core_status,
};
use commands::terminal::{
    term_close, term_create, term_list, term_quit_app, term_resize, term_write,
    CloseRequestedPayload, TerminalState,
};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
                        loaded.baseline_meta,
                        loaded.layouts,
                    ),
                    Err(err) => AppState::unavailable(path, err.to_string()),
                },
                Err(err) => AppState::unavailable(
                    std::path::PathBuf::from("desconocida"),
                    format!("no se pudo resolver el directorio de datos: {err}"),
                ),
            };
            app.manage(state);
            app.manage(TerminalState::new(app.handle()));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Cerrar con terminales en marcha pide confirmación: se frena
            // aquí y la interfaz decide (ver `term_quit_app`). Sin
            // sesiones en marcha, el cierre sigue su curso normal.
            if let WindowEvent::CloseRequested { api, .. } = event {
                let running = window.state::<TerminalState>().running_count();
                if running > 0 {
                    api.prevent_close();
                    let _ = window.emit(
                        "ruth-terminal-close-requested",
                        CloseRequestedPayload { running },
                    );
                }
            }
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
            core_impact_report,
            core_update_context,
            core_propose_design_update,
            core_design_diff,
            core_save_design_version,
            core_design_layout,
            core_save_design_layout,
            core_create_mockup,
            core_save_mockup_version,
            core_mockup_context,
            core_mockup_sources,
            core_generate_design_from_mockups,
            core_validate_mockup,
            core_prepare_baseline,
            core_create_baseline,
            core_get_baseline,
            core_list_baselines,
            core_export_preview,
            core_export_save,
            core_prepare_delivery,
            core_create_delivery,
            core_get_delivery,
            core_list_deliveries,
            core_export_delivery_preview,
            core_export_delivery_save,
            core_archive_preview,
            core_archive_module,
            core_restore_module,
            core_delete_module,
            core_archive_requirement,
            core_restore_requirement,
            core_delete_requirement,
            core_rename_project,
            core_rename_module,
            core_rename_requirement,
            core_rename_design,
            term_list,
            term_create,
            term_write,
            term_resize,
            term_close,
            term_quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ruth IDE");
}
