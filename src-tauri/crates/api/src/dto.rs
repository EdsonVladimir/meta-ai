//! Serializable boundary DTOs. They mirror the domain without duplicating
//! its rules: they only carry data between Rust and the UI.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    /// Editable organizational name. At creation, the ID.
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDto {
    pub id: String,
    pub project_id: String,
    /// Editable organizational name. At creation, the ID.
    pub name: String,
    /// Reversible own archiving. Content hides by context.
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    /// Title editable as metadata (`None` = no own title: the
    /// presentation derives a readable one without touching the domain).
    pub title: Option<String>,
    /// Reversible individual archiving. Effective archiving adds the module.
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceDto {
    /// `human` o `ai`.
    pub kind: String,
    /// Origin person or agent.
    pub by: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDto {
    pub id: String,
    pub number: u32,
    pub content: String,
    pub provenance: ProvenanceDto,
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDto {
    pub version_id: String,
    pub approved_by: String,
    pub at: String,
}

/// Authoritative requirement snapshot: artifact, full history,
/// approvals and current version. The UI updates from here after
/// each mutation, with no domain caches of its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequirementDetail {
    pub artifact: ArtifactDto,
    pub versions: Vec<VersionDto>,
    pub approvals: Vec<ApprovalDto>,
    pub current_version_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateModuleInput {
    pub project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListModulesInput {
    pub project_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequirementInput {
    pub project_id: String,
    pub module_id: String,
    pub content: String,
    pub author: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequirementsInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetRequirementInput {
    pub artifact_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveVersionInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_version_id: String,
    pub content: String,
    pub author: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveVersionInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_version_id: String,
    pub approver: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDto {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

/// A generation's proposal: validated content plus state. `state` is
/// `pending`, `accepted` or `discarded`; `artifact_id` exists only when accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDto {
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
    pub state: String,
    pub artifact_id: Option<String>,
}

/// Registered generation with its original context. `stale` computes at
/// serve time: some source changed since the generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub description: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub usage: UsageDto,
    pub created_at: String,
    pub stale: bool,
    pub questions: Vec<String>,
    pub proposals: Vec<ProposalDto>,
}

/// Preview of the context to be sent: identities, size and excerpt.
/// The UI shows it before asking confirmation to generate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationContextPreview {
    pub artifact_id: String,
    pub version_id: String,
    pub chars: usize,
    pub excerpt: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListGenerationsInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationContextInput {
    pub project_id: String,
    pub module_id: String,
}

/// Acceptance of a proposal with its person-edited fields. Rust
/// revalidates limits and composes the final content.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptProposalInput {
    pub generation_id: String,
    pub temp_id: String,
    pub title: String,
    pub description: String,
    pub acceptance: Vec<String>,
    pub assumptions: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardProposalInput {
    pub generation_id: String,
    pub temp_id: String,
}

/// Design proposal: authoritative JSON spec plus derived Mermaid,
/// explanation and state. `state` is `pending`, `accepted` or
/// `discarded`; `artifact_id` exists only when accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignProposalDto {
    pub title: String,
    pub spec: serde_json::Value,
    pub mermaid: String,
    pub explanation: String,
    pub state: String,
    pub artifact_id: Option<String>,
}

/// Registered design generation with its original context. `kind` is
/// `flow` or `data_model`; `stale` computes at serve time. Update
/// proposals (milestone 8) additionally pin the target and its version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignGenerationDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    pub model: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub usage: UsageDto,
    pub created_at: String,
    pub stale: bool,
    pub questions: Vec<String>,
    pub proposal: DesignProposalDto,
    pub target_artifact_id: Option<String>,
    pub target_version_id: Option<String>,
}

/// Module requirement with its current review: the UI uses it for
/// selecting a design's sources (generation runs from saved
/// versions; review is informative).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignContextPreview {
    pub artifact_id: String,
    pub version_id: String,
    pub chars: usize,
    pub excerpt: String,
    pub approved: bool,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDesignsInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignContextInput {
    pub project_id: String,
    pub module_id: String,
}

/// Acceptance of a design with its person-edited spec
/// (the title lives inside the authoritative JSON). Without
/// `target_artifact_id` it creates the artifact; with it, it versions the
/// chosen one requiring the expected version. Rust revalidates the spec.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptDesignInput {
    pub generation_id: String,
    pub spec: serde_json::Value,
    pub target_artifact_id: Option<String>,
    pub expected_version_id: Option<String>,
}

/// Manual review of a design from the visual editor: creates a new
/// version of the SAME artifact with human provenance. Sources declare
/// explicitly (exact versions) and must be current; nobody updates
/// them silently. `layout` is the visual layout (presentation)
/// and travels in the same transaction when sent.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDesignVersionInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_version_id: String,
    pub author: String,
    pub spec: serde_json::Value,
    pub source_version_ids: Vec<String>,
    pub layout: Option<serde_json::Value>,
}

/// Manual creation of a mockup: new artifact with its first version
/// (person-drawn content, validated in Rust). Sources are
/// optional, but cited references must belong to the declared
/// sources; the initial layout travels in the same transaction.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMockupInput {
    pub project_id: String,
    pub module_id: String,
    pub author: String,
    pub spec: serde_json::Value,
    pub source_version_ids: Vec<String>,
    pub layout: Option<serde_json::Value>,
}

/// Manual review of a mockup as a new version of the SAME artifact,
/// with human provenance. Same rules as designs: declared current
/// sources (empty only without references) and expected version.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMockupVersionInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_version_id: String,
    pub author: String,
    pub spec: serde_json::Value,
    pub source_version_ids: Vec<String>,
    pub layout: Option<serde_json::Value>,
}

/// Selectable sources for generating a design from mockups and for
/// declaring a mockup's sources: the module's requirements, designs and
/// mockups with their current version and current review.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockupContextPreview {
    pub requirements: Vec<DesignContextPreview>,
    pub designs: Vec<DesignContextPreview>,
    pub mockups: Vec<DesignContextPreview>,
}

/// Structural validation of a mockup against its own citations (for
/// display and review; no network). Requires no declared sources.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateMockupInput {
    pub spec: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedMockupDto {
    pub canonical: String,
    pub title: String,
    pub screens: usize,
    pub components: usize,
}

/// Proposed screen: the canonical JSON of a ONE-screen mockup,
/// ready to preview and incorporate as a new artifact. `state`
/// is `pending`, `accepted` or `discarded`; `artifact_id` only when accepted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockupScreenProposalDto {
    pub temp_id: String,
    pub title: String,
    pub spec: serde_json::Value,
    pub explanation: String,
    pub state: String,
    pub artifact_id: Option<String>,
}

/// Registered screen generation with its exact original context.
/// `stale` computes at serve time: some source changed since then.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockupGenerationDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub model: String,
    pub context_version_ids: Vec<String>,
    pub template_version: u32,
    pub usage: UsageDto,
    pub created_at: String,
    pub stale: bool,
    pub questions: Vec<String>,
    pub proposals: Vec<MockupScreenProposalDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListMockupGenerationsInput {
    pub project_id: String,
    pub module_id: String,
}

/// Acceptance of a screen: incorporates the SAVED spec (validated at
/// recording and revalidated at accept) as a new mockup. No edited
/// spec: after incorporating, the person edits in the visual editor.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptMockupScreenInput {
    pub generation_id: String,
    pub temp_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardMockupScreenInput {
    pub generation_id: String,
    pub temp_id: String,
}

/// Saved visual layout for a version (`None` = no layout:
/// the editor uses its automatic placement).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignLayoutDto {
    pub layout: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetDesignLayoutInput {
    pub artifact_id: String,
    pub version_id: String,
}

/// Saves only an existing version's visual layout, without creating
/// a new version. For rearranging without changing semantics.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDesignLayoutInput {
    pub artifact_id: String,
    pub version_id: String,
    pub layout: serde_json::Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListArtifactsInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardDesignInput {
    pub generation_id: String,
}

/// On-demand spec validation (JSON editor, history).
/// With `generation_id` it additionally requires references inside its context.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateDesignInput {
    pub kind: String,
    pub spec: serde_json::Value,
    pub generation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedDesignDto {
    pub canonical: String,
    pub mermaid: String,
}

/// Preview of a design's update context. Without
/// `origin_artifact_id` there is no origin change or paths.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContextInput {
    pub project_id: String,
    pub artifact_id: String,
    pub origin_artifact_id: Option<String>,
    pub origin_from_version_id: Option<String>,
}

/// Reason blocking generation, with what to review first. `code` is
/// `target_up_to_date`, `source_stale`, `target_archived`,
/// `source_archived` or `source_missing`. Missing review does NOT block
/// (living design): it travels as `current_approved` on each source.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBlockerDto {
    pub code: String,
    pub message: String,
    pub artifact_id: Option<String>,
}

/// Design source with its used version and its current version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSourceDto {
    pub artifact_id: String,
    pub kind: String,
    pub used_version_id: String,
    pub used_content: String,
    pub current_version_id: String,
    pub current_content: String,
    pub changed: bool,
    pub current_approved: bool,
    pub current_valid: bool,
}

/// Origin change giving context to the update, when known.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOriginDto {
    pub artifact_id: String,
    pub from_version_id: String,
    pub from_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Advisory snapshot for proposing the update: target, current
/// design, sources with both versions, origin change, paths and
/// blockers. Generation retakes the snapshot authoritatively.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContextPreview {
    pub target: ArtifactDto,
    pub kind: String,
    pub current_version_id: String,
    pub current_number: u32,
    pub current_spec: serde_json::Value,
    pub sources: Vec<UpdateSourceDto>,
    pub origin: Option<UpdateOriginDto>,
    pub paths: Vec<Vec<String>>,
    pub blockers: Vec<UpdateBlockerDto>,
    pub can_generate: bool,
}

/// Structural diff input: two specs of the same kind.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDiffInput {
    pub kind: String,
    pub old_spec: serde_json::Value,
    pub new_spec: serde_json::Value,
}

/// Added, removed or modified diff item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffItemDto {
    pub kind: String,
    pub id: String,
    pub detail: String,
}

/// Deterministic structural differences between two designs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDiffDto {
    pub added: Vec<DiffItemDto>,
    pub removed: Vec<DiffItemDto>,
    pub modified: Vec<DiffItemDto>,
}

/// Delivery preparation: scope (module) and chosen artifacts. Versions
/// are always the current ones: historic ones are never chosen to
/// hide pendings.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselinePrepareInput {
    pub project_id: String,
    pub scope_module_id: String,
    pub artifact_ids: Vec<String>,
}

/// Foreseen entry: exact current version with approval and provenance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntryPreviewDto {
    pub artifact: ArtifactDto,
    pub kind: String,
    pub version_id: String,
    pub number: u32,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub provenance: ProvenanceDto,
    pub auto_included: bool,
}

/// Concrete blocker preventing creation. `code` is `draft`, `stale_sources`,
/// `missing_source`, `not_in_scope`, `archived` or `archived_source`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineBlockerDto {
    pub code: String,
    pub message: String,
    pub artifact_id: Option<String>,
}

/// What stays out: other modules with their artifacts and unchosen
/// scope artifacts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineOutOfScopeDto {
    pub modules: Vec<ModuleScopeDto>,
    pub artifacts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleScopeDto {
    pub id: String,
    pub artifacts: Vec<String>,
}

/// Advisory preview: the chosen plus the dependency closure, what
/// stays out and the blockers. Mutates nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselinePreviewDto {
    pub project_id: String,
    pub scope_module_id: String,
    pub entries: Vec<BaselineEntryPreviewDto>,
    pub out_of_scope: BaselineOutOfScopeDto,
    pub blockers: Vec<BaselineBlockerDto>,
    pub can_create: bool,
}

/// One exact entry of the baseline to create (reviewed in preparation).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntryInput {
    pub artifact_id: String,
    pub version_id: String,
}

/// Explicit creation with a name and optional description.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineCreateInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module_id: Option<String>,
    pub entries: Vec<BaselineEntryInput>,
}

/// Saved entry with detail for display and export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntryDto {
    pub artifact: ArtifactDto,
    pub kind: String,
    /// Title pinned at baseline creation (`None` = no title then).
    /// Historic and immutable: the current title is never consulted.
    pub title: Option<String>,
    pub version_id: String,
    pub number: u32,
    pub approvals: Vec<ApprovalDto>,
    pub provenance: ProvenanceDto,
    pub sources: Vec<String>,
}

/// Immutable baseline with its human metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub scope_module_id: Option<String>,
    pub at: String,
    pub entries: Vec<BaselineEntryDto>,
}

/// Summary for the listing: `advanced` tells the project already moved
/// past some included version.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineSummaryDto {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub scope_module_id: Option<String>,
    pub at: String,
    pub entry_count: usize,
    pub advanced: bool,
    pub advanced_artifacts: Vec<String>,
}

// --- Work/draft deliveries (living design) ---

/// Preparation: chosen artifacts of the scope module.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPrepareInput {
    pub project_id: String,
    pub scope_module_id: String,
    pub artifact_ids: Vec<String>,
}

/// Foreseen entry: exact current version with review (optional),
/// provenance and sources (stale ones flagged, no veto).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryEntryPreviewDto {
    pub artifact: ArtifactDto,
    pub kind: String,
    pub version_id: String,
    pub number: u32,
    pub approved_by: Option<String>,
    pub approved_at: Option<String>,
    pub provenance: ProvenanceDto,
    pub sources: Vec<String>,
    pub stale_sources: Vec<String>,
}

/// Advisory preview. No automatic closure: the delivery identifies
/// sources, never includes them for the user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPreviewDto {
    pub project_id: String,
    pub scope_module_id: String,
    pub entries: Vec<DeliveryEntryPreviewDto>,
    pub out_of_scope: BaselineOutOfScopeDto,
    pub can_create: bool,
    pub blockers: Vec<BaselineBlockerDto>,
    pub unreviewed_count: usize,
    pub stale_count: usize,
}

/// A delivery's detail: which project and which delivery.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryGetInput {
    pub project_id: String,
    pub delivery_id: String,
}

/// A project's delivery listing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryListInput {
    pub project_id: String,
}

/// Explicit creation with a name and optional description.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryCreateInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module_id: Option<String>,
    pub entries: Vec<BaselineEntryInput>,
}

/// Saved entry: pinned title and staleness computed on read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryEntryDto {
    pub artifact: ArtifactDto,
    pub kind: String,
    pub title: Option<String>,
    pub version_id: String,
    pub number: u32,
    pub approvals: Vec<ApprovalDto>,
    pub provenance: ProvenanceDto,
    pub sources: Vec<String>,
    pub stale_sources: Vec<String>,
}

/// A saved delivery's detail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryDto {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub project_id: String,
    pub scope_module_id: Option<String>,
    pub at: String,
    pub entries: Vec<DeliveryEntryDto>,
}

/// Summary for the listing, with honest pendings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverySummaryDto {
    pub id: String,
    pub name: String,
    pub project_id: String,
    pub scope_module_id: Option<String>,
    pub at: String,
    pub entry_count: usize,
    pub unreviewed_count: usize,
    pub stale_count: usize,
    pub advanced: bool,
    pub advanced_artifacts: Vec<String>,
}

/// Exportable package file: relative path, size and SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileDto {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Export preview: inventory without content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewDto {
    pub baseline_id: String,
    pub exporter_version: u32,
    pub files: Vec<ExportFileDto>,
    pub total_bytes: u64,
}

/// A baseline's detail: which project and which delivery.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineGetInput {
    pub project_id: String,
    pub baseline_id: String,
}

/// A project's baseline listing.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineListInput {
    pub project_id: String,
}

/// A baseline's exportable package preview.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewInput {
    pub project_id: String,
    pub baseline_id: String,
}

/// ZIP saving: destination chosen in the native dialog. `overwrite`
/// only reaches `true` after explicit confirmation over an existing file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveInput {
    pub project_id: String,
    pub baseline_id: String,
    pub dest_path: String,
    pub overwrite: bool,
}

/// Save result: where the ZIP landed, its size and its SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveDto {
    pub baseline_id: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// A work delivery's package preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportPreviewDto {
    pub delivery_id: String,
    pub exporter_version: u32,
    pub files: Vec<ExportFileDto>,
    pub total_bytes: u64,
}

/// Which work delivery to preview.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportPreviewInput {
    pub project_id: String,
    pub delivery_id: String,
}

/// A delivery's ZIP saving: native dialog destination.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportSaveInput {
    pub project_id: String,
    pub delivery_id: String,
    pub dest_path: String,
    pub overwrite: bool,
}

/// A delivery's save result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportSaveDto {
    pub delivery_id: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Impact query: the change's origin artifact and the comparison's
/// base version. Without `from_version_id` the previous compares with the
/// current; with a single version both match and there is no change to show.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactQueryInput {
    pub project_id: String,
    pub artifact_id: String,
    pub from_version_id: Option<String>,
}

/// Summarized version for the Before/Now comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactVersionDto {
    pub id: String,
    pub number: u32,
    pub content: String,
}

/// The change's origin with its version comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactOriginDto {
    pub artifact: ArtifactDto,
    pub from_version: ImpactVersionDto,
    pub current_version: ImpactVersionDto,
}

/// A source pinned by the current version versus its artifact's
/// current one. When the source no longer resolves (tampered state: the
/// core treats it as stale), `source_artifact_id` and `current_version_id`
/// are null and `stale` is true.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePinDto {
    pub used_version_id: String,
    pub source_artifact_id: Option<String>,
    pub current_version_id: Option<String>,
    pub stale: bool,
}

/// Artifact reached by the change. `requires_review` is the negated
/// currency the core computes (never a stored flag); `paths` are the
/// artifact paths justifying the impact; `approvals` are the
/// current version's and `approved_before` tells whether some earlier
/// version was approved (both facts coexist: historically approved and
/// pending today never contradict each other).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactedDto {
    pub artifact: ArtifactDto,
    pub current_version_id: String,
    pub current_number: u32,
    pub requires_review: bool,
    pub stale_sources: Vec<String>,
    pub pins: Vec<SourcePinDto>,
    pub approvals: Vec<ApprovalDto>,
    pub approved_before: bool,
    pub paths: Vec<Vec<String>>,
}

/// Impact report: origin with comparison and ordered affected items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReportDto {
    pub project_id: String,
    pub origin: ImpactOriginDto,
    pub affected: Vec<ImpactedDto>,
}

/// Advisory summary before archiving or deleting. `kind` is `module` or
/// `requirement`. Mutates nothing; execution revalidates in Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreviewInput {
    pub project_id: String,
    pub kind: String,
    pub id: String,
}

/// The target's dependent, with its module for telling apart
/// internal references from other-module ones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDependentDto {
    pub artifact: ArtifactDto,
    pub same_module: bool,
}

/// Baseline including the target. Historic and immutable: it stays
/// queryable and exportable even when archived.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBaselineDto {
    pub id: String,
    pub name: String,
}

/// Generation mentioning the target. `log` is `requirement` or `design`;
/// `role` is `owns` (the generation's module), `context` (a version in
/// its context), `accepted` (the proposal created the artifact) or
/// `target` (an update aimed at it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveGenerationDto {
    pub id: String,
    pub log: String,
    pub role: String,
}

/// Definitive-deletion blocker: stable code and message for people.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBlockerDto {
    pub code: String,
    pub message: String,
}

/// Archive/delete summary: content (modules), dependents, baselines,
/// generations, code links, approvals and whether deleting is safe
/// with its blockers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreviewDto {
    pub project_id: String,
    pub kind: String,
    pub id: String,
    pub archived: bool,
    pub contents: Vec<ArtifactDto>,
    /// The project's modules. Only for `kind == "project"`; empty
    /// otherwise (its `contents` already brings the artifacts).
    pub modules: Vec<ModuleDto>,
    pub dependents: Vec<ArchiveDependentDto>,
    pub baselines: Vec<ArchiveBaselineDto>,
    /// Work deliveries including it (`{id, name}` shape).
    pub deliveries: Vec<ArchiveBaselineDto>,
    pub generations: Vec<ArchiveGenerationDto>,
    /// Code links (folders, files or symbols).
    pub code_links: Vec<ArchiveCodeLinkDto>,
    pub approvals: usize,
    pub versions: usize,
    pub can_delete: bool,
    pub delete_blockers: Vec<ArchiveBlockerDto>,
}

/// Code link in the summary: destination and kind (manual/detected).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCodeLinkDto {
    pub id: String,
    pub root_id: String,
    pub rel: String,
    pub symbol_name: Option<String>,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveModuleInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteModuleInput {
    pub project_id: String,
    pub module_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRequirementInput {
    pub project_id: String,
    pub artifact_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequirementInput {
    pub project_id: String,
    pub artifact_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteProjectInput {
    pub project_id: String,
}

/// Renaming requires the expected name: when it changed since read, Rust
/// rejects with `stale_name` instead of overwriting.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProjectInput {
    pub project_id: String,
    pub expected_name: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameModuleInput {
    pub project_id: String,
    pub module_id: String,
    pub expected_name: String,
    pub name: String,
}

/// `expected_title` is `None` when the artifact has no own title.
/// `by` signs the change in the title history.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameArtifactInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_title: Option<String>,
    pub title: String,
    pub by: String,
}
