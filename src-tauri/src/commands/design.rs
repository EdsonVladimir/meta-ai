//! Comandos de diseño vinculado a requisitos (hito 6).
//!
//! - `core_design_context`: requisitos del módulo con aprobación (sin red).
//! - `core_generate_design`: genera con Meta y registra. La red ocurre SIN
//!   bloqueos: foto del contexto aprobado, suelta, red, y registro posterior.
//!   Comparte la marca de una generación simultánea por módulo.
//! - `core_list_designs`, `core_validate_design`, `core_accept_design`,
//!   `core_discard_design`, `core_approve_design`, `core_list_artifacts`:
//!   envoltorios finos sobre `ruth-api`, con bloqueos cortos.

use tauri::State;

use ruth_api::{
    now_utc_iso8601, AcceptDesignInput, ApiError, ApproveVersionInput, ArtifactDto,
    DesignContextInput, DesignContextPreview, DesignGenerationDto, DiscardDesignInput,
    ListArtifactsInput, ListDesignsInput, RecordDesignInput, RequirementDetail,
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
pub async fn core_generate_design(
    state: State<'_, AppState>,
    input: GenerateDesignInput,
) -> Result<DesignGenerationDto, ApiError> {
    let kind = ruth_meta::design::DesignKind::parse(&input.kind).map_err(ApiError::from_meta)?;
    // Bloqueo corto: foto del contexto aprobado y marca de generación.
    let context = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let context = ruth_api::snapshot_approved_context(
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
        },
    )
}
