//! Assisted-generation logic: context, recording, staleness,
//! acceptance and discard.
//!
//! No Tauri or network: takes the `Store`, the `ProposalLog`, the `IdGen`
//! and Meta's already validated result as inputs, so everything is testable
//! with a fake generator (tests build the output by hand). The
//! Tauri command only orchestrates: context snapshot, network off locks and
//! later recording.
//!
//! Rules:
//! - The consulted context creates NO business dependencies: accepting
//!   a proposal creates a sourceless requirement. Turning context into
//!   dependencies would invent relations and could introduce cycles.
//! - Staleness computes, never stores: a generation is stale when
//!   any context version is no longer current. Accepting a stale
//!   proposal is blocked.
//! - Accepting is atomic and idempotent: domain and state in one transaction;
//!   retrying returns the existing detail without duplicating anything.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactId, ArtifactType, Content, CoreError, ModuleId, ProjectId, VersionId,
};
use ruth_meta::generation::{
    GenerationContextItem, ValidatedGeneration, MAX_ACCEPTANCE_ITEMS, MAX_ASSUMPTION_ITEMS,
    MAX_DESCRIPTION_CHARS, MAX_ITEM_CHARS, MAX_PROPOSAL_CHARS, MAX_TITLE_CHARS, TEMPLATE_VERSION,
};
use ruth_store::{DbActor, ProposalLog, ProposalState, StoredGeneration, StoredProposal};

use crate::dto::{
    AcceptProposalInput, DiscardProposalInput, GenerationContextInput, GenerationContextPreview,
    GenerationDto, GetRequirementInput, ListGenerationsInput, ProposalDto, RequirementDetail,
    UsageDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::get_requirement;

/// Agent recorded as provenance of what a generation accepts.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Validates the module description before generating.
pub fn validate_description(description: &str) -> Result<String, ApiError> {
    let trimmed = description.trim();
    if trimmed.is_empty() {
        return Err(ApiError::coded(
            "empty_description",
            "Describe the module before proposing requirements.",
        ));
    }
    if trimmed.chars().count() > MAX_DESCRIPTION_CHARS {
        return Err(ApiError::coded(
            "description_too_long",
            format!("the description exceeds {MAX_DESCRIPTION_CHARS} characters"),
        ));
    }
    Ok(trimmed.to_string())
}

/// Context snapshot: exact current version of each module requirement,
/// ordered by artifact. Taken before the network call and recorded with
/// the generation to detect staleness later.
pub fn snapshot_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
) -> Result<Vec<GenerationContextItem>, ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    let module = ModuleId::new(module_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let Some(module_ref) = store.module(&module) else {
        return Err(CoreError::ModuleNotFound { module }.into());
    };
    if module_ref.archived() {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let mut items = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Requirement {
            continue;
        }
        // Archived ones are not sent as context: they are out of the work.
        if artifact.archived() {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        items.push(GenerationContextItem {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Context preview for the UI: what would be sent, without sending it.
pub fn context_preview(
    store: &Store,
    input: GenerationContextInput,
) -> Result<Vec<GenerationContextPreview>, ApiError> {
    Ok(
        snapshot_context(store, &input.project_id, &input.module_id)?
            .into_iter()
            .map(|item| {
                let chars = item.content.chars().count();
                // The current title is only preview presentation;
                // the recorded snapshot (exact versions) does not change.
                let title = ArtifactId::new(item.artifact_id.clone())
                    .ok()
                    .and_then(|id| store.artifact(&id))
                    .and_then(|a| a.title().map(str::to_string));
                GenerationContextPreview {
                    artifact_id: item.artifact_id,
                    version_id: item.version_id,
                    chars,
                    excerpt: excerpt(&item.content),
                    title,
                }
            })
            .collect(),
    )
}

fn excerpt(content: &str) -> String {
    const MAX: usize = 120;
    let flat: String = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let end = flat
        .char_indices()
        .nth(MAX)
        .map(|(i, _)| i)
        .unwrap_or(flat.len());
    format!("{}…", &flat[..end])
}

/// Input for recording a newly validated generation.
pub struct RecordInput {
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub description: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedGeneration,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
}

/// Records the generation on disk and memory. The definitive identifier
/// (`gen-N`) is created by the app; the model's temp ones never leave their scope.
pub fn record_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut ProposalLog,
    db: &DbActor,
    input: RecordInput,
) -> Result<GenerationDto, ApiError> {
    // The module may have archived during the network call: revalidate before recording.
    let module = ModuleId::new(input.module_id.clone())?;
    if store.module(&module).is_some_and(|m| m.archived()) {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    let generation = StoredGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        model: input.model,
        description: input.description,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version: TEMPLATE_VERSION,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions,
        proposals: input
            .validated
            .proposals
            .into_iter()
            .map(|p| StoredProposal {
                temp_id: p.temp_id,
                title: p.title,
                description: p.description,
                acceptance: p.acceptance,
                assumptions: p.assumptions,
                state: ProposalState::Pending,
            })
            .collect(),
    };
    // Validate on a copy before touching published disk or memory.
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_generation(&generation, ids_draft.checkpoint())
        .map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    Ok(to_dto(store, &generation))
}

/// A module's generations with their computed staleness.
pub fn list_generations(
    store: &Store,
    log: &ProposalLog,
    input: ListGenerationsInput,
) -> Result<Vec<GenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    Ok(log
        .generations_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| to_dto(store, g))
        .collect())
}

/// Did any source change since the generation? Conservative: an
/// unknown or missing version also counts as stale.
pub fn generation_is_stale(store: &Store, generation: &StoredGeneration) -> bool {
    for version_id in &generation.context_version_ids {
        let Ok(id) = VersionId::new(version_id.clone()) else {
            return true;
        };
        let Some(version) = store.version(&id) else {
            return true;
        };
        let current = store.current_version(version.artifact());
        if current.map(|c| c.id()) != Some(&id) {
            return true;
        }
    }
    false
}

fn to_dto(store: &Store, generation: &StoredGeneration) -> GenerationDto {
    GenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        model: generation.model.clone(),
        description: generation.description.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: generation_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposals: generation
            .proposals
            .iter()
            .map(|p| {
                let (state, artifact_id) = match &p.state {
                    ProposalState::Pending => ("pending".to_string(), None),
                    ProposalState::Discarded => ("discarded".to_string(), None),
                    ProposalState::Accepted { artifact_id, .. } => {
                        ("accepted".to_string(), Some(artifact_id.clone()))
                    }
                };
                ProposalDto {
                    temp_id: p.temp_id.clone(),
                    title: p.title.clone(),
                    description: p.description.clone(),
                    acceptance: p.acceptance.clone(),
                    assumptions: p.assumptions.clone(),
                    state,
                    artifact_id,
                }
            })
            .collect(),
    }
}

/// A proposal's already validated fields, ready to compose.
pub struct AcceptedFields {
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
}

/// Validates the person-edited fields with the same limits as the
/// model output: the UI is not trusted for these caps.
fn validate_accepted(input: &AcceptProposalInput) -> Result<AcceptedFields, ApiError> {
    let bad = |what: &str| ApiError::coded("invalid_proposal", format!("invalid proposal: {what}"));
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > MAX_TITLE_CHARS {
        return Err(bad("empty or oversized title"));
    }
    let description = input.description.trim();
    if description.is_empty() || description.chars().count() > MAX_PROPOSAL_CHARS {
        return Err(bad("empty or oversized description"));
    }
    let acceptance = validate_items(&input.acceptance, "criteria", 1, MAX_ACCEPTANCE_ITEMS)?;
    let assumptions = validate_items(&input.assumptions, "assumptions", 0, MAX_ASSUMPTION_ITEMS)?;
    Ok(AcceptedFields {
        title: title.to_string(),
        description: description.to_string(),
        acceptance,
        assumptions,
    })
}

fn validate_items(
    items: &[String],
    what: &str,
    min: usize,
    max: usize,
) -> Result<Vec<String>, ApiError> {
    if items.len() < min || items.len() > max {
        return Err(ApiError::coded(
            "invalid_proposal",
            format!("invalid proposal: {what} must have between {min} and {max} items"),
        ));
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_ITEM_CHARS {
            return Err(ApiError::coded(
                "invalid_proposal",
                format!("invalid proposal: {what} with an empty or oversized item"),
            ));
        }
        out.push(trimmed.to_string());
    }
    Ok(out)
}

/// Deterministic composition of the requirement content from the fields.
/// A single canonical shape: title, description, criteria and assumptions.
pub fn compose_content(fields: &AcceptedFields) -> String {
    let mut content = format!("{}\n\n{}", fields.title, fields.description);
    content.push_str("\n\nAcceptance criteria:");
    for criterion in &fields.acceptance {
        content.push_str(&format!("\n- {criterion}"));
    }
    if !fields.assumptions.is_empty() {
        content.push_str("\n\nAssumptions:");
        for assumption in &fields.assumptions {
            content.push_str(&format!("\n- {assumption}"));
        }
    }
    content
}

/// Accepts a proposal as an AI-provenance draft, without approving it.
/// Atomic (domain + state in one transaction) and idempotent: retrying
/// returns the existing detail without creating duplicates. Blocked when
/// the generation is stale or the proposal is not pending.
pub fn accept_proposal(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut ProposalLog,
    db: &DbActor,
    input: AcceptProposalInput,
) -> Result<RequirementDetail, ApiError> {
    // Idempotency first: when already accepted, return the existing one.
    if let Some(artifact) = log.accepted_artifact(&input.generation_id, &input.temp_id) {
        return get_requirement(
            store,
            GetRequirementInput {
                artifact_id: artifact,
            },
        );
    }
    let generation = log
        .generation(&input.generation_id)
        .ok_or_else(|| {
            ApiError::coded(
                "generation_not_found",
                format!("unknown generation: {}", input.generation_id),
            )
        })?
        .clone();
    let proposal = generation
        .proposals
        .iter()
        .find(|p| p.temp_id == input.temp_id)
        .ok_or_else(|| {
            ApiError::coded(
                "proposal_not_found",
                format!("unknown proposal: {}", input.temp_id),
            )
        })?;
    match proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "proposal_discarded",
                "The proposal is discarded and cannot be accepted.",
            ));
        }
        ProposalState::Accepted { .. } => {
            // Defense: log and memory disagree; do not duplicate.
            return Err(ApiError::coded(
                "proposal_accepted",
                "The proposal was already accepted.",
            ));
        }
        ProposalState::Pending => {}
    }
    if generation_is_stale(store, &generation) {
        return Err(ApiError::coded(
            "generation_stale",
            "The generation is stale: a requirement used as context changed. \
             Generate again with the current context.",
        ));
    }
    let fields = validate_accepted(&input)?;
    let content = compose_content(&fields);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = ids_draft.requirement();
    store_draft.create_artifact(
        &project,
        &module,
        artifact_id.clone(),
        ArtifactType::Requirement,
    )?;
    let version_id = IdGen::version(&artifact_id, 1);
    // No sources: the consulted context is not a business dependency.
    store_draft.accept_ai_draft(
        &project,
        &artifact_id,
        None,
        version_id,
        Content::new(content.clone())?,
        &agent,
        &[],
    )?;
    db.accept_proposal(
        &store_draft,
        ids_draft.checkpoint(),
        &generation.id,
        &input.temp_id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    log.mark_accepted(
        &generation.id,
        &input.temp_id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Discards a pending proposal. Idempotent; rejects when already accepted.
pub fn discard_proposal(
    log: &mut ProposalLog,
    db: &DbActor,
    input: DiscardProposalInput,
) -> Result<(), ApiError> {
    if log.generation(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "generation_not_found",
            format!("unknown generation: {}", input.generation_id),
        ));
    }
    db.discard_proposal(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    Ok(())
}
