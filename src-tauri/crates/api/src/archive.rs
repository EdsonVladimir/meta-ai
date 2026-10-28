//! Archivo reversible y borrado seguro de módulos y requisitos.
//!
//! Sin Tauri ni E/S: recibe el `Store` y los registros como entradas. El
//! resumen previo es consultivo (no muta); la ejecución revalida las
//! condiciones en Rust dentro de la transacción. Las reglas del dominio
//! (archivado, dependencias, aprobaciones, baselines) las aplica
//! `ruth-core`; aquí solo se inspeccionan además los registros de
//! generaciones y metadatos, que viven fuera del núcleo.
//!
//! Política:
//! - Archivar siempre está permitido y conserva todo (versiones,
//!   aprobaciones, dependencias, baselines, generaciones). Sus consecuencias
//!   aparecen al aprobar, generar o entregar: el núcleo bloquea entonces.
//! - Eliminar solo cuando nada lo mencione: sin aprobaciones, sin
//!   dependientes, sin presencia en baselines y sin referencias en
//!   generaciones (propias, de contexto, de aceptación o de objetivo). Sin
//!   cascadas silenciosas: si algo lo referencia, se bloquea y se recomienda
//!   archivar.

use std::collections::HashSet;

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, ModuleId, ProjectId};
use ruth_store::{BaselineMetaLog, DesignLog, ProposalLog, ProposalState};

use crate::dto::{
    ArchiveBaselineDto, ArchiveBlockerDto, ArchiveDependentDto, ArchiveGenerationDto,
    ArchiveModuleInput, ArchivePreviewDto, ArchivePreviewInput, ArchiveRequirementInput,
    ArtifactDto, DeleteModuleInput, DeleteRequirementInput, GetRequirementInput, ModuleDto,
    RequirementDetail,
};
use crate::error::ApiError;
use crate::impact::artifact_dto;
use crate::logic::get_requirement;

/// Resumen consultivo del objetivo: contenido, dependientes (con su módulo),
/// baselines, generaciones y si el borrado es seguro. No muta nada.
pub fn archive_preview(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    input: ArchivePreviewInput,
) -> Result<ArchivePreviewDto, ApiError> {
    let project = ProjectId::new(input.project_id.clone())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    match input.kind.as_str() {
        "module" => preview_module(store, proposals, designs, metalog, &project, &input.id),
        "requirement" => {
            preview_requirement(store, proposals, designs, metalog, &project, &input.id)
        }
        other => Err(ApiError::coded(
            "unknown_archive_target",
            format!("objetivo desconocido: {other} (usa module o requirement)"),
        )),
    }
}

fn preview_module(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    project: &ProjectId,
    module_id: &str,
) -> Result<ArchivePreviewDto, ApiError> {
    let module = ModuleId::new(module_id.to_string())?;
    let Some(known) = store.module(&module) else {
        return Err(CoreError::ModuleNotFound { module }.into());
    };
    if known.project() != project {
        return Err(CoreError::ModuleNotInProject {
            module,
            project: project.clone(),
        }
        .into());
    }
    let contents: Vec<ArtifactDto> = store
        .artifacts_of(project, &module)
        .iter()
        .map(|a| artifact_dto(store, a.id()))
        .collect::<Result<_, _>>()?;
    // Dependientes, baselines y entregas agregados del contenido, sin
    // duplicados.
    let mut dependent_ids = HashSet::new();
    let mut baseline_ids = HashSet::new();
    let mut delivery_ids = HashSet::new();
    let mut approvals = 0;
    let mut versions = 0;
    for content in store.artifacts_of(project, &module) {
        let refs = store.artifact_references(project, content.id())?;
        dependent_ids.extend(refs.dependents);
        baseline_ids.extend(refs.baselines);
        delivery_ids.extend(refs.deliveries);
        approvals += refs.approvals;
        versions += refs.versions;
    }
    let mut dependents: Vec<ArchiveDependentDto> = dependent_ids
        .into_iter()
        .map(|id| dependent_dto(store, &module, &id))
        .collect::<Result<_, _>>()?;
    dependents.sort_by(|a, b| a.artifact.id.cmp(&b.artifact.id));
    let baselines = baseline_dtos(metalog, baseline_ids);
    let deliveries = delivery_dtos(store, delivery_ids);
    let generations = generation_refs(
        project,
        proposals,
        designs,
        GenerationTarget::Module(module.as_str()),
    );
    let mut delete_blockers = Vec::new();
    if !contents.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_module_not_empty".to_string(),
            message: format!(
                "El módulo {} contiene {} elemento(s): vacíalo primero, uno a uno.",
                module.as_str(),
                contents.len()
            ),
        });
    }
    let owned: Vec<&ArchiveGenerationDto> =
        generations.iter().filter(|g| g.role == "owns").collect();
    if !owned.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_generations".to_string(),
            message: format!(
                "El módulo {} tiene {} generación(es) registrada(s): archívalo.",
                module.as_str(),
                owned.len()
            ),
        });
    }
    let scoped: Vec<String> = metalog
        .all()
        .iter()
        .filter(|meta| meta.scope_module.as_deref() == Some(module.as_str()))
        .map(|meta| meta.name.clone())
        .collect();
    if !scoped.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_baseline_scope".to_string(),
            message: format!(
                "El módulo {} es el alcance de {}: archívalo.",
                module.as_str(),
                scoped.join(", ")
            ),
        });
    }
    let delivery_scoped: Vec<String> = store
        .deliveries()
        .iter()
        .filter(|d| {
            d.project() == project && d.scope_module().map(|m| m == &module).unwrap_or(false)
        })
        .map(|d| d.name().to_string())
        .collect();
    if !delivery_scoped.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_delivery_scope".to_string(),
            message: format!(
                "El módulo {} es el alcance de {}: archívalo.",
                module.as_str(),
                delivery_scoped.join(", ")
            ),
        });
    }
    Ok(ArchivePreviewDto {
        project_id: project.as_str().to_string(),
        kind: "module".to_string(),
        id: module.as_str().to_string(),
        archived: known.archived(),
        contents,
        dependents,
        baselines,
        deliveries,
        generations,
        approvals,
        versions,
        can_delete: delete_blockers.is_empty(),
        delete_blockers,
    })
}

fn preview_requirement(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    project: &ProjectId,
    artifact_id: &str,
) -> Result<ArchivePreviewDto, ApiError> {
    let artifact = ArtifactId::new(artifact_id.to_string())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    if known.project() != project {
        return Err(CoreError::ArtifactNotInProject {
            artifact,
            project: project.clone(),
        }
        .into());
    }
    if known.artifact_type() != ArtifactType::Requirement {
        return Err(ApiError::coded(
            "not_a_requirement",
            format!(
                "{} no es un requisito: este diálogo solo archiva módulos y requisitos.",
                artifact_id
            ),
        ));
    }
    let refs = store.artifact_references(project, &artifact)?;
    let module = ModuleId::new(known.module().as_str().to_string())?;
    let mut dependents: Vec<ArchiveDependentDto> = refs
        .dependents
        .into_iter()
        .map(|id| dependent_dto(store, &module, &id))
        .collect::<Result<_, _>>()?;
    dependents.sort_by(|a, b| a.artifact.id.cmp(&b.artifact.id));
    let baselines = baseline_dtos(metalog, refs.baselines.into_iter().collect());
    let deliveries = delivery_dtos(store, refs.deliveries.into_iter().collect());
    let generations = generation_refs(
        project,
        proposals,
        designs,
        GenerationTarget::Artifact {
            id: artifact.as_str(),
            versions: &store
                .versions_of(&artifact)
                .iter()
                .map(|v| v.id().as_str().to_string())
                .collect::<Vec<_>>(),
        },
    );
    let mut delete_blockers = Vec::new();
    if refs.approvals > 0 {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_approvals".to_string(),
            message: format!("{artifact_id} tiene aprobaciones y no puede eliminarse: archívalo."),
        });
    }
    if !dependents.is_empty() {
        let who: Vec<&str> = dependents.iter().map(|d| d.artifact.id.as_str()).collect();
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_dependents".to_string(),
            message: format!(
                "{artifact_id} no puede eliminarse: dependen de él {}. Archívalo.",
                who.join(", ")
            ),
        });
    }
    if !baselines.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_in_baseline".to_string(),
            message: format!(
                "{artifact_id} no puede eliminarse: la baseline {} lo incluye. Archívalo.",
                baselines[0].name
            ),
        });
    }
    if !deliveries.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_in_delivery".to_string(),
            message: format!(
                "{artifact_id} no puede eliminarse: la entrega {} lo incluye. Archívalo.",
                deliveries[0].name
            ),
        });
    }
    if !generations.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_generations".to_string(),
            message: format!(
                "{artifact_id} aparece en {} generación(es) registrada(s): archívalo.",
                generations.len()
            ),
        });
    }
    Ok(ArchivePreviewDto {
        project_id: project.as_str().to_string(),
        kind: "requirement".to_string(),
        id: artifact.as_str().to_string(),
        archived: known.archived(),
        contents: Vec::new(),
        dependents,
        baselines,
        deliveries,
        generations,
        approvals: refs.approvals,
        versions: refs.versions,
        can_delete: delete_blockers.is_empty(),
        delete_blockers,
    })
}

fn dependent_dto(
    store: &Store,
    home: &ModuleId,
    id: &ArtifactId,
) -> Result<ArchiveDependentDto, ApiError> {
    let Some(known) = store.artifact(id) else {
        return Err(CoreError::ArtifactNotFound {
            artifact: id.clone(),
        }
        .into());
    };
    Ok(ArchiveDependentDto {
        artifact: artifact_dto(store, id)?,
        same_module: known.module() == home,
    })
}

/// Entregas de trabajo que incluyen al objetivo, con su nombre propio
/// (las entregas lo llevan dentro, sin metalog). Reutiliza la forma
/// `{id, name}` de las baselines.
fn delivery_dtos(
    store: &Store,
    ids: HashSet<ruth_core::domain::DeliveryId>,
) -> Vec<ArchiveBaselineDto> {
    let mut out: Vec<ArchiveBaselineDto> = ids
        .into_iter()
        .map(|id| {
            let name = store
                .delivery(&id)
                .map(|d| d.name().to_string())
                .unwrap_or_else(|| id.as_str().to_string());
            ArchiveBaselineDto {
                id: id.as_str().to_string(),
                name,
            }
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

fn baseline_dtos(
    metalog: &BaselineMetaLog,
    ids: HashSet<ruth_core::domain::BaselineId>,
) -> Vec<ArchiveBaselineDto> {
    let mut out: Vec<ArchiveBaselineDto> = ids
        .into_iter()
        .map(|id| {
            let name = metalog
                .get(id.as_str())
                .map(|meta| meta.name.clone())
                .unwrap_or_else(|| id.as_str().to_string());
            ArchiveBaselineDto {
                id: id.as_str().to_string(),
                name,
            }
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

enum GenerationTarget<'a> {
    Module(&'a str),
    Artifact { id: &'a str, versions: &'a [String] },
}

/// Generaciones del proyecto que mencionan al objetivo, ordenadas por id.
/// Para módulos: las propias (`owns`) y las que citan su contenido. Para
/// requisitos: contexto, aceptación y objetivo de actualización.
fn generation_refs(
    project: &ProjectId,
    proposals: &ProposalLog,
    designs: &DesignLog,
    target: GenerationTarget,
) -> Vec<ArchiveGenerationDto> {
    let mut out = Vec::new();
    let mut push = |id: &str, log: &str, role: &str| {
        out.push(ArchiveGenerationDto {
            id: id.to_string(),
            log: log.to_string(),
            role: role.to_string(),
        });
    };
    match &target {
        GenerationTarget::Module(module_id) => {
            for generation in proposals.all() {
                if generation.project_id != project.as_str() {
                    continue;
                }
                if generation.module_id == *module_id {
                    push(&generation.id, "requirement", "owns");
                }
            }
            for generation in designs.all() {
                if generation.project_id != project.as_str() {
                    continue;
                }
                if generation.module_id == *module_id {
                    push(&generation.id, "design", "owns");
                }
            }
        }
        GenerationTarget::Artifact { id, versions } => {
            let owned: HashSet<&str> = versions.iter().map(String::as_str).collect();
            for generation in proposals.all() {
                if generation.project_id != project.as_str() {
                    continue;
                }
                if generation
                    .context_version_ids
                    .iter()
                    .any(|v| owned.contains(v.as_str()))
                {
                    push(&generation.id, "requirement", "context");
                }
                if generation.proposals.iter().any(|p| {
                    matches!(&p.state, ProposalState::Accepted { artifact_id, .. } if artifact_id.as_str() == *id)
                }) {
                    push(&generation.id, "requirement", "accepted");
                }
            }
            for generation in designs.all() {
                if generation.project_id != project.as_str() {
                    continue;
                }
                if generation
                    .context_version_ids
                    .iter()
                    .any(|v| owned.contains(v.as_str()))
                {
                    push(&generation.id, "design", "context");
                }
                if matches!(&generation.proposal.state, ProposalState::Accepted { artifact_id, .. } if artifact_id.as_str() == *id)
                {
                    push(&generation.id, "design", "accepted");
                }
                if generation.target_artifact_id.as_deref() == Some(*id) {
                    push(&generation.id, "design", "target");
                }
            }
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id).then(a.role.cmp(&b.role)));
    out
}

/// Archiva un módulo. Siempre permitido; el contenido se oculta por contexto.
pub fn archive_module(store: &mut Store, input: ArchiveModuleInput) -> Result<ModuleDto, ApiError> {
    set_module_archived(store, input, true)
}

/// Restaura un módulo archivado. No restaura archivos individuales.
pub fn restore_module(store: &mut Store, input: ArchiveModuleInput) -> Result<ModuleDto, ApiError> {
    set_module_archived(store, input, false)
}

fn set_module_archived(
    store: &mut Store,
    input: ArchiveModuleInput,
    archived: bool,
) -> Result<ModuleDto, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    let updated = store.set_module_archived(&project, &module, archived)?;
    Ok(ModuleDto {
        id: updated.id().as_str().to_string(),
        project_id: updated.project().as_str().to_string(),
        name: updated.name().to_string(),
        archived: updated.archived(),
    })
}

/// Archiva un requisito y devuelve su detalle autoritativo actualizado.
pub fn archive_requirement(
    store: &mut Store,
    input: ArchiveRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    set_requirement_archived(store, input, true)
}

/// Restaura un requisito archivado individualmente.
pub fn restore_requirement(
    store: &mut Store,
    input: ArchiveRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    set_requirement_archived(store, input, false)
}

fn set_requirement_archived(
    store: &mut Store,
    input: ArchiveRequirementInput,
    archived: bool,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id)?;
    require_requirement(store, &project, &artifact)?;
    store.set_artifact_archived(&project, &artifact, archived)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact.as_str().to_string(),
        },
    )
}

/// Elimina un módulo revalidando las condiciones: vacío, sin generaciones
/// propias y sin ser alcance de baselines. Devuelve el id eliminado.
pub fn delete_module_checked(
    store: &mut Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    input: DeleteModuleInput,
) -> Result<String, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id.clone())?;
    let owned = owned_generations(&project, proposals, designs, module.as_str());
    if !owned.is_empty() {
        return Err(ApiError::coded(
            "delete_has_generations",
            format!(
                "El módulo {} tiene {} generación(es) registrada(s): archívalo.",
                module.as_str(),
                owned.len()
            ),
        ));
    }
    let scoped: Vec<String> = metalog
        .all()
        .iter()
        .filter(|meta| meta.scope_module.as_deref() == Some(module.as_str()))
        .map(|meta| meta.name.clone())
        .collect();
    if !scoped.is_empty() {
        return Err(ApiError::coded(
            "delete_baseline_scope",
            format!(
                "El módulo {} es el alcance de {}: archívalo.",
                module.as_str(),
                scoped.join(", ")
            ),
        ));
    }
    Ok(store.delete_module(&project, &module)?.as_str().to_string())
}

/// Elimina un requisito revalidando las condiciones: el núcleo exige que sea
/// borrador sin dependientes ni baselines; aquí se exigen además cero
/// referencias en generaciones. Devuelve el id eliminado.
pub fn delete_requirement_checked(
    store: &mut Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    input: DeleteRequirementInput,
) -> Result<String, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id)?;
    require_requirement(store, &project, &artifact)?;
    let versions: Vec<String> = store
        .versions_of(&artifact)
        .iter()
        .map(|v| v.id().as_str().to_string())
        .collect();
    let refs = generation_refs(
        &project,
        proposals,
        designs,
        GenerationTarget::Artifact {
            id: artifact.as_str(),
            versions: &versions,
        },
    );
    if !refs.is_empty() {
        return Err(ApiError::coded(
            "delete_has_generations",
            format!(
                "{} aparece en {} generación(es) registrada(s): archívalo.",
                artifact.as_str(),
                refs.len()
            ),
        ));
    }
    Ok(store
        .delete_artifact(&project, &artifact)?
        .as_str()
        .to_string())
}

pub(crate) fn require_requirement(
    store: &Store,
    project: &ProjectId,
    artifact: &ArtifactId,
) -> Result<(), ApiError> {
    let Some(known) = store.artifact(artifact) else {
        return Err(CoreError::ArtifactNotFound {
            artifact: artifact.clone(),
        }
        .into());
    };
    if known.project() != project {
        return Err(CoreError::ArtifactNotInProject {
            artifact: artifact.clone(),
            project: project.clone(),
        }
        .into());
    }
    if known.artifact_type() != ArtifactType::Requirement {
        return Err(ApiError::coded(
            "not_a_requirement",
            format!(
                "{} no es un requisito: esta acción solo admite módulos y requisitos.",
                artifact.as_str()
            ),
        ));
    }
    Ok(())
}

/// Generaciones cuyo módulo es el indicado (mismo proyecto).
fn owned_generations(
    project: &ProjectId,
    proposals: &ProposalLog,
    designs: &DesignLog,
    module_id: &str,
) -> Vec<String> {
    let mut out: Vec<String> = proposals
        .all()
        .iter()
        .filter(|g| g.project_id == project.as_str() && g.module_id == module_id)
        .map(|g| g.id.clone())
        .collect();
    out.extend(
        designs
            .all()
            .iter()
            .filter(|g| g.project_id == project.as_str() && g.module_id == module_id)
            .map(|g| g.id.clone()),
    );
    out.sort();
    out
}
