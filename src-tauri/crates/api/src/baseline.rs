//! Baselines de entrega: preparar (consulta), crear (atómico) y listar.
//!
//! La coherencia la valida el núcleo (`Store::create_baseline`); aquí solo
//! se prepara la vista previa con cierre de dependencias y bloqueos
//! explicados, se generan identidades y fechas fuera del dominio, y se
//! guardan los metadatos humanos junto al dominio en una transacción.

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

/// Vista previa consultiva de la entrega: elegidos con sus versiones
/// actuales exactas, cierre transitivo de dependencias, lo que queda fuera
/// y bloqueos concretos. No muta nada.
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
            "Elige al menos un artefacto del módulo para preparar la entrega.",
        ));
    }

    // Selección validada: existe, es del proyecto y está en el alcance.
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
                    "{} no está en el módulo {}: la entrega cubre un módulo cada vez.",
                    id.as_str(),
                    scope.as_str()
                ),
            ));
        }
        selected.insert(id);
    }

    // Cierre transitivo sobre versiones actuales: cada fuente incluida debe
    // SER la actual de su artefacto (si no, el dependiente está pendiente).
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
                message: format!("{} no tiene versión actual.", id.as_str()),
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
                        "{} no está aprobado en su versión actual ({}): apruébalo primero.",
                        id.as_str(),
                        current.id().as_str()
                    )
                } else {
                    format!(
                        "{} es un borrador sin aprobar: revísalo y apruébalo primero.",
                        id.as_str()
                    )
                },
                artifact_id: Some(id.as_str().to_string()),
            });
        }
        // Espejo del núcleo: entradas y fuentes archivadas bloquean la entrega.
        if store.is_effectively_archived(&id) {
            blockers.push(BaselineBlockerDto {
                code: "archived".to_string(),
                message: format!(
                    "{} está archivado: restaúralo para incluirlo en la entrega.",
                    id.as_str()
                ),
                artifact_id: Some(id.as_str().to_string()),
            });
        }
        for used in current.sources() {
            let Some(used_version) = store.version(used) else {
                blockers.push(BaselineBlockerDto {
                    code: "missing_source".to_string(),
                    message: format!(
                        "{} fija una fuente inexistente ({}).",
                        id.as_str(),
                        used.as_str()
                    ),
                    artifact_id: Some(id.as_str().to_string()),
                });
                continue;
            };
            let source_artifact = used_version.artifact().clone();
            if store.is_effectively_archived(&source_artifact) {
                blockers.push(BaselineBlockerDto {
                    code: "archived_source".to_string(),
                    message: format!(
                        "{} depende de {}, que está archivada: restaura la fuente o revisa {}.",
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
                    message: format!("{} no tiene versión actual.", source_artifact.as_str()),
                    artifact_id: Some(source_artifact.as_str().to_string()),
                });
                continue;
            };
            if source_current.id() != used {
                blockers.push(BaselineBlockerDto {
                    code: "stale_sources".to_string(),
                    message: format!(
                        "{} usa una fuente desactualizada ({}; la actual es {}): \
                         actualízalo primero.",
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
    // Fuera del alcance: lo del módulo que ni se eligió ni entró por cierre.
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

/// Creación explícita con nombre: revalida en Rust que cada entrada sigue
/// siendo la actual (si algo cambió desde la preparación, informa el
/// conflicto sin crear otra entrega) y delega la coherencia al núcleo.
/// Guarda dominio y metadatos en una transacción; publica al confirmar.
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
            "La baseline necesita al menos una entrada.",
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
    // Las entradas revisadas deben seguir siendo las actuales exactas.
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
                    "{} cambió desde la preparación (era {}, ahora es {}): \
                     vuelve a preparar la entrega.",
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

/// Detalle de una baseline guardada, con aprobaciones y procedencia.
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
            format!("{} no es del proyecto {}.", id.as_str(), project.as_str()),
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
        .ok_or_else(|| ApiError::internal(format!("{} no tiene metadatos", id.as_str())))?;
    let mut entries = Vec::with_capacity(baseline.entries().len());
    for (artifact, version) in baseline.entries() {
        let Some(known) = store.artifact(artifact) else {
            return Err(ApiError::internal(format!(
                "{} ya no existe",
                artifact.as_str()
            )));
        };
        let Some(pinned) = store.version(version) else {
            return Err(ApiError::internal(format!(
                "{} ya no existe",
                version.as_str()
            )));
        };
        entries.push(BaselineEntryDto {
            artifact: artifact_dto(store, artifact)?,
            kind: kind_str(known.artifact_type()).to_string(),
            // Fijado en la baseline, jamás el título actual.
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

/// Listado del proyecto con aviso de avance: qué baselines siguen siendo
/// las actuales y cuáles quedaron atrás.
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
