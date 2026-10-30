//! Requirement-linked design commands (milestones 6 and 8).
//!
//! - `core_design_context`: the module's requirements with their revision (no network).
//! - `core_generate_design`: generates with Meta and records. The network runs WITHOUT
//!   locks: saved-context snapshot, release, network, then later recording.
//!   Shares the one-inflight-generation-per-module mark.
//! - `core_update_context`: update-snapshot preview (without
//!   network): target, sources with both versions, source change, paths
//!   and blocks.
//! - `core_propose_design_update`: proposes the tweak of ONE pending design
//!   with Meta and records it in the same cycle (same table, same
//!   acceptance). The network runs without locks, as in creation.
//! - `core_design_diff`: structural diff between two specs (pure,
//!   no network or domain).
//! - `core_save_design_version`: manual revision from the visual editor as
//!   a new version with human provenance, with layout in the same
//!   transaction. `core_design_layout`: tolerant layout read.
//! - `core_list_designs`, `core_validate_design`, `core_accept_design`,
//!   `core_discard_design`, `core_approve_design`, `core_list_artifacts`:
//!   thin wrappers over `ruth-api`, with short locks.

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
    // Short lock: authoritative snapshot (with locks) and mark.
    let snapshot = {
        let mut guard = lock(&state.inner)?;
        let ready = ready(&mut guard)?;
        let snapshot = ruth_api::snapshot_update_context(ready.store, input.clone())?;
        mark_inflight(&state.inflight, &snapshot.module_id)?;
        snapshot
    };
    let _guard = InflightGuard::hold(&state.inflight, snapshot.module_id.clone());

    // No locks during the network: neither SQLite nor the project state.
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

    // Short lock: record what validated (or nothing, if the network failed). If the
    // target or a source moved during the network, the proposal is born
    // stale (computed when served) and its acceptance is blocked.
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
    // Short lock: approved-context snapshot and generation mark.
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

    // No locks during the network: neither SQLite nor the project state.
    let config = ruth_meta::MetaConfig::from_env().map_err(ApiError::from_meta)?;
    let prompt = ruth_meta::design::build_design_input(kind, &context);
    let allowed: Vec<String> = context.iter().map(|c| c.artifact_id.clone()).collect();
    let result = ruth_meta::design::generate_design(&config, kind, &prompt, &allowed)
        .await
        .map_err(ApiError::from_meta)?;

    // Short lock: record what validated (or nothing, if the network failed).
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
