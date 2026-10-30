//! Delivery baselines: prepare (query), create (atomic) and list.
//!
//! Coherence is validated by the core (`Store::create_baseline`); here
//! only the preview prepares with dependency closure and explained
//! blockers, identities and dates generate outside the domain, and
//! human metadata saves with the domain in one transaction.

use std::collections::{HashMap, HashSet};

use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, BaselineId, CoreError, Date, ModuleId, ProjectId, VersionId,
};
use ruth_store::{BaselineMeta, BaselineMetaLog, DbActor};

use crate::dto::{
    ApprovalDto, BaselineBlockerDto, BaselineCreateInput, BaselineDto, BaselineEntryDto,
    BaselineEntryPreviewDto, BaselineOutOfScopeDto, BaselinePrepareInput, BaselinePreviewDto,
    BaselineSummaryDto, ModuleScopeDto, ProvenanceDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::impact::artifact_dto;

pub(crate) fn kind_str(kind: ArtifactType) -> &'static str {
    match kind {
        ArtifactType::Requirement => "requirement",
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => "mockup",
    }
}

pub(crate) fn provenance_dto(provenance: &ruth_core::domain::Provenance) -> ProvenanceDto {
    match provenance {
        ruth_core::domain::Provenance::Human(human) => ProvenanceDto {
            kind: "human".to_string(),
            by: human.as_str().to_string(),
        },
        ruth_core::domain::Provenance::AiProposal { agent } => ProvenanceDto {
            kind: "ai".to_string(),
            by: agent.as_str().to_string(),
        },
    }
}

pub(crate) fn approval_dto(approval: &ruth_core::domain::Approval) -> ApprovalDto {
    ApprovalDto {
        version_id: approval.version().as_str().to_string(),
        approved_by: approval.approved_by().as_str().to_string(),
        at: approval.at().as_str().to_string(),
    }
}

fn project_in(store: &Store, project_id: &str) -> Result<ProjectId, ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    Ok(project)
}

/// Advisory delivery preview: chosen ones with their exact current
/// versions, transitive dependency closure, what stays out and
/// concrete blockers. Mutates nothing.
pub fn prepare_baseline(
    store: &Store,
    input: BaselinePrepareInput,
) -> Result<BaselinePreviewDto, ApiError> {
    let project = project_in(store, &input.project_id)?;
    let scope = ModuleId::new(input.scope_module_id.clone())?;
    let Some(scope_ref) = store.module(&scope) else {
        return Err(CoreError::ModuleNotFound { module: scope }.into());
    };
    if scope_ref.project() != &project {
        return Err(CoreError::ModuleNotInProject {
            module: scope.clone(),
            project: project.clone(),
        }
        .into());
    }
    if input.artifact_ids.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Pick at least one module artifact to prepare the delivery.",
        ));
    }

    // Validated selection: exists, belongs to the project and is in scope.
    let mut selected = HashSet::new();
    for raw in &input.artifact_ids {
        let id = ArtifactId::new(raw.clone())?;
        let Some(known) = store.artifact(&id) else {
            return Err(CoreError::ArtifactNotFound { artifact: id }.into());
        };
        if known.project() != &project {
            return Err(CoreError::ArtifactNotInProject {
                artifact: id,
                project: project.clone(),
            }
            .into());
        }
        if known.module() != &scope {
            return Err(ApiError::coded(
                "not_in_scope",
                format!(
                    "{} is not in module {}: the delivery covers one module at a time.",
                    id.as_str(),
                    scope.as_str()
                ),
            ));
        }
        selected.insert(id);
    }

    // Transitive closure over current versions: each included source must
    // BE its artifact's current one (otherwise the dependent is pending).
    let mut included: HashMap<ArtifactId, bool> = HashMap::new();
    for id in &selected {
        included.insert(id.clone(), false);
    }
    let mut blockers: Vec<BaselineBlockerDto> = Vec::new();
    let mut queue: Vec<ArtifactId> = selected.iter().cloned().collect();
    let mut seen = selected.clone();
    while let Some(id) = queue.pop() {
        let Some(current) = store.current_version(&id) else {
            blockers.push(BaselineBlockerDto {
                code: "missing_source".to_string(),
                message: format!("{} has no current version.", id.as_str()),
                artifact_id: Some(id.as_str().to_string()),
            });
            continue;
        };
        if !store.is_approved(current.id()) {
            let any = store
                .versions_of(&id)
                .iter()
                .any(|v| store.is_approved(v.id()));
            blockers.push(BaselineBlockerDto {
                code: "draft".to_string(),
                message: if any {
                    format!(
                        "{} is not approved at its current version ({}): approve it first.",
                        id.as_str(),
                        current.id().as_str()
                    )
                } else {
                    format!(
                        "{} is an unapproved draft: review and approve it first.",
                        id.as_str()
                    )
                },
                artifact_id: Some(id.as_str().to_string()),
            });
        }
        // Core mirror: archived entries and sources block the delivery.
        if store.is_effectively_archived(&id) {
            blockers.push(BaselineBlockerDto {
                code: "archived".to_string(),
                message: format!(
                    "{} is archived: restore it to include it in the delivery.",
                    id.as_str()
                ),
                artifact_id: Some(id.as_str().to_string()),
            });
        }
        for used in current.sources() {
            let Some(used_version) = store.version(used) else {
                blockers.push(BaselineBlockerDto {
                    code: "missing_source".to_string(),
                    message: format!("{} pins a missing source ({}).", id.as_str(), used.as_str()),
                    artifact_id: Some(id.as_str().to_string()),
                });
                continue;
            };
            let source_artifact = used_version.artifact().clone();
            if store.is_effectively_archived(&source_artifact) {
                blockers.push(BaselineBlockerDto {
                    code: "archived_source".to_string(),
                    message: format!(
                        "{} depends on {}, which is archived: restore the source or review {}.",
                        id.as_str(),
                        used.as_str(),
                        id.as_str()
                    ),
                    artifact_id: Some(id.as_str().to_string()),
                });
                continue;
            }
            let Some(source_current) = store.current_version(&source_artifact) else {
                blockers.push(BaselineBlockerDto {
                    code: "missing_source".to_string(),
                    message: format!("{} has no current version.", source_artifact.as_str()),
                    artifact_id: Some(source_artifact.as_str().to_string()),
                });
                continue;
            };
            if source_current.id() != used {
                blockers.push(BaselineBlockerDto {
                    code: "stale_sources".to_string(),
                    message: format!(
                        "{} uses a stale source ({}; the current one is {}): \
                         update it first.",
                        id.as_str(),
                        used.as_str(),
                        source_current.id().as_str()
                    ),
                    artifact_id: Some(id.as_str().to_string()),
                });
                continue;
            }
            if seen.insert(source_artifact.clone()) {
                included.insert(source_artifact.clone(), true);
                queue.push(source_artifact);
            }
        }
    }

    let mut ordered: Vec<(&ArtifactId, &bool)> = included.iter().collect();
    ordered.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
    let mut entries = Vec::with_capacity(ordered.len());
    for (id, auto) in ordered {
        let Some(known) = store.artifact(id) else {
            continue;
        };
        let Some(current) = store.current_version(id) else {
            continue;
        };
        let approvals = store.approvals_of(current.id());
        entries.push(BaselineEntryPreviewDto {
            artifact: artifact_dto(store, id)?,
            kind: kind_str(known.artifact_type()).to_string(),
            version_id: current.id().as_str().to_string(),
            number: current.number(),
            approved_by: approvals
                .first()
                .map(|a| a.approved_by().as_str().to_string()),
            approved_at: approvals.first().map(|a| a.at().as_str().to_string()),
            provenance: provenance_dto(current.provenance()),
            auto_included: *auto,
        });
    }

    let mut other_modules = Vec::new();
    for module in store.modules_of(&project) {
        if module.id() == &scope {
            continue;
        }
        let mut artifacts: Vec<String> = store
            .artifacts_of(&project, module.id())
            .iter()
            .map(|a| a.id().as_str().to_string())
            .collect();
        artifacts.sort();
        other_modules.push(ModuleScopeDto {
            id: module.id().as_str().to_string(),
            artifacts,
        });
    }
    other_modules.sort_by(|a, b| a.id.cmp(&b.id));
    // Out of scope: module items neither chosen nor pulled in by closure.
    let mut unselected: Vec<String> = store
        .artifacts_of(&project, &scope)
        .iter()
        .map(|a| a.id().clone())
        .filter(|a| !included.contains_key(a))
        .map(|a| a.as_str().to_string())
        .collect();
    unselected.sort();

    blockers.sort_by(|a, b| {
        a.code
            .cmp(&b.code)
            .then_with(|| a.artifact_id.cmp(&b.artifact_id))
    });
    Ok(BaselinePreviewDto {
        project_id: project.as_str().to_string(),
        scope_module_id: scope.as_str().to_string(),
        entries,
        out_of_scope: BaselineOutOfScopeDto {
            modules: other_modules,
            artifacts: unselected,
        },
        can_create: blockers.is_empty(),
        blockers,
    })
}

/// Explicit creation with a name: revalidates in Rust that each entry is
/// still current (on change since preparation, reports the conflict
/// without creating another delivery) and delegates coherence to the core.
/// Saves domain and metadata in one transaction; publishes on commit.
pub fn create_baseline(
    store: &mut Store,
    ids: &mut IdGen,
    metalog: &mut BaselineMetaLog,
    db: &DbActor,
    input: BaselineCreateInput,
    at: &str,
) -> Result<BaselineDto, ApiError> {
    let project = project_in(store, &input.project_id)?;
    if input.entries.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "The baseline needs at least one entry.",
        ));
    }
    if let Some(scope) = &input.scope_module_id {
        let module = ModuleId::new(scope.clone())?;
        let Some(known) = store.module(&module) else {
            return Err(CoreError::ModuleNotFound { module }.into());
        };
        if known.project() != &project {
            return Err(CoreError::ModuleNotInProject {
                module,
                project: project.clone(),
            }
            .into());
        }
    }
    // The reviewed entries must still be the exact current ones.
    let mut pairs = Vec::with_capacity(input.entries.len());
    for entry in &input.entries {
        let artifact = ArtifactId::new(entry.artifact_id.clone())?;
        let version = VersionId::new(entry.version_id.clone())?;
        let Some(current) = store.current_version(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if current.id() != &version {
            return Err(ApiError::coded(
                "changed_since_preview",
                format!(
                    "{} changed since preparation (was {}, now is {}): \
                     prepare the delivery again.",
                    artifact.as_str(),
                    version.as_str(),
                    current.id().as_str()
                ),
            ));
        }
        pairs.push((artifact, version));
    }

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let id = ids_draft.baseline();
    let date = Date::new(at.to_string())?;
    let baseline = store_draft.create_baseline(&project, id.clone(), &pairs, date)?;
    let meta = BaselineMeta {
        baseline_id: id.as_str().to_string(),
        name: input.name.trim().to_string(),
        description: input
            .description
            .map(|d| d.trim().to_string())
            .filter(|d| !d.is_empty()),
        scope_module: input.scope_module_id,
        created_at: at.to_string(),
    };
    let mut meta_draft = metalog.clone();
    meta_draft.record(meta.clone()).map_err(|e| match e {
        ruth_store::StoreError::InvalidData { message } => {
            ApiError::coded("invalid_baseline_meta", message)
        }
        other => ApiError::storage(other),
    })?;
    db.create_baseline(&store_draft, ids_draft.checkpoint(), &meta)
        .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    *metalog = meta_draft;
    baseline_dto(store, metalog, baseline.id())
}

/// Detail of a saved baseline, with approvals and provenance.
pub fn get_baseline(
    store: &Store,
    metalog: &BaselineMetaLog,
    project_id: &str,
    baseline_id: &str,
) -> Result<BaselineDto, ApiError> {
    let project = project_in(store, project_id)?;
    let id = BaselineId::new(baseline_id.to_string())?;
    let Some(baseline) = store.baseline(&id) else {
        return Err(CoreError::BaselineNotFound { baseline: id }.into());
    };
    if baseline.project() != &project {
        return Err(ApiError::coded(
            "baseline_not_in_project",
            format!(
                "{} does not belong to project {}.",
                id.as_str(),
                project.as_str()
            ),
        ));
    }
    baseline_dto(store, metalog, &id)
}

fn baseline_dto(
    store: &Store,
    metalog: &BaselineMetaLog,
    id: &BaselineId,
) -> Result<BaselineDto, ApiError> {
    let Some(baseline) = store.baseline(id) else {
        return Err(CoreError::BaselineNotFound {
            baseline: id.clone(),
        }
        .into());
    };
    let meta = metalog
        .get(id.as_str())
        .ok_or_else(|| ApiError::internal(format!("{} has no metadata", id.as_str())))?;
    let mut entries = Vec::with_capacity(baseline.entries().len());
    for (artifact, version) in baseline.entries() {
        let Some(known) = store.artifact(artifact) else {
            return Err(ApiError::internal(format!(
                "{} no longer exists",
                artifact.as_str()
            )));
        };
        let Some(pinned) = store.version(version) else {
            return Err(ApiError::internal(format!(
                "{} no longer exists",
                version.as_str()
            )));
        };
        entries.push(BaselineEntryDto {
            artifact: artifact_dto(store, artifact)?,
            kind: kind_str(known.artifact_type()).to_string(),
            // Pinned in the baseline, never the current title.
            title: baseline.title_of(artifact).flatten().map(str::to_string),
            version_id: version.as_str().to_string(),
            number: pinned.number(),
            approvals: store
                .approvals_of(version)
                .iter()
                .map(|a| approval_dto(a))
                .collect(),
            provenance: provenance_dto(pinned.provenance()),
            sources: pinned
                .sources()
                .iter()
                .map(|s| s.as_str().to_string())
                .collect(),
        });
    }
    Ok(BaselineDto {
        id: id.as_str().to_string(),
        name: meta.name.clone(),
        description: meta.description.clone(),
        project_id: baseline.project().as_str().to_string(),
        scope_module_id: meta.scope_module.clone(),
        at: baseline.at().as_str().to_string(),
        entries,
    })
}

/// Project listing with an advancement notice: which baselines are still
/// current and which ones fell behind.
pub fn list_baselines(
    store: &Store,
    metalog: &BaselineMetaLog,
    project_id: &str,
) -> Result<Vec<BaselineSummaryDto>, ApiError> {
    let project = project_in(store, project_id)?;
    let mut out = Vec::new();
    for baseline in store.baselines() {
        if baseline.project() != &project {
            continue;
        }
        let Some(meta) = metalog.get(baseline.id().as_str()) else {
            continue;
        };
        let mut advanced_artifacts = Vec::new();
        for (artifact, version) in baseline.entries() {
            let advanced = store
                .current_version(artifact)
                .map(|c| c.id() != version)
                .unwrap_or(true);
            if advanced {
                advanced_artifacts.push(artifact.as_str().to_string());
            }
        }
        advanced_artifacts.sort();
        out.push(BaselineSummaryDto {
            id: baseline.id().as_str().to_string(),
            name: meta.name.clone(),
            project_id: project.as_str().to_string(),
            scope_module_id: meta.scope_module.clone(),
            at: baseline.at().as_str().to_string(),
            entry_count: baseline.entries().len(),
            advanced: !advanced_artifacts.is_empty(),
            advanced_artifacts,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
