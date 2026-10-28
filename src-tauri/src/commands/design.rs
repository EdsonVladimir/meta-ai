//! Comandos de diseño vinculado a requisitos (hitos 6 y 8).
//!
//! - `core_design_context`: requisitos del módulo con su revisión (sin red).
//! - `core_generate_design`: genera con Meta y registra. La red ocurre SIN
//!   bloqueos: foto del contexto guardado, suelta, red, y registro posterior.
//!   Comparte la marca de una generación simultánea por módulo.
//! - `core_update_context`: vista previa del snapshot de actualización (sin
//!   red): objetivo, fuentes con sus dos versiones, cambio origen, caminos
//!   y bloqueos.
//! - `core_propose_design_update`: propone el ajuste de UN diseño pendiente
//!   con Meta y lo registra en el mismo ciclo (misma tabla, misma
//!   aceptación). La red ocurre sin bloqueos, como en la creación.
//! - `core_design_diff`: diff estructural entre dos especificaciones (puro,
//!   sin red ni dominio).
//! - `core_save_design_version`: revisión manual del editor visual como
//!   versión nueva con procedencia humana, con disposición en la misma
//!   transacción. `core_design_layout`: lectura tolerante de la disposición.
//! - `core_list_designs`, `core_validate_design`, `core_accept_design`,
//!   `core_discard_design`, `core_approve_design`, `core_list_artifacts`:
//!   envoltorios finos sobre `ruth-api`, con bloqueos cortos.

use tauri::State;

use ruth_api::{
    now_utc_iso8601, AcceptDesignInput, ApiError, ApproveVersionInput, ArtifactDto,
    DesignContextInput, DesignContextPreview, DesignDiffDto, DesignDiffInput, DesignGenerationDto,
    DesignLayoutDto, DiscardDesignInput, GetDesignLayoutInput, ListArtifactsInput,
    ListDesignsInput, RecordDesignInput, RequirementDetail, SaveDesignLayoutInput,
    SaveDesignVersionInput, UpdateContextInput, UpdateContextPreview, UpdateTarget,
    ValidateDesignInput, ValidatedDesignDto,
};

use super::{lock, mark_inflight, ready, InflightGuard};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateDesignInput {
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    pub requirement_ids: Vec<String>,
}

#[tauri::command]
pub fn core_design_context(
    state: State<AppState>,
    input: DesignContextInput,
) -> Result<Vec<DesignContextPreview>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::design_context_preview(ready.store, input)
}

#[tauri::command]
pub fn core_list_artifacts(
    state: State<AppState>,
    input: ListArtifactsInput,
) -> Result<Vec<ArtifactDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_artifacts(ready.store, input)
}

#[tauri::command]
pub fn core_list_designs(
    state: State<AppState>,
    input: ListDesignsInput,
) -> Result<Vec<DesignGenerationDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_designs(ready.store, ready.designs, input)
}

#[tauri::command]
pub fn core_validate_design(
    state: State<AppState>,
    input: ValidateDesignInput,
) -> Result<ValidatedDesignDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::validate_design(ready.store, ready.designs, input)
}

#[tauri::command]
pub fn core_accept_design(
    state: State<AppState>,
    input: AcceptDesignInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::accept_design(ready.store, ready.ids, ready.designs, ready.db, input)
}

#[tauri::command]
pub fn core_discard_design(
    state: State<AppState>,
    input: DiscardDesignInput,
) -> Result<(), ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::discard_design(ready.designs, ready.db, input)
}

#[tauri::command]
pub fn core_approve_design(
    state: State<AppState>,
    input: ApproveVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::transact(ready.store, ready.ids, ready.db, |s, _| {
        ruth_api::approve_design_version(s, input, &now_utc_iso8601())
    })
}

#[tauri::command]
pub fn core_update_context(
    state: State<AppState>,
    input: UpdateContextInput,
) -> Result<UpdateContextPreview, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::update_context_preview(ready.store, input)
}

#[tauri::command]
pub fn core_design_diff(input: DesignDiffInput) -> Result<DesignDiffDto, ApiError> {
    ruth_api::design_diff(input)
}

#[tauri::command]
pub fn core_save_design_version(
    state: State<AppState>,
    input: SaveDesignVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::save_design_version(ready.store, ready.ids, ready.layouts, ready.db, input)
}

#[tauri::command]
pub fn core_design_layout(
    state: State<AppState>,
    input: GetDesignLayoutInput,
) -> Result<DesignLayoutDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    Ok(ruth_api::design_layout(ready.layouts, input))
}

#[tauri::command]
pub fn core_save_design_layout(
    state: State<AppState>,
    input: SaveDesignLayoutInput,
) -> Result<(), ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::save_design_layout_only(ready.store, ready.layouts, ready.db, input)
}

#[tauri::command]
pub async fn core_propose_design_update(
    state: State<'_, AppState>,
    input: UpdateContextInput,
) -> Result<DesignGenerationDto, ApiError> {
    // Bloqueo corto: snapshot autoritativo (con bloqueos) y marca.
    let snapshot = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let snapshot = ruth_api::snapshot_update_context(ready.store, input.clone())?;
        mark_inflight(&state.inflight, &snapshot.module_id)?;
        snapshot
    };
    let _guard = InflightGuard::hold(&state.inflight, snapshot.module_id.clone());

    // Sin bloqueos durante la red: ni SQLite ni el estado del proyecto.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::design::build_update_input(
        snapshot.kind,
        &snapshot.current_spec,
        &snapshot.sources,
        snapshot.origin.as_ref(),
        &snapshot.paths,
    );
    let allowed: Vec<String> = snapshot
        .context
        .iter()
        .map(|c| c.artifact_id.clone())
        .collect();
    let result = ruth_meta::design::generate_design(&config, snapshot.kind, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Bloqueo corto: registrar lo validado (o nada, si la red falló). Si el
    // objetivo o una fuente se movió durante la red, la propuesta nace
    // desactualizada (se calcula al servir) y su aceptación se bloquea.
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let (input_tokens, output_tokens, total_tokens) = match &result.usage {
        Some(usage) => (
            Some(usage.input_tokens),
            Some(usage.output_tokens),
            Some(usage.total_tokens),
        ),
        None => (None, None, None),
    };
    ruth_api::record_design_generation(
        ready.store,
        ready.ids,
        ready.designs,
        ready.db,
        RecordDesignInput {
            project_id: input.project_id,
            module_id: snapshot.module_id,
            kind: snapshot.kind,
            model: result.model,
            context: snapshot.context,
            validated: result.design,
            input_tokens,
            output_tokens,
            total_tokens,
            created_at: now_utc_iso8601(),
            target: Some(UpdateTarget {
                artifact_id: snapshot.target_artifact_id,
                version_id: snapshot.target_version_id,
            }),
        },
    )
}

#[tauri::command]
pub async fn core_generate_design(
    state: State<'_, AppState>,
    input: GenerateDesignInput,
) -> Result<DesignGenerationDto, ApiError> {
    let kind = ruth_meta::design::DesignKind::parse(&input.kind).map_err(ApiError::from_meta)?;
    // Bloqueo corto: foto del contexto aprobado y marca de generación.
    let context = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let context = ruth_api::snapshot_design_context(
            ready.store,
            &input.project_id,
            &input.module_id,
            &input.requirement_ids,
        )?;
        mark_inflight(&state.inflight, &input.module_id)?;
        context
    };
    let _guard = InflightGuard::hold(&state.inflight, input.module_id.clone());

    // Sin bloqueos durante la red: ni SQLite ni el estado del proyecto.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::design::build_design_input(kind, &context);
    let allowed: Vec<String> = context.iter().map(|c| c.artifact_id.clone()).collect();
    let result = ruth_meta::design::generate_design(&config, kind, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Bloqueo corto: registrar lo validado (o nada, si la red falló).
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    let (input_tokens, output_tokens, total_tokens) = match &result.usage {
        Some(usage) => (
            Some(usage.input_tokens),
            Some(usage.output_tokens),
            Some(usage.total_tokens),
        ),
        None => (None, None, None),
    };
    ruth_api::record_design_generation(
        ready.store,
        ready.ids,
        ready.designs,
        ready.db,
        RecordDesignInput {
            project_id: input.project_id,
            module_id: input.module_id,
            kind,
            model: result.model,
            context,
            validated: result.design,
            input_tokens,
            output_tokens,
            total_tokens,
            created_at: now_utc_iso8601(),
            target: None,
        },
    )
}
