//! Versioned mockup commands (living design, stage B).
//!
//! - `core_create_mockup`: new artifact with its first version drawn by
//!   the person, validated in Rust and with initial layout, in one
//!   transaction.
//! - `core_save_mockup_version`: manual revision as a new version of
//!   the SAME artifact, with current sources and expected version.
//! - `core_mockup_context`: selectable requirements and mockups (no network).
//! - `core_generate_design_from_mockups`: generates a flow or ER with Meta
//!   from saved mockups and requirements. The network runs WITHOUT locks and
//!   recording uses the same design cycle (same table, same
//!   acceptance): the mockup-bearing template stays in `template_version`.
//! - `core_propose_mockups`: proposes screens with Meta from saved
//!   requirements (selection or whole module). The network runs WITHOUT locks;
//!   recording uses the screens' own cycle (individual acceptance
//!   as a new mockup, idempotent).
//! - `core_list_mockup_generations`, `core_accept_mockup_screen`,
//!   `core_discard_mockup_screen`: thin wrappers over `ruth-api`.
//! - Layout is read and saved with `core_design_layout` and
//!   `core_save_design_layout` (generic per artifact and version).
//! - Approval uses `core_approve_design` (revalidates the mockup in Rust).

use tauri::State;

use ruth_api::{
    now_utc_iso8601, AcceptMockupScreenInput, ApiError, CreateMockupInput, DesignContextInput,
    DesignGenerationDto, DiscardMockupScreenInput, ListMockupGenerationsInput,
    MockupContextPreview, MockupGenerationDto, RecordDesignInput, RecordMockupInput,
    RequirementDetail, SaveMockupVersionInput, ValidateMockupInput, ValidatedMockupDto,
};

use super::{lock, mark_inflight, ready, InflightGuard};
use crate::state::AppState;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateFromMockupsInput {
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    pub requirement_ids: Vec<String>,
    pub mockup_ids: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockupSourcesInput {
    pub project_id: String,
    pub artifact_id: String,
}

#[tauri::command]
pub fn core_create_mockup(
    state: State<AppState>,
    input: CreateMockupInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::create_mockup(ready.store, ready.ids, ready.layouts, ready.db, input)
}

#[tauri::command]
pub fn core_save_mockup_version(
    state: State<AppState>,
    input: SaveMockupVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::save_mockup_version(ready.store, ready.ids, ready.layouts, ready.db, input)
}

#[tauri::command]
pub fn core_mockup_context(
    state: State<AppState>,
    input: DesignContextInput,
) -> Result<MockupContextPreview, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::mockup_context_preview(ready.store, input)
}

#[tauri::command]
pub fn core_validate_mockup(input: ValidateMockupInput) -> Result<ValidatedMockupDto, ApiError> {
    // Pure: validates the JSON against its quotes, without touching state or network.
    ruth_api::validate_mockup_stored(input)
}

#[tauri::command]
pub fn core_mockup_sources(
    state: State<AppState>,
    input: MockupSourcesInput,
) -> Result<Vec<ruth_api::UpdateSourceDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::mockup_sources(ready.store, &input.project_id, &input.artifact_id)
}

#[tauri::command]
pub async fn core_generate_design_from_mockups(
    state: State<'_, AppState>,
    input: GenerateFromMockupsInput,
) -> Result<DesignGenerationDto, ApiError> {
    let kind = ruth_meta::design::DesignKind::parse(&input.kind).map_err(ApiError::from_meta)?;
    // Short lock: saved-context snapshot and generation mark.
    let snapshot = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let snapshot = ruth_api::snapshot_mockup_context(
            ready.store,
            &input.project_id,
            &input.module_id,
            &input.requirement_ids,
            &input.mockup_ids,
        )?;
        mark_inflight(&state.inflight, &input.module_id)?;
        snapshot
    };
    let _guard = InflightGuard::hold(&state.inflight, input.module_id.clone());

    // No locks during the network: neither SQLite nor the project state.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::design::build_mockup_design_input(
        kind,
        &snapshot.requirements,
        &snapshot.mockups,
    );
    let mut allowed: Vec<String> = snapshot
        .requirements
        .iter()
        .chain(snapshot.mockups.iter())
        .map(|c| c.artifact_id.clone())
        .collect();
    allowed.sort();
    allowed.dedup();
    let result = ruth_meta::design::generate_design(&config, kind, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Short lock: record what validated (or nothing, if the network failed). If
    // a source moved during the network, the proposal is born stale
    // (computed when served) and its acceptance is blocked.
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
    let mut context = snapshot.requirements;
    context.extend(snapshot.mockups);
    context.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
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

/// Input of 'Propose screens': empty selection = whole module.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposeMockupsInput {
    pub project_id: String,
    pub module_id: String,
    pub requirement_ids: Vec<String>,
}

/// Proposes screens with Meta from saved requirements. Without an
/// approval barrier: generates from saved versions. One generation per
/// module, no locks during the network; each screen was already validated
/// in Rust before recording.
#[tauri::command]
pub async fn core_propose_mockups(
    state: State<'_, AppState>,
    input: ProposeMockupsInput,
) -> Result<MockupGenerationDto, ApiError> {
    // Short lock: saved-context snapshot and generation mark.
    let context = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let context = ruth_api::snapshot_screen_context(
            ready.store,
            &input.project_id,
            &input.module_id,
            &input.requirement_ids,
        )?;
        mark_inflight(&state.inflight, &input.module_id)?;
        context
    };
    let _guard = InflightGuard::hold(&state.inflight, input.module_id.clone());

    // No locks during the network: neither SQLite nor the project state.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::mockup::build_mockup_generation_input(&context);
    let mut allowed: Vec<String> = context.iter().map(|c| c.artifact_id.clone()).collect();
    allowed.sort();
    allowed.dedup();
    let result = ruth_meta::mockup::generate_mockups(&config, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Short lock: record what validated (or nothing, if the network failed). If
    // a source moved during the network, the proposal is born stale
    // (computed when served) and its acceptance is blocked.
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
    ruth_api::record_mockup_generation(
        ready.store,
        ready.ids,
        ready.mockups,
        ready.db,
        RecordMockupInput {
            project_id: input.project_id,
            module_id: input.module_id,
            model: result.model,
            context,
            validated: ruth_meta::mockup::ValidatedMockupGeneration {
                screens: result.screens,
                questions: result.questions,
            },
            input_tokens,
            output_tokens,
            total_tokens,
            created_at: now_utc_iso8601(),
        },
    )
}

/// A module's screen generations (thin wrapper, no network).
#[tauri::command]
pub fn core_list_mockup_generations(
    state: State<'_, AppState>,
    input: ListMockupGenerationsInput,
) -> Result<Vec<MockupGenerationDto>, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::list_mockup_generations(ready.store, ready.mockups, input)
}

/// Takes ONE screen in as a new mockup (thin wrapper, no network).
#[tauri::command]
pub fn core_accept_mockup_screen(
    state: State<'_, AppState>,
    input: AcceptMockupScreenInput,
) -> Result<RequirementDetail, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::accept_mockup_screen(ready.store, ready.ids, ready.mockups, ready.db, input)
}

/// Discards a pending screen (thin wrapper, no network).
#[tauri::command]
pub fn core_discard_mockup_screen(
    state: State<'_, AppState>,
    input: DiscardMockupScreenInput,
) -> Result<(), ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::discard_mockup_screen(ready.mockups, ready.db, input)
}
