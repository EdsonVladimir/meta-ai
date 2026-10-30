//! Ruth IDE: Tauri commands.
//!
//! - `commands::meta`: Meta connection test (milestone 1).
//! - `commands::requirements`: requirements over `ruth-core` with local
//!   persistence (milestones 3-4).
//! - `commands::proposals`: Meta-assisted generation (milestone 5).
//! - `commands::design`: requirement-linked design (milestone 6) and
//!   design update proposals (milestone 8).
//! - `commands::impact`: core impact query (milestone 7).

mod commands;
mod state;

use tauri::{Emitter, Manager, WindowEvent};

use commands::archive::{
    core_archive_module, core_archive_preview, core_archive_requirement, core_delete_module,
    core_delete_project, core_delete_requirement, core_restore_module, core_restore_requirement,
};
use commands::baseline::{
    core_create_baseline, core_export_preview, core_export_save, core_get_baseline,
    core_list_baselines, core_prepare_baseline,
};
use commands::code::{
    code_add_root, code_analyze_rust, code_list_dir, code_list_roots, code_read_file,
    code_remove_root, code_set_root_project, code_write_file,
};
use commands::code_links::{
    code_add_module_link, code_add_symbol_link, code_delete_snapshot, code_get_snapshot,
    code_list_links, code_list_snapshots, code_project_links, code_remove_link, code_save_snapshot,
    code_verify_snapshot,
};
use commands::codegen::{
    code_accept_file, code_discard_file, code_gen_context, code_generate, code_list_generations,
    code_mockup_screens,
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
    core_accept_mockup_screen, core_create_mockup, core_discard_mockup_screen,
    core_generate_design_from_mockups, core_list_mockup_generations, core_mockup_context,
    core_mockup_sources, core_propose_mockups, core_save_mockup_version, core_validate_mockup,
};
use commands::proposals::{
    core_accept_proposal, core_discard_proposal, core_generation_context, core_list_generations,
    core_propose_requirements,
};
use commands::recent::{recent_list, recent_remove, recent_touch};
use commands::rename::{
    core_rename_design, core_rename_module, core_rename_project, core_rename_requirement,
};
use commands::replicate::{code_replicate_execute, code_replicate_preview};
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
            // The database lives in the application data directory
            // (e.g. ~/.local/share/ide.ruth.app/ruth.db on Linux), never in
            // the repo or in fixed paths. If it cannot open, the app
            // still starts in degraded mode: the UI shows the recoverable
            // error without deleting or replacing anything.
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
                        loaded.mockups,
                        loaded.code_roots,
                        loaded.code_links,
                        loaded.snapshots,
                        loaded.codegen,
                        loaded.recents,
                    ),
                    Err(err) => AppState::unavailable(path, err.to_string()),
                },
                Err(err) => AppState::unavailable(
                    std::path::PathBuf::from("unknown"),
                    format!("could not resolve the data directory: {err}"),
                ),
            };
            app.manage(state);
            app.manage(TerminalState::new(app.handle()));
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing with running terminals asks for confirmation: it stops
            // here and the UI decides (see `term_quit_app`). Without
            // running sessions, closing proceeds normally.
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
            core_propose_mockups,
            core_list_mockup_generations,
            core_accept_mockup_screen,
            core_discard_mockup_screen,
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
            core_delete_project,
            core_archive_requirement,
            core_restore_requirement,
            core_delete_requirement,
            core_rename_project,
            core_rename_module,
            core_rename_requirement,
            core_rename_design,
            code_list_roots,
            code_add_root,
            code_remove_root,
            code_set_root_project,
            code_list_dir,
            code_read_file,
            code_write_file,
            code_analyze_rust,
            recent_list,
            recent_touch,
            recent_remove,
            code_add_module_link,
            code_add_symbol_link,
            code_remove_link,
            code_list_links,
            code_project_links,
            code_save_snapshot,
            code_list_snapshots,
            code_get_snapshot,
            code_delete_snapshot,
            code_verify_snapshot,
            code_gen_context,
            code_generate,
            code_list_generations,
            code_mockup_screens,
            code_replicate_preview,
            code_replicate_execute,
            code_accept_file,
            code_discard_file,
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
