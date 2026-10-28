//! Frontera del núcleo: DTOs serializables, errores estables, identificadores
//! y fechas generados fuera del dominio, y lógica de comandos sin Tauri.
//!
//! Los comandos Tauri (`ruth-ide`) son envoltorios finos sobre [`logic`]: aquí
//! vive todo lo testeable sin tiempo de ejecución nativo. Las mutaciones
//! pasan siempre por los casos de uso de `ruth-core`; esta capa no duplica
//! sus reglas.

pub mod archive;
pub mod baseline;
pub mod delivery;
pub mod design;
mod dto;
mod error;
pub mod export;
mod ids;
pub mod impact;
mod logic;
pub mod mockup;
mod persist;
pub mod proposals;
pub mod rename;
pub mod update;

pub use archive::{
    archive_module, archive_preview, archive_requirement, delete_module_checked,
    delete_requirement_checked, restore_module, restore_requirement,
};
pub use baseline::{create_baseline, get_baseline, list_baselines, prepare_baseline};
pub use delivery::{
    create_work_delivery, get_work_delivery, list_work_deliveries, prepare_work_delivery,
};
pub use design::{
    accept_design, approve_design_version, design_context_preview, design_is_stale, design_layout,
    discard_design, list_designs, record_design_generation, sanitize_layout,
    save_design_layout_only, save_design_version, snapshot_design_context, validate_design,
    validate_spec, RecordDesignInput, UpdateTarget,
};
pub use dto::{
    AcceptDesignInput, AcceptProposalInput, ApprovalDto, ApproveVersionInput, ArchiveBaselineDto,
    ArchiveBlockerDto, ArchiveDependentDto, ArchiveGenerationDto, ArchiveModuleInput,
    ArchivePreviewDto, ArchivePreviewInput, ArchiveRequirementInput, ArtifactDto,
    BaselineBlockerDto, BaselineCreateInput, BaselineDto, BaselineEntryDto, BaselineEntryInput,
    BaselineEntryPreviewDto, BaselineGetInput, BaselineListInput, BaselineOutOfScopeDto,
    BaselinePrepareInput, BaselinePreviewDto, BaselineSummaryDto, CreateMockupInput,
    CreateModuleInput, CreateRequirementInput, DeleteModuleInput, DeleteRequirementInput,
    DeliveryCreateInput, DeliveryDto, DeliveryEntryDto, DeliveryEntryPreviewDto,
    DeliveryExportPreviewDto, DeliveryExportPreviewInput, DeliveryExportSaveDto,
    DeliveryExportSaveInput, DeliveryGetInput, DeliveryListInput, DeliveryPrepareInput,
    DeliveryPreviewDto, DeliverySummaryDto, DesignContextInput, DesignContextPreview,
    DesignDiffDto, DesignDiffInput, DesignGenerationDto, DesignLayoutDto, DesignProposalDto,
    DiffItemDto, DiscardDesignInput, DiscardProposalInput, ExportFileDto, ExportPreviewDto,
    ExportPreviewInput, ExportSaveDto, ExportSaveInput, GenerationContextInput,
    GenerationContextPreview, GenerationDto, GetDesignLayoutInput, GetRequirementInput,
    ImpactOriginDto, ImpactQueryInput, ImpactReportDto, ImpactVersionDto, ImpactedDto,
    ListArtifactsInput, ListDesignsInput, ListGenerationsInput, ListModulesInput,
    ListRequirementsInput, MockupContextPreview, ModuleDto, ModuleScopeDto, ProjectDto,
    ProposalDto, RenameArtifactInput, RenameModuleInput, RenameProjectInput, RequirementDetail,
    SaveDesignLayoutInput, SaveDesignVersionInput, SaveMockupVersionInput, SaveVersionInput,
    SourcePinDto, UpdateBlockerDto, UpdateContextInput, UpdateContextPreview, UpdateOriginDto,
    UpdateSourceDto, UsageDto, ValidateDesignInput, ValidateMockupInput, ValidatedDesignDto,
    ValidatedMockupDto, VersionDto,
};
pub use error::ApiError;
pub use export::{
    build_delivery_files, build_export_files, export_delivery_preview, export_preview,
    package_to_zip, zip_sha256, ExportFile, EXPORTER_VERSION, EXPORT_FORMAT,
};
pub use ids::{iso8601_from_unix_secs, now_utc_iso8601, IdGen};
pub use impact::impact_report;
pub use logic::{
    approve_version, create_module, create_project, create_requirement, get_requirement,
    list_artifacts, list_modules, list_projects, list_requirements, save_version,
};
pub use mockup::{
    approve_mockup_version, create_mockup, mockup_cited_refs, mockup_context_preview,
    mockup_sources, save_mockup_version, snapshot_mockup_context, validate_mockup_spec,
    validate_mockup_stored, MockupSnapshot,
};
pub use persist::transact;
pub use proposals::{
    accept_proposal, compose_content, context_preview, discard_proposal, generation_is_stale,
    list_generations, record_generation, snapshot_context, validate_description, AcceptedFields,
    RecordInput,
};
pub use rename::{rename_design, rename_module, rename_project, rename_requirement};
pub use update::{design_diff, snapshot_update_context, update_context_preview, UpdateSnapshot};
