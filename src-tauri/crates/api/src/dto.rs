//! DTOs serializables de la frontera. Reflejan el dominio sin duplicar sus
//! reglas: solo transportan datos entre Rust y la interfaz.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleDto {
    pub id: String,
    pub project_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactDto {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub kind: String,
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
/// `flow` o `data_model`; `stale` se calcula al servir.
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
}

/// Requisito del módulo con su aprobación vigente: la interfaz lo usa para
/// seleccionar las fuentes de un diseño (solo aprobados generan).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignContextPreview {
    pub artifact_id: String,
    pub version_id: String,
    pub chars: usize,
    pub excerpt: String,
    pub approved: bool,
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
