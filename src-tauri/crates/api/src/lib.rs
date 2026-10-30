//! Core boundary: serializable DTOs, stable errors, identifiers
//! and dates generated outside the domain, and Tauri-free command logic.
//!
//! The Tauri commands (`ruth-ide`) are thin wrappers over [`logic`]: everything
//! testable without native runtime lives here. Mutations always go
//! through the `ruth-core` use cases; this layer duplicates none of
//! their rules.

pub mod archive;
pub mod baseline;
pub mod code_links;
pub mod codegen;
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
pub mod recents;
pub mod rename;
pub mod replicate;
pub mod update;

pub use archive::{
    archive_module, archive_preview, archive_requirement, delete_module_checked,
    delete_project_checked, delete_requirement_checked, restore_module, restore_requirement,
};
pub use baseline::{create_baseline, get_baseline, list_baselines, prepare_baseline};
pub use code_links::{
    build_module_link, build_symbol_link, check_artifact_deletable, check_module_deletable,
    check_root_removable, export_portable, links_for_project, parse_portable_export,
    resolve_existing, root_by_id, snapshot_file_status, validate_snapshot, AddModuleLinkInput,
    AddSymbolLinkInput, CodeLinkDto, CurrentFile, PortableExport, SaveSnapshotInput,
    SnapshotFileDto, SnapshotFileStatus, SnapshotMetaDto, SnapshotVerifyFileDto, SymbolInput,
    SymbolRefDto, ValidatedSnapshot, PORTABILITY_VERSION,
};
pub use codegen::{
    build_stored_codegen, check_accept, context_requirement, context_screen, discard_code_file,
    generation_freshness, list_mockup_screens, record_code_generation, snapshot_code_context,
    snapshot_code_context_from_screen, AcceptCheck, AcceptReady, CodeGenContext, CodeGenFreshness,
    CodeScopeRead, CodeScreenContext, CodeScreenSourceItem, MockupScreenEntry, MockupScreens,
    RecordCodeGenInput, ScopeChange, ScopeFileInput, ScreenSourceChange,
};
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
    AcceptDesignInput, AcceptMockupScreenInput, AcceptProposalInput, ApprovalDto,
    ApproveVersionInput, ArchiveBaselineDto, ArchiveBlockerDto, ArchiveCodeLinkDto,
    ArchiveDependentDto, ArchiveGenerationDto, ArchiveModuleInput, ArchivePreviewDto,
    ArchivePreviewInput, ArchiveRequirementInput, ArtifactDto, BaselineBlockerDto,
    BaselineCreateInput, BaselineDto, BaselineEntryDto, BaselineEntryInput,
    BaselineEntryPreviewDto, BaselineGetInput, BaselineListInput, BaselineOutOfScopeDto,
    BaselinePrepareInput, BaselinePreviewDto, BaselineSummaryDto, CreateMockupInput,
    CreateModuleInput, CreateRequirementInput, DeleteModuleInput, DeleteProjectInput,
    DeleteRequirementInput, DeliveryCreateInput, DeliveryDto, DeliveryEntryDto,
    DeliveryEntryPreviewDto, DeliveryExportPreviewDto, DeliveryExportPreviewInput,
    DeliveryExportSaveDto, DeliveryExportSaveInput, DeliveryGetInput, DeliveryListInput,
    DeliveryPrepareInput, DeliveryPreviewDto, DeliverySummaryDto, DesignContextInput,
    DesignContextPreview, DesignDiffDto, DesignDiffInput, DesignGenerationDto, DesignLayoutDto,
    DesignProposalDto, DiffItemDto, DiscardDesignInput, DiscardMockupScreenInput,
    DiscardProposalInput, ExportFileDto, ExportPreviewDto, ExportPreviewInput, ExportSaveDto,
    ExportSaveInput, GenerationContextInput, GenerationContextPreview, GenerationDto,
    GetDesignLayoutInput, GetRequirementInput, ImpactOriginDto, ImpactQueryInput, ImpactReportDto,
    ImpactVersionDto, ImpactedDto, ListArtifactsInput, ListDesignsInput, ListGenerationsInput,
    ListMockupGenerationsInput, ListModulesInput, ListRequirementsInput, MockupContextPreview,
    MockupGenerationDto, MockupScreenProposalDto, ModuleDto, ModuleScopeDto, ProjectDto,
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
    accept_mockup_screen, approve_mockup_version, create_mockup, discard_mockup_screen,
    list_mockup_generations, mockup_cited_refs, mockup_context_preview, mockup_generation_is_stale,
    mockup_sources, record_mockup_generation, save_mockup_version, snapshot_mockup_context,
    snapshot_screen_context, validate_mockup_spec, validate_mockup_stored, MockupSnapshot,
    RecordMockupInput,
};
pub use persist::transact;
pub use proposals::{
    accept_proposal, compose_content, context_preview, discard_proposal, generation_is_stale,
    list_generations, record_generation, snapshot_context, validate_description, AcceptedFields,
    RecordInput,
};
pub use rename::{rename_design, rename_module, rename_project, rename_requirement};
pub use replicate::{
    apply_replication, build_replication_links, is_excluded_dir, plan_replication,
    preview_replication, suggest_base, AppliedModule, AppliedReplication, PlannedModule,
    ReplicateEntry, ReplicateInput, ReplicatePlan, ReplicatePreview, ReplicateTarget,
    MAX_REPLICATE_MODULES,
};
pub use update::{design_diff, snapshot_update_context, update_context_preview, UpdateSnapshot};
