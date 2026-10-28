//! Comandos de mockups versionados (diseño vivo, etapa B).
//!
//! - `core_create_mockup`: artefacto nuevo con su primera versión dibujada
//!   por la persona, validada en Rust y con disposición inicial, en una
//!   sola transacción.
//! - `core_save_mockup_version`: revisión manual como versión nueva del
//!   MISMO artefacto, con fuentes vigentes y versión esperada.
//! - `core_mockup_context`: requisitos y mockups seleccionables (sin red).
//! - `core_generate_design_from_mockups`: genera un flujo o ER con Meta
//!   desde mockups y requisitos guardados. La red ocurre SIN bloqueos y el
//!   registro usa el mismo ciclo de diseños (misma tabla, misma
//!   aceptación): la plantilla con mockups queda en `template_version`.
//! - La disposición se lee y guarda con `core_design_layout` y
//!   `core_save_design_layout` (genéricos por artefacto y versión).
//! - La aprobación usa `core_approve_design` (revalida el mockup en Rust).

use tauri::State;

use ruth_api::{
    now_utc_iso8601, ApiError, CreateMockupInput, DesignContextInput, DesignGenerationDto,
    MockupContextPreview, RecordDesignInput, RequirementDetail, SaveMockupVersionInput,
    ValidateMockupInput, ValidatedMockupDto,
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
    // Puro: valida el JSON contra sus citas, sin tocar el estado ni la red.
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
    // Bloqueo corto: foto del contexto guardado y marca de generación.
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

    // Sin bloqueos durante la red: ni SQLite ni el estado del proyecto.
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

    // Bloqueo corto: registrar lo validado (o nada, si la red falló). Si
    // una fuente se movió durante la red, la propuesta nace desactualizada
    // (se calcula al servir) y su aceptación se bloquea.
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
