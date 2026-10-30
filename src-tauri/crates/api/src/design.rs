//! Requirement-linked design logic: approved context, recording,
//! staleness, spec validation, acceptance and approval.
//!
//! Mirrors `proposals`: no Tauri or network, everything testable with a fake
//! generator. Differences: the context is SELECTED approved requirements,
//! each generation brings ONE proposal with a canonical JSON spec, and
//! accepting may create the artifact or version a chosen one.
//!
//! Rules:
//! - JSON is the authoritative content; Mermaid derives from it and is never
//!   stored as source or edited.
//! - Design dependencies point to the exact versions used
//!   (the core validates them: existence, crossing, cycles).
//! - Accepting is atomic and idempotent; approving revalidates content,
//!   currency and current version in Rust, never by a React flag.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactId, ArtifactType, Author, Content, CoreError, HumanId, ModuleId, ProjectId,
    VersionId,
};
use ruth_meta::design::{
    canonical_json, to_mermaid, validate_design_value, DesignKind, ValidatedDesign,
    DESIGN_MOCKUP_TEMPLATE_VERSION, DESIGN_TEMPLATE_VERSION, DESIGN_UPDATE_TEMPLATE_VERSION,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_store::{
    DbActor, DesignLog, LayoutLog, ProposalState, StoredDesignGeneration, StoredDesignProposal,
};

use crate::dto::GetRequirementInput;
use crate::dto::{
    AcceptDesignInput, ApproveVersionInput, DesignContextInput, DesignContextPreview,
    DesignGenerationDto, DesignLayoutDto, DesignProposalDto, DiscardDesignInput,
    GetDesignLayoutInput, ListDesignsInput, RequirementDetail, SaveDesignLayoutInput,
    SaveDesignVersionInput, UsageDto, ValidateDesignInput, ValidatedDesignDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::{approve_version, get_requirement};

/// Agent recorded as provenance of what a design accepts.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Context snapshot: exact current version of each selected requirement.
/// All must exist in the module and be requirements with a current version.
/// Since living design, approval is NOT required: generation runs from saved
/// versions and review stays as information (see `approved` in the
/// preview). Empty selection: error before consuming network.
pub fn snapshot_design_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    selected: &[String],
) -> Result<Vec<GenerationContextItem>, ApiError> {
    if selected.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Select at least one requirement as a source.",
        ));
    }
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
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(selected.len());
    for id in selected {
        if !seen.insert(id.clone()) {
            return Err(ApiError::coded(
                "duplicate_selection",
                format!("requirement repeated in the selection: {id}"),
            ));
        }
        let artifact = ruth_core::domain::ArtifactId::new(id.clone())?;
        let Some(known) = store.artifact(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if known.project() != &project || known.module() != &module {
            return Err(ApiError::coded(
                "foreign_selection",
                format!("{id} does not belong to this module"),
            ));
        }
        if known.artifact_type() != ArtifactType::Requirement {
            return Err(ApiError::coded(
                "not_a_requirement",
                format!("{id} is not a requirement"),
            ));
        }
        if store.is_effectively_archived(&artifact) {
            return Err(CoreError::ArchivedArtifact { artifact }.into());
        }
        let Some(current) = store.current_version(&artifact) else {
            return Err(ApiError::internal(format!("{id} has no versions")));
        };
        // No approval barrier (living design): each source's review
        // travels as information in the preview, not as a veto.
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Module preview for selecting sources: all requirements
/// with their current approval.
pub fn design_context_preview(
    store: &Store,
    input: DesignContextInput,
) -> Result<Vec<DesignContextPreview>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut out = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Requirement {
            continue;
        }
        // Archived ones are not offered as new-design sources.
        if store.is_effectively_archived(artifact.id()) {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let content = current.content().as_str();
        out.push(DesignContextPreview {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            chars: content.chars().count(),
            excerpt: excerpt(content),
            approved: store.is_approved(current.id()),
            title: artifact.title().map(str::to_string),
        });
    }
    out.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(out)
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

/// Target pinned by an update proposal: the artifact and its
/// version at snapshot time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateTarget {
    pub artifact_id: String,
    pub version_id: String,
}

/// Input for recording a newly validated design generation. Without
/// `target` it is a creation; with it, an update proposal for the
/// artifact (same table, same acceptance cycle).
pub struct RecordDesignInput {
    pub project_id: String,
    pub module_id: String,
    pub kind: DesignKind,
    pub model: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedDesign,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub target: Option<UpdateTarget>,
}

/// Records the generation on disk and memory, with derivable Mermaid.
pub fn record_design_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: RecordDesignInput,
) -> Result<DesignGenerationDto, ApiError> {
    if input.validated.kind != input.kind {
        return Err(ApiError::internal(
            "the design does not match the requested kind",
        ));
    }
    // The module may have archived during the network call: revalidate before recording.
    let module = ruth_core::domain::ModuleId::new(input.module_id.clone())?;
    if store.module(&module).is_some_and(|m| m.archived()) {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    // The template stays recorded: update, creation from mockups
    // (some source is a mockup) or creation from requirements. The context
    // already pinned the exact versions; only their kind reads here.
    let template_version = if input.target.is_some() {
        DESIGN_UPDATE_TEMPLATE_VERSION
    } else if context_has_mockup(store, &input.context) {
        DESIGN_MOCKUP_TEMPLATE_VERSION
    } else {
        DESIGN_TEMPLATE_VERSION
    };
    let (target_artifact_id, target_version_id) = match input.target {
        Some(target) => (Some(target.artifact_id), Some(target.version_id)),
        None => (None, None),
    };
    let generation = StoredDesignGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        kind: input.kind.as_str().to_string(),
        model: input.model,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version,
        target_artifact_id,
        target_version_id,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions.clone(),
        proposal: StoredDesignProposal {
            title: input.validated.title.clone(),
            spec_json: canonical_json(&input.validated),
            explanation: input.validated.explanation.clone(),
            state: ProposalState::Pending,
        },
    };
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_design(&generation, ids_draft.checkpoint())
        .map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    to_dto(store, &generation)
}

/// Does any context version belong to a mockup? Kinds only read;
/// versions were already pinned at context capture.
fn context_has_mockup(store: &Store, context: &[GenerationContextItem]) -> bool {
    context.iter().any(|item| {
        VersionId::new(item.version_id.clone())
            .ok()
            .and_then(|vid| store.version(&vid))
            .and_then(|version| store.artifact(version.artifact()))
            .is_some_and(|artifact| artifact.artifact_type() == ArtifactType::Mockup)
    })
}

/// A module's design generations with their computed staleness.
pub fn list_designs(
    store: &Store,
    log: &DesignLog,
    input: ListDesignsInput,
) -> Result<Vec<DesignGenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    log.designs_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| to_dto(store, g))
        .collect()
}

/// Did any source change since the generation? Same as with requirements.
pub fn design_is_stale(store: &Store, generation: &StoredDesignGeneration) -> bool {
    if context_is_stale(store, generation) {
        return true;
    }
    update_target_moved(store, generation)
}

fn context_is_stale(store: &Store, generation: &StoredDesignGeneration) -> bool {
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

/// Did the target change since the snapshot? Updates only: the
/// artifact's current version is no longer the pinned-at-generation one.
fn update_target_moved(store: &Store, generation: &StoredDesignGeneration) -> bool {
    let (Some(artifact), Some(version)) = (
        generation.target_artifact_id.as_deref(),
        generation.target_version_id.as_deref(),
    ) else {
        return false;
    };
    let Ok(artifact_id) = ruth_core::domain::ArtifactId::new(artifact.to_string()) else {
        return true;
    };
    match store.current_version(&artifact_id) {
        Some(current) => current.id().as_str() != version,
        None => true,
    }
}

/// References cited in a spec: allows validating history without
/// a sent set (everything else still enforced).
fn cited_refs(value: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    collect(value, &mut out);
    out.sort();
    out.dedup();
    out
}

fn collect(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                if key == "requirements" {
                    if let Some(items) = val.as_array() {
                        for item in items {
                            if let Some(text) = item.as_str() {
                                out.push(text.trim().to_string());
                            }
                        }
                    }
                } else {
                    collect(val, out);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect(item, out);
            }
        }
        _ => {}
    }
}

/// Validates a spec on demand (JSON editor, history).
/// With an allowed set it requires references inside it; without it, full
/// structural validation (what revalidates on approve).
pub fn validate_spec(
    kind_str: &str,
    spec: &serde_json::Value,
    allowed: Option<&[String]>,
) -> Result<ValidatedDesign, ApiError> {
    let kind = DesignKind::parse(kind_str).map_err(ApiError::from_meta)?;
    match allowed {
        Some(set) => validate_design_value(kind, spec, set).map_err(ApiError::from_meta),
        None => {
            let cited = cited_refs(spec);
            validate_design_value(kind, spec, &cited).map_err(ApiError::from_meta)
        }
    }
}

/// Validation command: with a generation, inside its context.
pub fn validate_design(
    store: &Store,
    log: &DesignLog,
    input: ValidateDesignInput,
) -> Result<ValidatedDesignDto, ApiError> {
    let allowed: Option<Vec<String>> = match &input.generation_id {
        Some(id) => {
            let generation = log.design(id).ok_or_else(|| {
                ApiError::coded("design_not_found", format!("unknown generation: {id}"))
            })?;
            let mut artifacts = Vec::new();
            for version_id in &generation.context_version_ids {
                let vid = VersionId::new(version_id.clone())?;
                let Some(version) = store.version(&vid) else {
                    return Err(ApiError::coded("design_stale", "The generation is stale."));
                };
                artifacts.push(version.artifact().as_str().to_string());
            }
            Some(artifacts)
        }
        None => None,
    };
    let validated = validate_spec(&input.kind, &input.spec, allowed.as_deref())?;
    Ok(ValidatedDesignDto {
        canonical: canonical_json(&validated),
        mermaid: to_mermaid(&validated),
    })
}

fn to_dto(
    store: &Store,
    generation: &StoredDesignGeneration,
) -> Result<DesignGenerationDto, ApiError> {
    let spec: serde_json::Value =
        serde_json::from_str(&generation.proposal.spec_json).map_err(|_| {
            ApiError::internal(format!("the proposal of {} is not JSON", generation.id))
        })?;
    // The saved data validated on write; here it revalidates structurally
    // to derive Mermaid. On failure, the data was hand-corrupted.
    let validated = validate_spec(&generation.kind, &spec, None)?;
    let (state, artifact_id) = match &generation.proposal.state {
        ProposalState::Pending => ("pending".to_string(), None),
        ProposalState::Discarded => ("discarded".to_string(), None),
        ProposalState::Accepted { artifact_id, .. } => {
            ("accepted".to_string(), Some(artifact_id.clone()))
        }
    };
    Ok(DesignGenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        kind: generation.kind.clone(),
        model: generation.model.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: design_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposal: DesignProposalDto {
            title: generation.proposal.title.clone(),
            spec,
            mermaid: to_mermaid(&validated),
            explanation: generation.proposal.explanation.clone(),
            state,
            artifact_id,
        },
        target_artifact_id: generation.target_artifact_id.clone(),
        target_version_id: generation.target_version_id.clone(),
    })
}

/// Updates accept over the SAME artifact and the SAME snapshot
/// version: when the design moved, the proposal expires (it never
/// accepts silently over the new version).
fn check_update_target(
    store: &Store,
    generation: &StoredDesignGeneration,
    input: &AcceptDesignInput,
) -> Result<(), ApiError> {
    let snapshot_artifact = generation.target_artifact_id.as_deref().unwrap_or_default();
    let snapshot_version = generation.target_version_id.as_deref().unwrap_or_default();
    if input.target_artifact_id.as_deref() != Some(snapshot_artifact) {
        return Err(ApiError::coded(
            "update_wrong_target",
            format!(
                "The proposal updates {snapshot_artifact}: it cannot be accepted on another artifact."
            ),
        ));
    }
    if input.expected_version_id.as_deref() != Some(snapshot_version) {
        return Err(ApiError::coded(
            "update_stale",
            "The proposal generated over another design version. Generate again.",
        ));
    }
    if update_target_moved(store, generation) {
        return Err(ApiError::coded(
            "update_stale",
            "The design changed during review: the proposal is stale. \
             Generate again.",
        ));
    }
    Ok(())
}

/// The snapshot sources exist and stay current. Currency
/// recomputes (a design source may have gone stale later). No
/// approval barrier (living design): saved, current sources suffice;
/// review is informative.
fn check_update_sources(store: &Store, sources: &[VersionId]) -> Result<(), ApiError> {
    for source in sources {
        let Some(version) = store.version(source) else {
            return Err(ApiError::coded(
                "update_stale",
                "A snapshot source no longer exists. Generate again.",
            ));
        };
        let validity = store.validity(source)?;
        if !validity.valid {
            return Err(ApiError::coded(
                "update_stale",
                format!(
                    "{} stopped being current: update that source and generate again.",
                    version.artifact().as_str()
                ),
            ));
        }
    }
    Ok(())
}

/// Accepts a design as an AI-provenance draft, without approving it.
/// Creates the artifact or versions the chosen one (with expected version),
/// with the context's exact versions as dependencies. Atomic and idempotent;
/// blocked when stale or not pending. Updates additionally require
/// a still target and existing, current sources (no approval
/// required: living design).
pub fn accept_design(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: AcceptDesignInput,
) -> Result<RequirementDetail, ApiError> {
    if let Some(artifact) = log.accepted_artifact(&input.generation_id) {
        return get_requirement(
            store,
            GetRequirementInput {
                artifact_id: artifact,
            },
        );
    }
    let generation = log
        .design(&input.generation_id)
        .ok_or_else(|| {
            ApiError::coded(
                "design_not_found",
                format!("unknown generation: {}", input.generation_id),
            )
        })?
        .clone();
    match generation.proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "design_discarded",
                "The proposal is discarded and cannot be accepted.",
            ));
        }
        ProposalState::Accepted { .. } => {
            return Err(ApiError::coded(
                "design_accepted",
                "The proposal was already accepted.",
            ));
        }
        ProposalState::Pending => {}
    }
    let is_update = generation.target_artifact_id.is_some();
    if is_update {
        check_update_target(store, &generation, &input)?;
    }
    if design_is_stale(store, &generation) {
        if is_update {
            return Err(ApiError::coded(
                "update_stale",
                "The proposal is stale: the design or a source changed \
                 during generation or review. Generate again.",
            ));
        }
        return Err(ApiError::coded(
            "design_stale",
            "The generation is stale: a requirement used as context changed. \
             Generate again with the current context.",
        ));
    }
    // Allowed set: artifacts from the recorded context.
    let mut allowed = Vec::with_capacity(generation.context_version_ids.len());
    let mut sources = Vec::with_capacity(generation.context_version_ids.len());
    for version_id in &generation.context_version_ids {
        let vid = VersionId::new(version_id.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded("design_stale", "The generation is stale."));
        };
        allowed.push(version.artifact().as_str().to_string());
        sources.push(vid);
    }
    if is_update {
        check_update_sources(store, &sources)?;
    }
    let validated = validate_spec(&generation.kind, &input.spec, Some(&allowed))?;
    let content = canonical_json(&validated);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;
    let artifact_type = match validated.kind {
        DesignKind::Flow => ArtifactType::Flow,
        DesignKind::DataModel => ArtifactType::DataModel,
    };

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = match &input.target_artifact_id {
        None => {
            let id = match validated.kind {
                DesignKind::Flow => ids_draft.flow(),
                DesignKind::DataModel => ids_draft.data_model(),
            };
            store_draft.create_artifact(&project, &module, id.clone(), artifact_type)?;
            let version_id = IdGen::version(&id, 1);
            store_draft.accept_ai_draft(
                &project,
                &id,
                None,
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
        Some(target) => {
            let id = ruth_core::domain::ArtifactId::new(target.clone())?;
            let Some(known) = store_draft.artifact(&id) else {
                return Err(CoreError::ArtifactNotFound { artifact: id }.into());
            };
            if known.artifact_type() != artifact_type {
                return Err(ApiError::coded(
                    "design_type_mismatch",
                    format!("{} is not of kind {}", target, generation.kind),
                ));
            }
            let Some(expected_raw) = &input.expected_version_id else {
                return Err(ApiError::coded(
                    "missing_expected",
                    "Versioning requires the expected version.",
                ));
            };
            let expected = VersionId::new(expected_raw.clone())?;
            let number = store_draft.versions_of(&id).len() as u32 + 1;
            let version_id = IdGen::version(&id, number);
            store_draft.accept_ai_draft(
                &project,
                &id,
                Some(&expected),
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
    };
    db.accept_design(
        &store_draft,
        ids_draft.checkpoint(),
        &generation.id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    log.mark_accepted(&generation.id, artifact_id.as_str(), &content)
        .map_err(ApiError::storage)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Discards a pending design proposal. Idempotent.
pub fn discard_design(
    log: &mut DesignLog,
    db: &DbActor,
    input: DiscardDesignInput,
) -> Result<(), ApiError> {
    if log.design(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "design_not_found",
            format!("unknown generation: {}", input.generation_id),
        ));
    }
    db.discard_design(&input.generation_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id)
        .map_err(ApiError::storage)?;
    Ok(())
}

/// Approves a design's current version: requires a design artifact,
/// valid content of the kind, and delegates currency, current version
/// and humanness to the core. Nothing is decided by React flags.
pub fn approve_design_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    let kind = match known.artifact_type() {
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => {
            return crate::mockup::approve_mockup_version(store, input, now);
        }
        ArtifactType::Requirement => {
            return Err(ApiError::coded(
                "not_a_design",
                "This command only approves design versions.",
            ));
        }
    };
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("the design has no versions"));
    };
    let spec: serde_json::Value = serde_json::from_str(current.content().as_str())
        .map_err(|_| ApiError::coded("design_invalid", "The content is not valid design JSON."))?;
    validate_spec(kind, &spec, None)
        .map_err(|_| ApiError::coded("design_invalid", "The content is not a valid design."))?;
    approve_version(store, input, now)
}

/// Maximum layout entries (far above the subset).
pub const MAX_LAYOUT_ENTRIES: usize = 128;
/// Maximum key length of a placed element.
pub const MAX_LAYOUT_KEY_CHARS: usize = 64;
/// Maximum admitted absolute coordinate.
pub const MAX_LAYOUT_COORD: f64 = 100_000.0;

/// Maximum admitted layout size (mockup width/height).
pub const MAX_LAYOUT_SIZE: f64 = 100_000.0;

/// Sanitizes a candidate layout `{ element: { x, y, w?, h? } }` for
/// persisting it. A non-object is a caller error; an object keeps
/// only well-formed entries, in key order (deterministic). `w`/`h`
/// are optional (resizable mockups use them; diagrams ignore them)
/// and persist only when finite and positive. Empty after sanitizing
/// equals "no layout" and never blocks saving.
pub fn sanitize_layout(value: &serde_json::Value) -> Result<Option<String>, ApiError> {
    let Some(object) = value.as_object() else {
        return Err(ApiError::coded(
            "design_layout_invalid",
            "The layout is not a positions object.",
        ));
    };
    let mut entries: Vec<(&String, f64, f64, Option<f64>, Option<f64>)> = Vec::new();
    for (key, position) in object {
        if key.trim().is_empty() || key.chars().count() > MAX_LAYOUT_KEY_CHARS {
            continue;
        }
        let coords = position.as_object().and_then(|pos| {
            let x = pos.get("x")?.as_f64()?;
            let y = pos.get("y")?.as_f64()?;
            if !x.is_finite() || !y.is_finite() {
                return None;
            }
            let size = |name: &str| {
                pos.get(name)
                    .and_then(|v| v.as_f64())
                    .filter(|v| v.is_finite() && *v > 0.0 && *v <= MAX_LAYOUT_SIZE)
            };
            Some((x, y, size("w"), size("h")))
        });
        let Some((x, y, w, h)) = coords else { continue };
        if x.abs() > MAX_LAYOUT_COORD || y.abs() > MAX_LAYOUT_COORD {
            continue;
        }
        entries.push((key, x, y, w, h));
    }
    if entries.is_empty() {
        return Ok(None);
    }
    entries.sort_by(|a, b| a.0.cmp(b.0));
    entries.truncate(MAX_LAYOUT_ENTRIES);
    let mut map = serde_json::Map::with_capacity(entries.len());
    for (key, x, y, w, h) in entries {
        let mut pos = serde_json::Map::with_capacity(4);
        pos.insert("x".to_string(), serde_json::json!(x));
        pos.insert("y".to_string(), serde_json::json!(y));
        if let Some(w) = w {
            pos.insert("w".to_string(), serde_json::json!(w));
        }
        if let Some(h) = h {
            pos.insert("h".to_string(), serde_json::json!(h));
        }
        map.insert(key.clone(), serde_json::Value::Object(pos));
    }
    serde_json::to_string(&map)
        .map(Some)
        .map_err(|_| ApiError::internal("the sanitized layout does not serialize"))
}

/// Saved layout for a version. Tolerant read: a missing or illegible row
/// equals "no layout" (the editor uses its automatic placement);
/// presentation never breaks a query.
pub fn design_layout(layouts: &LayoutLog, input: GetDesignLayoutInput) -> DesignLayoutDto {
    let layout = layouts
        .get(&input.artifact_id, &input.version_id)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .and_then(|value: serde_json::Value| value.is_object().then_some(value));
    DesignLayoutDto { layout }
}

/// Saves only an existing version's layout, without creating a new
/// version or touching the domain. The version must exist; the layout
/// sanitizes as in the full save. It creates no empty versions
/// when only rearranging the canvas.
pub fn save_design_layout_only(
    store: &Store,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveDesignLayoutInput,
) -> Result<(), ApiError> {
    let version_id = VersionId::new(input.version_id.clone())?;
    let Some(version) = store.version(&version_id) else {
        return Err(ApiError::coded(
            "version_not_found",
            format!("Version {} does not exist.", input.version_id),
        ));
    };
    if version.artifact().as_str() != input.artifact_id {
        return Err(ApiError::coded(
            "version_not_found",
            format!(
                "Version {} does not belong to {}.",
                input.version_id, input.artifact_id
            ),
        ));
    }
    let layout = sanitize_layout(&input.layout)?;
    db.upsert_design_layout(&input.artifact_id, &input.version_id, layout.as_deref())
        .map_err(ApiError::storage)?;
    if let Some(clean) = &layout {
        layouts.set(&input.artifact_id, &input.version_id, clean);
    }
    Ok(())
}

/// Saves a manual visual-editor review as a new version of the SAME
/// artifact, with human provenance and no inherited approval. Revalidates
/// in Rust: design kind, spec (inside the declared set), existing and
/// current declared sources, and expected version. Stale sources block
/// with their names: nobody updates them silently; the person explicitly
/// adopts the current ones and retries. The layout travels in the
/// same transaction. Atomic: on any failure, memory, disk and identifiers
/// stay intact and the draft stays in the UI.
pub fn save_design_version(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveDesignVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    let kind = match known.artifact_type() {
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => {
            return Err(ApiError::coded(
                "not_a_design",
                "This command only saves flows and models; mockups save with their own command.",
            ));
        }
        ArtifactType::Requirement => {
            return Err(ApiError::coded(
                "not_a_design",
                "This command only saves design versions.",
            ));
        }
    };
    if input.source_version_ids.is_empty() {
        return Err(ApiError::coded(
            "design_no_sources",
            "The design must declare its exact sources.",
        ));
    }
    // Declared sources: must exist and be their artifact's current ones.
    let mut sources = Vec::with_capacity(input.source_version_ids.len());
    let mut allowed = Vec::with_capacity(input.source_version_ids.len());
    let mut stale = Vec::new();
    for raw in &input.source_version_ids {
        let vid = VersionId::new(raw.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "design_source_missing",
                format!("Source {raw} does not exist."),
            ));
        };
        let source_artifact = version.artifact().clone();
        let is_current = store
            .current_version(&source_artifact)
            .map(|current| current.id() == &vid)
            .unwrap_or(false);
        if !is_current {
            stale.push(source_artifact.as_str().to_string());
        }
        allowed.push(source_artifact.as_str().to_string());
        sources.push(vid);
    }
    if !stale.is_empty() {
        stale.sort();
        stale.dedup();
        return Err(ApiError::coded(
            "design_stale_sources",
            format!(
                "Stale sources ({}): review their current versions and save again.",
                stale.join(", ")
            ),
        ));
    }
    let validated = validate_spec(kind, &input.spec, Some(&allowed))?;
    let content = canonical_json(&validated);
    let expected = VersionId::new(input.expected_version_id)?;
    let author = Author::Human(HumanId::new(input.author)?);
    let layout = match &input.layout {
        None => None,
        Some(value) => sanitize_layout(value)?,
    };

    let mut store_draft = store.clone();
    let ids_draft = ids.clone();
    let number = store_draft.versions_of(&artifact).len() as u32 + 1;
    let version_id = IdGen::version(&artifact, number);
    store_draft.create_version(
        &project,
        &artifact,
        Some(&expected),
        version_id.clone(),
        Content::new(content)?,
        &author,
        &sources,
    )?;
    db.save_design_layout(
        &store_draft,
        ids_draft.checkpoint(),
        artifact.as_str(),
        version_id.as_str(),
        layout.as_deref(),
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    if let Some(clean) = &layout {
        layouts.set(artifact.as_str(), version_id.as_str(), clean);
    }
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: input.artifact_id,
        },
    )
}
