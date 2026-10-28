//! DTOs serializables de la frontera. Reflejan el dominio sin duplicar sus
//! reglas: solo transportan datos entre Rust y la interfaz.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    /// Nombre organizativo editable. Al crear, el ID.
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDto {
    pub id: String,
    pub project_id: String,
    /// Nombre organizativo editable. Al crear, el ID.
    pub name: String,
    /// Archivado propio reversible. El contenido se oculta por contexto.
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
    /// Título editable como metadato (`None` = sin título propio: la
    /// presentación deriva uno legible sin tocar el dominio).
    pub title: Option<String>,
    /// Archivado individual reversible. El archivado efectivo suma el módulo.
    pub archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceDto {
    /// `human` o `ai`.
    pub kind: String,
    /// Persona o agente de origen.
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

/// Instantánea autoritativa de un requisito: artefacto, historial completo,
/// aprobaciones y versión actual. La interfaz actualiza desde aquí tras
/// cada mutación, sin cachés propias del dominio.
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

/// Propuesta de una generación: contenido validado más estado. `state` es
/// `pending`, `accepted` o `discarded`; `artifact_id` solo existe aceptada.
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

/// Generación registrada con su contexto original. `stale` se calcula al
/// servir: cambió alguna fuente desde la generación.
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

/// Vista previa del contexto que se enviará: identidades, tamaño y extracto.
/// La interfaz la muestra antes de pedir confirmación para generar.
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

/// Aceptación de una propuesta con sus campos editados por la persona. Rust
/// vuelve a validar límites y compone el contenido definitivo.
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

/// Propuesta de diseño: especificación JSON autoritativa más Mermaid
/// derivado, explicación y estado. `state` es `pending`, `accepted` o
/// `discarded`; `artifact_id` solo existe aceptada.
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

/// Generación de diseño registrada con su contexto original. `kind` es
/// `flow` o `data_model`; `stale` se calcula al servir. Las propuestas de
/// actualización (hito 8) fijan además el objetivo y su versión.
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

/// Requisito del módulo con su revisión vigente: la interfaz lo usa para
/// seleccionar las fuentes de un diseño (se genera desde versiones
/// guardadas; la revisión es informativa).
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

/// Aceptación de un diseño con su especificación editada por la persona
/// (el título vive dentro del JSON autoritativo). Sin `target_artifact_id`
/// crea el artefacto; con él, versiona el elegido exigiendo la versión
/// esperada. Rust revalida la especificación.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptDesignInput {
    pub generation_id: String,
    pub spec: serde_json::Value,
    pub target_artifact_id: Option<String>,
    pub expected_version_id: Option<String>,
}

/// Revisión manual de un diseño desde el editor visual: crea una versión
/// nueva del MISMO artefacto con procedencia humana. Las fuentes se declaran
/// explícitamente (versiones exactas) y deben estar vigentes; nadie las
/// actualiza en silencio. `layout` es la disposición visual (presentación)
/// y viaja en la misma transacción cuando se envía.
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

/// Creación manual de un mockup: artefacto nuevo con su primera versión
/// (contenido dibujado por la persona, validado en Rust). Las fuentes son
/// opcionales, pero las referencias citadas deben pertenecer a las fuentes
/// declaradas; la disposición inicial viaja en la misma transacción.
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

/// Revisión manual de un mockup como versión nueva del MISMO artefacto,
/// con procedencia humana. Mismas reglas que en diseños: fuentes vigentes
/// declaradas (vacías solo sin referencias) y versión esperada.
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

/// Fuentes seleccionables para generar un diseño desde mockups y para
/// declarar fuentes de un mockup: requisitos, diseños y mockups del
/// módulo con su versión actual y su revisión vigente.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MockupContextPreview {
    pub requirements: Vec<DesignContextPreview>,
    pub designs: Vec<DesignContextPreview>,
    pub mockups: Vec<DesignContextPreview>,
}

/// Validación estructural de un mockup contra sus propias citas (para
/// mostrar y revisar; sin red). No exige fuentes declaradas.
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

/// Disposición visual guardada para una versión (`None` = sin disposición:
/// el editor usa su trazado automático).
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

/// Guarda solo la disposición visual de una versión existente, sin crear
/// versión nueva. Para reordenar sin cambiar la semántica.
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

/// Validación bajo demanda de una especificación (editor JSON, historial).
/// Con `generation_id` exige además referencias dentro de su contexto.
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

/// Vista previa del contexto de actualización de un diseño. Sin
/// `origin_artifact_id` no hay cambio origen ni caminos.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContextInput {
    pub project_id: String,
    pub artifact_id: String,
    pub origin_artifact_id: Option<String>,
    pub origin_from_version_id: Option<String>,
}

/// Motivo que bloquea la generación, con qué revisar primero. `code` es
/// `target_up_to_date`, `source_stale`, `target_archived`,
/// `source_archived` o `source_missing`. La falta de revisión NO bloquea
/// (diseño vivo): viaja como `current_approved` en cada fuente.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBlockerDto {
    pub code: String,
    pub message: String,
    pub artifact_id: Option<String>,
}

/// Fuente del diseño con su versión utilizada y su versión actual.
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

/// Cambio origen que contextualiza la actualización, si se conoce.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOriginDto {
    pub artifact_id: String,
    pub from_version_id: String,
    pub from_content: String,
    pub current_version_id: String,
    pub current_content: String,
}

/// Snapshot consultivo para proponer la actualización: objetivo, diseño
/// actual, fuentes con sus dos versiones, cambio origen, caminos y
/// bloqueos. La generación vuelve a tomar el snapshot de forma autoritativa.
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

/// Entrada del diff estructural: dos especificaciones del mismo tipo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDiffInput {
    pub kind: String,
    pub old_spec: serde_json::Value,
    pub new_spec: serde_json::Value,
}

/// Elemento añadido, eliminado o modificado del diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffItemDto {
    pub kind: String,
    pub id: String,
    pub detail: String,
}

/// Diferencias estructurales deterministas entre dos diseños.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignDiffDto {
    pub added: Vec<DiffItemDto>,
    pub removed: Vec<DiffItemDto>,
    pub modified: Vec<DiffItemDto>,
}

/// Preparación de entrega: alcance (módulo) y artefactos elegidos. Las
/// versiones son siempre las actuales: nunca se eligen históricas para
/// ocultar pendientes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselinePrepareInput {
    pub project_id: String,
    pub scope_module_id: String,
    pub artifact_ids: Vec<String>,
}

/// Entrada prevista: versión actual exacta con aprobación y procedencia.
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

/// Bloqueo concreto que impide crear. `code` es `draft`, `stale_sources`,
/// `missing_source`, `not_in_scope`, `archived` o `archived_source`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineBlockerDto {
    pub code: String,
    pub message: String,
    pub artifact_id: Option<String>,
}

/// Lo que queda fuera: otros módulos con sus artefactos y artefactos del
/// alcance no elegidos.
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

/// Vista previa consultiva: lo elegido más el cierre de dependencias, lo
/// que queda fuera y los bloqueos. No muta nada.
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

/// Una entrada exacta de la baseline a crear (revisada en la preparación).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntryInput {
    pub artifact_id: String,
    pub version_id: String,
}

/// Creación explícita con nombre y descripción opcional.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineCreateInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module_id: Option<String>,
    pub entries: Vec<BaselineEntryInput>,
}

/// Entrada guardada con detalle para mostrar y exportar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineEntryDto {
    pub artifact: ArtifactDto,
    pub kind: String,
    /// Título fijado al crear la baseline (`None` = sin título entonces).
    /// Histórica e inmutable: jamás se consulta el título actual.
    pub title: Option<String>,
    pub version_id: String,
    pub number: u32,
    pub approvals: Vec<ApprovalDto>,
    pub provenance: ProvenanceDto,
    pub sources: Vec<String>,
}

/// Baseline inmutable con sus metadatos humanos.
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

/// Resumen para el listado: `advanced` indica que el proyecto ya avanzó
/// más allá de alguna versión incluida.
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

// --- Entregas de trabajo/borrador (diseño vivo) ---

/// Preparación: artefactos elegidos del módulo de alcance.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryPrepareInput {
    pub project_id: String,
    pub scope_module_id: String,
    pub artifact_ids: Vec<String>,
}

/// Entrada prevista: versión actual exacta con revisión (opcional),
/// procedencia y fuentes (con las desactualizadas señaladas, sin veto).
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

/// Vista previa consultiva. Sin cierre automático: la entrega identifica
/// fuentes, no las incluye por el usuario.
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

/// Detalle de una entrega: qué proyecto y qué entrega.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryGetInput {
    pub project_id: String,
    pub delivery_id: String,
}

/// Listado de entregas de un proyecto.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryListInput {
    pub project_id: String,
}

/// Creación explícita con nombre y descripción opcional.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryCreateInput {
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module_id: Option<String>,
    pub entries: Vec<BaselineEntryInput>,
}

/// Entrada guardada: título fijado y desactualización calculada al leer.
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

/// Detalle de una entrega guardada.
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

/// Resumen para el listado, con pendientes honestos.
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

/// Archivo del paquete exportable: ruta relativa, tamaño y SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFileDto {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Vista previa de la exportación: inventario sin contenido.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewDto {
    pub baseline_id: String,
    pub exporter_version: u32,
    pub files: Vec<ExportFileDto>,
    pub total_bytes: u64,
}

/// Detalle de una baseline: qué proyecto y qué entrega.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineGetInput {
    pub project_id: String,
    pub baseline_id: String,
}

/// Listado de baselines de un proyecto.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineListInput {
    pub project_id: String,
}

/// Vista previa del paquete exportable de una baseline.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPreviewInput {
    pub project_id: String,
    pub baseline_id: String,
}

/// Guardado del ZIP: destino elegido en el diálogo nativo. `overwrite`
/// solo llega a `true` tras confirmación explícita ante un archivo existente.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveInput {
    pub project_id: String,
    pub baseline_id: String,
    pub dest_path: String,
    pub overwrite: bool,
}

/// Resultado del guardado: dónde quedó el ZIP, su tamaño y su SHA-256.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportSaveDto {
    pub baseline_id: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Vista previa del paquete de una entrega de trabajo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportPreviewDto {
    pub delivery_id: String,
    pub exporter_version: u32,
    pub files: Vec<ExportFileDto>,
    pub total_bytes: u64,
}

/// Qué entrega de trabajo previsualizar.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportPreviewInput {
    pub project_id: String,
    pub delivery_id: String,
}

/// Guardado del ZIP de una entrega: destino del diálogo nativo.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportSaveInput {
    pub project_id: String,
    pub delivery_id: String,
    pub dest_path: String,
    pub overwrite: bool,
}

/// Resultado del guardado de una entrega.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryExportSaveDto {
    pub delivery_id: String,
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Consulta de impacto: artefacto origen del cambio y versión base de la
/// comparación. Sin `from_version_id` se compara la anterior con la actual;
/// con una sola versión, ambas coinciden y no hay cambio que mostrar.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactQueryInput {
    pub project_id: String,
    pub artifact_id: String,
    pub from_version_id: Option<String>,
}

/// Versión resumida para la comparación Antes/Ahora.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactVersionDto {
    pub id: String,
    pub number: u32,
    pub content: String,
}

/// Origen del cambio con su comparación de versiones.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactOriginDto {
    pub artifact: ArtifactDto,
    pub from_version: ImpactVersionDto,
    pub current_version: ImpactVersionDto,
}

/// Una fuente fijada por la versión actual frente a la actual de su
/// artefacto. Si la fuente ya no se resuelve (estado manipulado: el núcleo
/// la trata como no vigente), `source_artifact_id` y `current_version_id`
/// son nulos y `stale` es verdadero.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePinDto {
    pub used_version_id: String,
    pub source_artifact_id: Option<String>,
    pub current_version_id: Option<String>,
    pub stale: bool,
}

/// Artefacto alcanzado por el cambio. `requires_review` es la vigencia
/// negada que calcula el núcleo (nunca un flag guardado); `paths` son los
/// caminos de artefactos que justifican el impacto; `approvals` son las de
/// la versión actual y `approved_before` indica si alguna versión anterior
/// se aprobó (ambos hechos conviven: aprobado históricamente y pendiente
/// hoy no se contradicen).
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

/// Informe de impacto: origen con comparación y afectados ordenados.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImpactReportDto {
    pub project_id: String,
    pub origin: ImpactOriginDto,
    pub affected: Vec<ImpactedDto>,
}

/// Resumen consultivo antes de archivar o eliminar. `kind` es `module` o
/// `requirement`. No muta nada; la ejecución revalida en Rust.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreviewInput {
    pub project_id: String,
    pub kind: String,
    pub id: String,
}

/// Dependiente del objetivo, con su módulo para distinguir referencias
/// internas de las que vienen de otros módulos.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDependentDto {
    pub artifact: ArtifactDto,
    pub same_module: bool,
}

/// Baseline que incluye al objetivo. Histórica e inmutable: seguirá
/// consultable y exportable aunque se archive.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBaselineDto {
    pub id: String,
    pub name: String,
}

/// Generación que menciona al objetivo. `log` es `requirement` o `design`;
/// `role` es `owns` (módulo de la generación), `context` (versión en su
/// contexto), `accepted` (la propuesta creó el artefacto) o `target`
/// (actualización dirigida a él).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveGenerationDto {
    pub id: String,
    pub log: String,
    pub role: String,
}

/// Bloqueo del borrado definitivo: código estable y mensaje para personas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveBlockerDto {
    pub code: String,
    pub message: String,
}

/// Resumen de archivo/borrado: contenido (módulos), dependientes, baselines,
/// generaciones, aprobaciones y si el borrado es seguro con sus bloqueos.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePreviewDto {
    pub project_id: String,
    pub kind: String,
    pub id: String,
    pub archived: bool,
    pub contents: Vec<ArtifactDto>,
    pub dependents: Vec<ArchiveDependentDto>,
    pub baselines: Vec<ArchiveBaselineDto>,
    /// Entregas de trabajo que lo incluyen (forma `{id, name}`).
    pub deliveries: Vec<ArchiveBaselineDto>,
    pub generations: Vec<ArchiveGenerationDto>,
    pub approvals: usize,
    pub versions: usize,
    pub can_delete: bool,
    pub delete_blockers: Vec<ArchiveBlockerDto>,
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

/// Renombrar exige el nombre esperado: si cambió desde que se leyó, Rust
/// rechaza con `stale_name` en vez de sobrescribir.
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

/// `expected_title` es `None` cuando el artefacto no tiene título propio.
/// `by` firma el cambio en el historial de títulos.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameArtifactInput {
    pub project_id: String,
    pub artifact_id: String,
    pub expected_title: Option<String>,
    pub title: String,
    pub by: String,
}
