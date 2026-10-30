//! Versioned mockup logic (living design, stage B): manual creation,
//! review saving, design-generation context and approval.
//!
//! Mirrors `design` without the AI proposal loop: the person draws
//! mockups and they serve as context for proposing flows or ER (recording
//! and acceptance use the existing design machinery).
//!
//! Rules:
//! - Canonical JSON is the authoritative content; the visual layout
//!   lives apart and moving components never creates semantic versions.
//! - Cited references (requirements, design elements) must belong
//!   to the declared sources; declared sources must exist and
//!   be current. Sourceless only counts without references.
//! - Design-element references are informative semantic links,
//!   not core dependencies: they create no cycles.
//! - Saving validates kind, spec, sources and expected version in
//!   Rust, in a single transaction with the layout.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactId, ArtifactType, Author, Content, CoreError, HumanId, ModuleId, ProjectId,
    VersionId,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_meta::mockup::{
    canonical_mockup_json, render_mockup_excerpt, validate_mockup_value, ValidatedMockupGeneration,
    MOCKUP_GEN_TEMPLATE_VERSION,
};
use ruth_store::{
    DbActor, LayoutLog, MockupLog, ProposalState, StoredMockupGeneration, StoredMockupProposal,
};

use crate::design::sanitize_layout;
use crate::dto::{
    AcceptMockupScreenInput, ApproveVersionInput, CreateMockupInput, DesignContextInput,
    DesignContextPreview, DiscardMockupScreenInput, GetRequirementInput,
    ListMockupGenerationsInput, MockupContextPreview, MockupGenerationDto, MockupScreenProposalDto,
    RequirementDetail, SaveMockupVersionInput, UsageDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::{approve_version, get_requirement};

/// Agent recorded as provenance of what screens accept.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Context snapshot for generating a design: exact current versions of
/// the selected requirements and mockups. Same module, not archived,
/// with a current version; at least one element overall. A mockup may go
/// without requirements (the template then asks to flag what is missing).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MockupSnapshot {
    pub requirements: Vec<GenerationContextItem>,
    pub mockups: Vec<GenerationContextItem>,
}

pub fn snapshot_mockup_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    requirement_ids: &[String],
    mockup_ids: &[String],
) -> Result<MockupSnapshot, ApiError> {
    if requirement_ids.is_empty() && mockup_ids.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Select at least one requirement or mockup as a source.",
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
    let requirements = snapshot_list(
        store,
        &project,
        &module,
        requirement_ids,
        ArtifactType::Requirement,
        "requirement",
    )?;
    let mockups = snapshot_list(
        store,
        &project,
        &module,
        mockup_ids,
        ArtifactType::Mockup,
        "mockup",
    )?;
    Ok(MockupSnapshot {
        requirements,
        mockups,
    })
}

fn snapshot_list(
    store: &Store,
    project: &ProjectId,
    module: &ModuleId,
    selected: &[String],
    expected: ArtifactType,
    what: &str,
) -> Result<Vec<GenerationContextItem>, ApiError> {
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(selected.len());
    for id in selected {
        if !seen.insert(id.clone()) {
            return Err(ApiError::coded(
                "duplicate_selection",
                format!("{what} repeated in the selection: {id}"),
            ));
        }
        let artifact = ArtifactId::new(id.clone())?;
        let Some(known) = store.artifact(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if known.project() != project || known.module() != module {
            return Err(ApiError::coded(
                "foreign_selection",
                format!("{id} does not belong to this module"),
            ));
        }
        if known.artifact_type() != expected {
            return Err(ApiError::coded(
                "not_a_requirement",
                format!("{id} is not a {what}"),
            ));
        }
        if store.is_effectively_archived(&artifact) {
            return Err(CoreError::ArchivedArtifact { artifact }.into());
        }
        let Some(current) = store.current_version(&artifact) else {
            return Err(ApiError::internal(format!("{id} has no versions")));
        };
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Module preview for generating from mockups and declaring sources:
/// unarchived requirements, designs and mockups with their current version,
/// excerpt and review.
pub fn mockup_context_preview(
    store: &Store,
    input: DesignContextInput,
) -> Result<MockupContextPreview, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut requirements = Vec::new();
    let mut designs = Vec::new();
    let mut mockups = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        let kind = artifact.artifact_type();
        if store.is_effectively_archived(artifact.id()) {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let content = current.content().as_str();
        let excerpt = if kind == ArtifactType::Mockup {
            one_line(&render_mockup_excerpt(content, 240), 120)
        } else {
            one_line(content, 120)
        };
        let item = DesignContextPreview {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            chars: content.chars().count(),
            excerpt,
            approved: store.is_approved(current.id()),
            title: artifact.title().map(str::to_string),
        };
        match kind {
            ArtifactType::Requirement => requirements.push(item),
            ArtifactType::Mockup => mockups.push(item),
            ArtifactType::Flow | ArtifactType::DataModel => designs.push(item),
        };
    }
    requirements.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    designs.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    mockups.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(MockupContextPreview {
        requirements,
        designs,
        mockups,
    })
}

fn one_line(text: &str, max_chars: usize) -> String {
    let flat: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max_chars {
        return flat;
    }
    let end = flat
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(flat.len());
    format!("{}…", flat[..end].trim_end())
}

/// Validates a mockup spec. With a declared set, references must
/// belong to it; without it, revalidation runs against the cited
/// ones (structural: for reads and export).
pub fn validate_mockup_spec(
    spec: &serde_json::Value,
    allowed: Option<&[String]>,
) -> Result<ruth_meta::mockup::ValidatedMockup, ApiError> {
    match allowed {
        Some(set) => validate_mockup_value(spec, set).map_err(ApiError::from_meta),
        None => {
            let cited = mockup_cited_refs(spec);
            validate_mockup_value(spec, &cited).map_err(ApiError::from_meta)
        }
    }
}

/// Freshness of a mockup's current-version sources: used versus
/// current version, change and review. The editor uses it to offer
/// explicitly adopting the current ones before saving (saving
/// revalidates in Rust and blocks stale ones by name).
pub fn mockup_sources(
    store: &Store,
    project_id: &str,
    artifact_id: &str,
) -> Result<Vec<crate::dto::UpdateSourceDto>, ApiError> {
    use crate::dto::UpdateSourceDto;
    let project = ProjectId::new(project_id.to_string())?;
    let artifact = ArtifactId::new(artifact_id.to_string())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.project() != &project {
        return Err(CoreError::ArtifactNotInProject { artifact, project }.into());
    }
    if known.artifact_type() != ArtifactType::Mockup {
        return Err(ApiError::coded(
            "not_a_mockup",
            "This command only reports mockup sources.",
        ));
    }
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("the mockup has no versions"));
    };
    let mut sources = Vec::with_capacity(current.sources().len());
    for used in current.sources() {
        // API-declared sources always exist; when one is missing
        // (tampered database), it is skipped instead of inventing.
        let Some(used_version) = store.version(used) else {
            continue;
        };
        let source_artifact = used_version.artifact().clone();
        let Some(source_current) = store.current_version(&source_artifact) else {
            continue;
        };
        let Some(source_ref) = store.artifact(&source_artifact) else {
            continue;
        };
        sources.push(UpdateSourceDto {
            artifact_id: source_artifact.as_str().to_string(),
            kind: crate::baseline::kind_str(source_ref.artifact_type()).to_string(),
            used_version_id: used.as_str().to_string(),
            used_content: used_version.content().as_str().to_string(),
            current_version_id: source_current.id().as_str().to_string(),
            current_content: source_current.content().as_str().to_string(),
            changed: used != source_current.id(),
            current_approved: store.is_approved(source_current.id()),
            current_valid: store.validity(source_current.id())?.valid,
        });
    }
    sources.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(sources)
}

/// Structural validation command: against its own citations, no network.
/// Returns the canonical form and the summary for display and review.
pub fn validate_mockup_stored(
    input: crate::dto::ValidateMockupInput,
) -> Result<crate::dto::ValidatedMockupDto, ApiError> {
    let validated = validate_mockup_spec(&input.spec, None)?;
    Ok(crate::dto::ValidatedMockupDto {
        canonical: canonical_mockup_json(&validated),
        title: validated.title.clone(),
        screens: validated.screens.len(),
        components: validated.screens.iter().map(|s| s.components.len()).sum(),
    })
}

/// Artifacts cited in a spec (requirements and the artifact part
/// of design references), ordered and deduplicated.
pub fn mockup_cited_refs(spec: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    let empty = Vec::new();
    let screens = spec
        .get("screens")
        .and_then(|v| v.as_array())
        .unwrap_or(&empty);
    for screen in screens {
        collect_mockup_refs(screen, &mut out);
        if let Some(components) = screen.get("components").and_then(|v| v.as_array()) {
            for component in components {
                collect_mockup_refs(component, &mut out);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn collect_mockup_refs(node: &serde_json::Value, out: &mut Vec<String>) {
    if let Some(list) = node.get("requirements").and_then(|v| v.as_array()) {
        for item in list.iter().filter_map(|v| v.as_str()) {
            out.push(item.to_string());
        }
    }
    if let Some(list) = node.get("designs").and_then(|v| v.as_array()) {
        for item in list.iter().filter_map(|v| v.as_str()) {
            if let Some((artifact, _)) = item.split_once('/') {
                out.push(artifact.to_string());
            }
        }
    }
}

/// Declared sources: must exist and be current; stale ones return
/// with names to block with an explanation. Empty only counts
/// when the spec cites no references.
fn resolve_mockup_sources(
    store: &Store,
    source_version_ids: &[String],
    cited: &[String],
) -> Result<(Vec<VersionId>, Vec<String>), ApiError> {
    if source_version_ids.is_empty() {
        if cited.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }
        return Err(ApiError::coded(
            "mockup_no_sources",
            format!(
                "Nothing may cite without declared sources ({}): declare their exact versions.",
                cited.join(", ")
            ),
        ));
    }
    let mut sources = Vec::with_capacity(source_version_ids.len());
    let mut allowed = Vec::with_capacity(source_version_ids.len());
    let mut seen = std::collections::HashSet::new();
    let mut stale = Vec::new();
    for raw in source_version_ids {
        let vid = VersionId::new(raw.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "mockup_source_missing",
                format!("Source {raw} does not exist."),
            ));
        };
        let source_artifact = version.artifact().clone();
        // A single version per artifact: two pins of the same one would
        // make currency impossible (one would always be stale).
        if !seen.insert(source_artifact.as_str().to_string()) {
            return Err(ApiError::coded(
                "mockup_duplicate_source",
                format!(
                    "{} appears twice among the sources: declare a single version.",
                    source_artifact.as_str()
                ),
            ));
        }
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
            "mockup_stale_sources",
            format!(
                "Stale sources ({}): review their current versions and save again.",
                stale.join(", ")
            ),
        ));
    }
    Ok((sources, allowed))
}

/// Creates a person-drawn mockup: new artifact with its first version,
/// validated content and initial layout in a single transaction.
/// Atomic: on any failure, memory, disk and identifiers stay intact.
pub fn create_mockup(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: CreateMockupInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let Some(module_ref) = store.module(&module) else {
        return Err(CoreError::ModuleNotFound { module }.into());
    };
    if module_ref.archived() {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let cited = mockup_cited_refs(&input.spec);
    let (sources, allowed) = resolve_mockup_sources(store, &input.source_version_ids, &cited)?;
    let validated = validate_mockup_spec(&input.spec, Some(&allowed))?;
    let content = canonical_mockup_json(&validated);
    let author = Author::Human(HumanId::new(input.author)?);
    let layout = match &input.layout {
        None => None,
        Some(value) => sanitize_layout(value)?,
    };

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = ids_draft.mockup();
    store_draft.create_artifact(&project, &module, artifact_id.clone(), ArtifactType::Mockup)?;
    let version_id = IdGen::version(&artifact_id, 1);
    store_draft.create_version(
        &project,
        &artifact_id,
        None,
        version_id.clone(),
        Content::new(content)?,
        &author,
        &sources,
    )?;
    db.save_design_layout(
        &store_draft,
        ids_draft.checkpoint(),
        artifact_id.as_str(),
        version_id.as_str(),
        layout.as_deref(),
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    if let Some(clean) = &layout {
        layouts.set(artifact_id.as_str(), version_id.as_str(), clean);
    }
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Saves a manual review as a new version of the SAME mockup, with
/// human provenance and no inherited approval. Revalidates kind,
/// spec, current sources and expected version; the layout travels
/// in the same transaction. Atomic: on any failure, memory, disk
/// and identifiers stay intact.
pub fn save_mockup_version(
    store: &mut Store,
    ids: &mut IdGen,
    layouts: &mut LayoutLog,
    db: &DbActor,
    input: SaveMockupVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.artifact_type() != ArtifactType::Mockup {
        return Err(ApiError::coded(
            "not_a_mockup",
            "This command only saves mockup versions.",
        ));
    }
    if store.is_effectively_archived(&artifact) {
        return Err(CoreError::ArchivedArtifact { artifact }.into());
    }
    let cited = mockup_cited_refs(&input.spec);
    let (sources, allowed) = resolve_mockup_sources(store, &input.source_version_ids, &cited)?;
    let validated = validate_mockup_spec(&input.spec, Some(&allowed))?;
    let content = canonical_mockup_json(&validated);
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

/// Approves a mockup's current version with an explicit human action:
/// revalidates that the content is still a valid mockup and delegates to
/// the generic approval (currency and current version). The command wraps
/// persistence (`transact`).
pub fn approve_mockup_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ArtifactId::new(input.artifact_id.clone())?;
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("the mockup has no versions"));
    };
    let spec: serde_json::Value = serde_json::from_str(current.content().as_str())
        .map_err(|_| ApiError::coded("mockup_invalid", "The content is not valid mockup JSON."))?;
    validate_mockup_spec(&spec, None)
        .map_err(|_| ApiError::coded("mockup_invalid", "The content is not a valid mockup."))?;
    approve_version(store, input, now)
}

// ---------------------------------------------------------------------------
// Screen proposals ("Propose screens")
// ---------------------------------------------------------------------------

/// Context snapshot for proposing screens: exact current versions
/// of the selected requirements. Empty selection = the whole module
/// (unarchived, with a current version). No approval barrier: generation
/// runs from saved versions and review is informative.
pub fn snapshot_screen_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    selected: &[String],
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
    if selected.is_empty() {
        let mut items = Vec::new();
        for artifact in store.artifacts_of(&project, &module) {
            if artifact.artifact_type() != ArtifactType::Requirement {
                continue;
            }
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
        if items.is_empty() {
            return Err(ApiError::coded(
                "empty_module",
                "The module has no saved requirements for proposing screens.",
            ));
        }
        items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
        return Ok(items);
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
        let artifact = ArtifactId::new(id.clone())?;
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
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Input for recording a newly validated screen generation.
pub struct RecordMockupInput {
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedMockupGeneration,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
}

/// Records the generation on disk and memory. The app creates the
/// identifier (`gen-N`); the model's temp ones never leave their scope.
pub fn record_mockup_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut MockupLog,
    db: &DbActor,
    input: RecordMockupInput,
) -> Result<MockupGenerationDto, ApiError> {
    let module = ModuleId::new(input.module_id.clone())?;
    if store.module(&module).is_some_and(|m| m.archived()) {
        return Err(CoreError::ArchivedModule { module }.into());
    }
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    let generation = StoredMockupGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        model: input.model,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version: MOCKUP_GEN_TEMPLATE_VERSION,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions,
        proposals: input
            .validated
            .screens
            .into_iter()
            .map(|s| StoredMockupProposal {
                temp_id: s.temp_id,
                title: s.title,
                spec_json: s.spec_json,
                explanation: s.explanation,
                state: ProposalState::Pending,
            })
            .collect(),
    };
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_mockup(&generation, ids_draft.checkpoint())
        .map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    mockup_to_dto(store, &generation)
}

/// A module's screen generations with their computed staleness.
pub fn list_mockup_generations(
    store: &Store,
    log: &MockupLog,
    input: ListMockupGenerationsInput,
) -> Result<Vec<MockupGenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    log.generations_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| mockup_to_dto(store, g))
        .collect()
}

/// Did any source change since the generation? Conservative: an
/// unknown or missing version also counts as stale.
pub fn mockup_generation_is_stale(store: &Store, generation: &StoredMockupGeneration) -> bool {
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

fn mockup_to_dto(
    store: &Store,
    generation: &StoredMockupGeneration,
) -> Result<MockupGenerationDto, ApiError> {
    let mut proposals = Vec::with_capacity(generation.proposals.len());
    for proposal in &generation.proposals {
        let spec: serde_json::Value = serde_json::from_str(&proposal.spec_json).map_err(|_| {
            ApiError::internal(format!(
                "screen {} of {} is not JSON",
                proposal.temp_id, generation.id
            ))
        })?;
        let (state, artifact_id) = match &proposal.state {
            ProposalState::Pending => ("pending".to_string(), None),
            ProposalState::Discarded => ("discarded".to_string(), None),
            ProposalState::Accepted { artifact_id, .. } => {
                ("accepted".to_string(), Some(artifact_id.clone()))
            }
        };
        proposals.push(MockupScreenProposalDto {
            temp_id: proposal.temp_id.clone(),
            title: proposal.title.clone(),
            spec,
            explanation: proposal.explanation.clone(),
            state,
            artifact_id,
        });
    }
    Ok(MockupGenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        model: generation.model.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: mockup_generation_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposals,
    })
}

/// Incorporates ONE screen as a NEW AI-provenance mockup, without
/// approving it and without touching existing screens. Atomic (domain +
/// state in one transaction) and idempotent per screen: retrying
/// returns the existing mockup. Blocked when the generation is
/// stale or the screen is not pending.
pub fn accept_mockup_screen(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut MockupLog,
    db: &DbActor,
    input: AcceptMockupScreenInput,
) -> Result<RequirementDetail, ApiError> {
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
                "mockup_generation_not_found",
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
                "mockup_proposal_not_found",
                format!("unknown screen: {}", input.temp_id),
            )
        })?;
    match proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "mockup_proposal_discarded",
                "The screen is discarded and cannot be incorporated.",
            ));
        }
        ProposalState::Accepted { .. } => {
            return Err(ApiError::coded(
                "mockup_proposal_accepted",
                "The screen was already incorporated.",
            ));
        }
        ProposalState::Pending => {}
    }
    if mockup_generation_is_stale(store, &generation) {
        return Err(ApiError::coded(
            "mockup_generation_stale",
            "The generation is stale: a requirement used as context changed. \
             Generate again with the current context.",
        ));
    }
    // Allowed set and sources: the context's exact versions.
    let mut allowed = Vec::with_capacity(generation.context_version_ids.len());
    let mut sources = Vec::with_capacity(generation.context_version_ids.len());
    for version_id in &generation.context_version_ids {
        let vid = VersionId::new(version_id.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "mockup_generation_stale",
                "The generation is stale.",
            ));
        };
        allowed.push(version.artifact().as_str().to_string());
        sources.push(vid);
    }
    // The saved spec revalidates against the context: hand-corrupted data
    // is not incorporated.
    let spec: serde_json::Value = serde_json::from_str(&proposal.spec_json).map_err(|_| {
        ApiError::coded(
            "mockup_invalid",
            "The saved screen is not valid mockup JSON.",
        )
    })?;
    let validated = validate_mockup_spec(&spec, Some(&allowed))?;
    let content = canonical_mockup_json(&validated);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = ids_draft.mockup();
    store_draft.create_artifact(&project, &module, artifact_id.clone(), ArtifactType::Mockup)?;
    let version_id = IdGen::version(&artifact_id, 1);
    store_draft.accept_ai_draft(
        &project,
        &artifact_id,
        None,
        version_id,
        Content::new(content.clone())?,
        &agent,
        &sources,
    )?;
    db.accept_mockup(
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

/// Discards a pending screen. Idempotent; rejects when already accepted.
pub fn discard_mockup_screen(
    log: &mut MockupLog,
    db: &DbActor,
    input: DiscardMockupScreenInput,
) -> Result<(), ApiError> {
    if log.generation(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "mockup_generation_not_found",
            format!("unknown generation: {}", input.generation_id),
        ));
    }
    db.discard_mockup(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id, &input.temp_id)
        .map_err(ApiError::storage)?;
    Ok(())
}
