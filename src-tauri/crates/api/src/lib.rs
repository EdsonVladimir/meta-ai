//! Frontera del núcleo: DTOs serializables, errores estables, identificadores
//! y fechas generados fuera del dominio, y lógica de comandos sin Tauri.
//!
//! Los comandos Tauri (`ruth-ide`) son envoltorios finos sobre [`logic`]: aquí
//! vive todo lo testeable sin tiempo de ejecución nativo. Las mutaciones
//! pasan siempre por los casos de uso de `ruth-core`; esta capa no duplica
//! sus reglas.

pub mod design;
mod dto;
mod error;
mod ids;
mod logic;
mod persist;
pub mod proposals;

pub use design::{
    accept_design, approve_design_version, design_context_preview, design_is_stale, discard_design,
    list_designs, record_design_generation, snapshot_approved_context, validate_design,
    validate_spec, RecordDesignInput,
};
pub use dto::{
    AcceptDesignInput, AcceptProposalInput, ApprovalDto, ApproveVersionInput, ArtifactDto,
    CreateModuleInput, CreateRequirementInput, DesignContextInput, DesignContextPreview,
    DesignGenerationDto, DesignProposalDto, DiscardDesignInput, DiscardProposalInput,
    GenerationContextInput, GenerationContextPreview, GenerationDto, GetRequirementInput,
    ListArtifactsInput, ListDesignsInput, ListGenerationsInput, ListModulesInput,
    ListRequirementsInput, ModuleDto, ProjectDto, ProposalDto, RequirementDetail, SaveVersionInput,
    UsageDto, ValidateDesignInput, ValidatedDesignDto, VersionDto,
};
pub use error::ApiError;
pub use ids::{iso8601_from_unix_secs, now_utc_iso8601, IdGen};
pub use logic::{
    approve_version, create_module, create_project, create_requirement, get_requirement,
    list_artifacts, list_modules, list_projects, list_requirements, save_version,
};
pub use persist::transact;
pub use proposals::{
    accept_proposal, compose_content, context_preview, discard_proposal, generation_is_stale,
    list_generations, record_generation, snapshot_context, validate_description, AcceptedFields,
    RecordInput,
};
