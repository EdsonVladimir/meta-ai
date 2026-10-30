//! Work/draft deliveries: prepare (query), create (atomic),
//! get and list.
//!
//! Snapshot of saved versions WITHOUT requiring approval (living design).
//! Structural coherence is validated by the core
//! (`Store::create_work_delivery`); here the preview prepares with
//! identified sources (including stale ones, without vetoing),
//! optional reviews and structural-only blockers. No automatic
//! closing or separate metalog: the delivery carries name, description
//! and scope inside. It must never be called coherent or verified when
//! it has pendings: the counters say so out loud.

use std::collections::HashSet;

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, CoreError, Date, DeliveryId, ModuleId, Name, ProjectId};
use ruth_store::DbActor;

use crate::baseline::{approval_dto, kind_str, provenance_dto};
use crate::dto::{
    BaselineBlockerDto, BaselineOutOfScopeDto, DeliveryCreateInput, DeliveryDto, DeliveryEntryDto,
    DeliveryEntryPreviewDto, DeliveryPrepareInput, DeliveryPreviewDto, DeliverySummaryDto,
    ModuleScopeDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::impact::artifact_dto;

fn project_in(store: &Store, project_id: &str) -> Result<ProjectId, ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    Ok(project)
}

/// Pinned sources of a version that are no longer their artifact's
/// current ones. Informative: identifies staleness, never blocks.
fn stale_sources_of(store: &Store, version: &ruth_core::domain::Version) -> Vec<String> {
    let mut stale = Vec::new();
    for source in version.sources() {
        let Some(source_version) = store.version(source) else {
            continue;
        };
        let outdated = store
            .current_version(source_version.artifact())
            .map(|c| c.id() != source)
            .unwrap_or(false);
        if outdated {
            stale.push(source.as_str().to_string());
        }
    }
    stale.sort();
    stale
}

/// Advisory preview: chosen ones with their exact current versions,
/// identified sources and structural-only blockers. Mutates nothing.
pub fn prepare_work_delivery(
    store: &Store,
    input: DeliveryPrepareInput,
) -> Result<DeliveryPreviewDto, ApiError> {
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

    let mut blockers: Vec<BaselineBlockerDto> = Vec::new();
    let mut ordered: Vec<&ArtifactId> = selected.iter().collect();
    ordered.sort_by(|a, b| a.as_str().cmp(b.as_str()));
    let mut entries = Vec::with_capacity(ordered.len());
    for id in &ordered {
        let Some(current) = store.current_version(id) else {
            blockers.push(BaselineBlockerDto {
                code: "missing_source".to_string(),
                message: format!("{} has no current version.", id.as_str()),
                artifact_id: Some(id.as_str().to_string()),
            });
            continue;
        };
        // Core mirror: archived entries and sources block.
        if store.is_effectively_archived(id) {
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
                continue;
            };
            if store.is_effectively_archived(used_version.artifact()) {
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
            }
        }
        let Some(known) = store.artifact(id) else {
            continue;
        };
        let approvals = store.approvals_of(current.id());
        entries.push(DeliveryEntryPreviewDto {
            artifact: artifact_dto(store, id)?,
            kind: kind_str(known.artifact_type()).to_string(),
            version_id: current.id().as_str().to_string(),
            number: current.number(),
            approved_by: approvals
                .first()
                .map(|a| a.approved_by().as_str().to_string()),
            approved_at: approvals.first().map(|a| a.at().as_str().to_string()),
            provenance: provenance_dto(current.provenance()),
            sources: current
                .sources()
                .iter()
                .map(|s| s.as_str().to_string())
                .collect(),
            stale_sources: stale_sources_of(store, current),
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
    let mut unselected: Vec<String> = store
        .artifacts_of(&project, &scope)
        .iter()
        .map(|a| a.id().clone())
        .filter(|a| !selected.contains(a))
        .map(|a| a.as_str().to_string())
        .collect();
    unselected.sort();

    blockers.sort_by(|a, b| {
        a.code
            .cmp(&b.code)
            .then_with(|| a.artifact_id.cmp(&b.artifact_id))
    });
    let unreviewed_count = entries.iter().filter(|e| e.approved_by.is_none()).count();
    let stale_count = entries
        .iter()
        .filter(|e| !e.stale_sources.is_empty())
        .count();
    Ok(DeliveryPreviewDto {
        project_id: project.as_str().to_string(),
        scope_module_id: scope.as_str().to_string(),
        entries,
        out_of_scope: BaselineOutOfScopeDto {
            modules: other_modules,
            artifacts: unselected,
        },
        can_create: blockers.is_empty(),
        blockers,
        unreviewed_count,
        stale_count,
    })
}

/// Explicit creation with a name: revalidates in Rust that each entry is
/// still the exact current one (on change since preparation, reports
/// the conflict without creating another delivery) and delegates to the core.
/// Saves the domain in a transaction; publishes on commit.
pub fn create_work_delivery(
    store: &mut Store,
    ids: &mut IdGen,
    db: &DbActor,
    input: DeliveryCreateInput,
    at: &str,
) -> Result<DeliveryDto, ApiError> {
    let project = project_in(store, &input.project_id)?;
    if input.entries.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "The delivery needs at least one entry.",
        ));
    }
    let name = Name::new(input.name)?;
    let scope = match input.scope_module_id {
        None => None,
        Some(raw) => {
            let module = ModuleId::new(raw)?;
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
            Some(module)
        }
    };
    // The reviewed entries must still be the exact current ones.
    let mut pairs = Vec::with_capacity(input.entries.len());
    for entry in &input.entries {
        let artifact = ArtifactId::new(entry.artifact_id.clone())?;
        let version = ruth_core::domain::VersionId::new(entry.version_id.clone())?;
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
    let id = ids_draft.delivery();
    let date = Date::new(at.to_string())?;
    let description = input
        .description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty());
    let delivery = store_draft.create_work_delivery(
        &project,
        id.clone(),
        name.as_str().to_string(),
        description,
        scope,
        &pairs,
        date,
    )?;
    db.save(&store_draft, ids_draft.checkpoint())
        .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    delivery_dto(store, delivery.id())
}

/// Detail of a saved delivery, with reviews and staleness computed
/// on read (pins are immutable; their reading is not).
pub fn get_work_delivery(
    store: &Store,
    project_id: &str,
    delivery_id: &str,
) -> Result<DeliveryDto, ApiError> {
    let project = project_in(store, project_id)?;
    let id = DeliveryId::new(delivery_id.to_string())?;
    let Some(delivery) = store.delivery(&id) else {
        return Err(CoreError::DeliveryNotFound { delivery: id }.into());
    };
    if delivery.project() != &project {
        return Err(ApiError::coded(
            "delivery_not_in_project",
            format!(
                "{} does not belong to project {}.",
                id.as_str(),
                project.as_str()
            ),
        ));
    }
    delivery_dto(store, &id)
}

fn delivery_dto(store: &Store, id: &DeliveryId) -> Result<DeliveryDto, ApiError> {
    let Some(delivery) = store.delivery(id) else {
        return Err(CoreError::DeliveryNotFound {
            delivery: id.clone(),
        }
        .into());
    };
    let mut entries = Vec::with_capacity(delivery.entries().len());
    for (artifact, version) in delivery.entries() {
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
        entries.push(DeliveryEntryDto {
            artifact: artifact_dto(store, artifact)?,
            kind: kind_str(known.artifact_type()).to_string(),
            title: delivery.title_of(artifact).flatten().map(str::to_string),
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
            stale_sources: stale_sources_of(store, pinned),
        });
    }
    Ok(DeliveryDto {
        id: id.as_str().to_string(),
        name: delivery.name().to_string(),
        description: delivery.description().map(str::to_string),
        project_id: delivery.project().as_str().to_string(),
        scope_module_id: delivery.scope_module().map(|m| m.as_str().to_string()),
        at: delivery.at().as_str().to_string(),
        entries,
    })
}

/// Project listing with honest pendings and an advancement notice.
pub fn list_work_deliveries(
    store: &Store,
    project_id: &str,
) -> Result<Vec<DeliverySummaryDto>, ApiError> {
    let project = project_in(store, project_id)?;
    let mut out = Vec::new();
    for delivery in store.deliveries() {
        if delivery.project() != &project {
            continue;
        }
        let mut advanced_artifacts = Vec::new();
        let mut unreviewed_count = 0;
        let mut stale_count = 0;
        for (artifact, version) in delivery.entries() {
            let advanced = store
                .current_version(artifact)
                .map(|c| c.id() != version)
                .unwrap_or(true);
            if advanced {
                advanced_artifacts.push(artifact.as_str().to_string());
            }
            if let Some(pinned) = store.version(version) {
                if store.approvals_of(version).is_empty() {
                    unreviewed_count += 1;
                }
                if !stale_sources_of(store, pinned).is_empty() {
                    stale_count += 1;
                }
            }
        }
        advanced_artifacts.sort();
        out.push(DeliverySummaryDto {
            id: delivery.id().as_str().to_string(),
            name: delivery.name().to_string(),
            project_id: project.as_str().to_string(),
            scope_module_id: delivery.scope_module().map(|m| m.as_str().to_string()),
            at: delivery.at().as_str().to_string(),
            entry_count: delivery.entries().len(),
            unreviewed_count,
            stale_count,
            advanced: !advanced_artifacts.is_empty(),
            advanced_artifacts,
        });
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}
