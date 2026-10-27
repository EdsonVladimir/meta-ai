//! Comandos de generación asistida (hito 5).
//!
//! - `core_generation_context`: vista previa del contexto (sin red).
//! - `core_propose_requirements`: genera con Meta y registra. La red ocurre
//!   SIN bloqueos: foto del contexto, suelta, red, y registro posterior. Una
//!   sola generación simultánea por módulo.
//! - `core_list_generations`, `core_accept_proposal`, `core_discard_proposal`:
//!   envoltorios finos sobre `ruth-api`, con bloqueos cortos.

use tauri::State;

use ruth_api::{
    now_utc_iso8601, AcceptProposalInput, ApiError, DiscardProposalInput, GenerationContextInput,
    GenerationContextPreview, GenerationDto, ListGenerationsInput, RecordInput, RequirementDetail,
};

use super::{lock, mark_inflight, ready, InflightGuard};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeInput {
    pub project_id: String,
    pub module_id: String,
    pub description: String,
}

#[tauri::command]
pub fn core_generation_context(
    state: State<AppState>,
    input: GenerationContextInput,
) -> Result<Vec<GenerationContextPreview>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::context_preview(ready.store, input)
}

#[tauri::command]
pub fn core_list_generations(
    state: State<AppState>,
    input: ListGenerationsInput,
) -> Result<Vec<GenerationDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_generations(ready.store, ready.log, input)
}

#[tauri::command]
pub fn core_accept_proposal(
    state: State<AppState>,
    input: AcceptProposalInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::accept_proposal(ready.store, ready.ids, ready.log, ready.db, input)
}

#[tauri::command]
pub fn core_discard_proposal(
    state: State<AppState>,
    input: DiscardProposalInput,
) -> Result<(), ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::discard_proposal(ready.log, ready.db, input)
}

#[tauri::command]
pub async fn core_propose_requirements(
    state: State<'_, AppState>,
    input: ProposeInput,
) -> Result<GenerationDto, ApiError> {
    let description = ruth_api::validate_description(&input.description)?;
    // Bloqueo corto: foto del contexto y marca de generación en curso.
    let context = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let context = ruth_api::snapshot_context(ready.store, &input.project_id, &input.module_id)?;
        mark_inflight(&state.inflight, &input.module_id)?;
        context
    };
    let _guard = InflightGuard::hold(&state.inflight, input.module_id.clone());

    // Sin bloqueos durante la red: ni SQLite ni el estado del proyecto.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::generation::build_generation_input(&description, &context);
    let result = ruth_meta::generation::generate(&config, &prompt)
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
    ruth_api::record_generation(
        ready.store,
        ready.ids,
        ready.log,
        ready.db,
        RecordInput {
            project_id: input.project_id,
            module_id: input.module_id,
            model: result.model,
            description,
            context,
            validated: ruth_meta::generation::ValidatedGeneration {
                proposals: result.proposals,
                questions: result.questions,
            },
            input_tokens,
            output_tokens,
            total_tokens,
            created_at: now_utc_iso8601(),
        },
    )
}
