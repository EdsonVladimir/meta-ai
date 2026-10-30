//! Reversible archiving and safe deletion of modules and requirements.
//!
//! No Tauri or I/O: takes the `Store` and logs as inputs. The
//! advance summary is advisory (mutates nothing); execution revalidates
//! the conditions in Rust inside the transaction. The domain rules
//! (archiving, dependencies, approvals, baselines) are applied by
//! `ruth-core`; here the generation and metadata logs, which live
//! outside the core, are additionally inspected.
//!
//! Policy:
//! - Archiving is always allowed and preserves everything (versions,
//!   approvals, dependencies, baselines, generations, code
//!   links). Its consequences appear on approve, generate or deliver:
//!   the core then blocks. Archiving knowledge invalidates no sources
//!   and removes no dependencies: links persist and show in their
//!   archived context.
//! - Delete only when nothing mentions it: no approvals, no
//!   dependents, no baseline presence, no references in
//!   generations (own, context, acceptance or target ones) and no
//!   code links. No silent cascades: when something references it,
//!   it blocks and archiving is recommended.

use std::collections::HashSet;

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, Module, ModuleId, ProjectId};
use ruth_store::{
    BaselineMetaLog, CodeLinkLog, CodeRootLog, DesignLog, LinkScope, ProposalLog, ProposalState,
};

use crate::code_links::{check_artifact_deletable, check_module_deletable};
use crate::dto::{
    ArchiveBaselineDto, ArchiveBlockerDto, ArchiveCodeLinkDto, ArchiveDependentDto,
    ArchiveGenerationDto, ArchiveModuleInput, ArchivePreviewDto, ArchivePreviewInput,
    ArchiveRequirementInput, ArtifactDto, DeleteModuleInput, DeleteProjectInput,
    DeleteRequirementInput, GetRequirementInput, ModuleDto, RequirementDetail,
};
use crate::error::ApiError;
use crate::impact::artifact_dto;
use crate::logic::get_requirement;

/// Advisory target summary: content, dependents (with their module),
/// baselines, generations, code links and whether deleting is safe.
/// Mutates nothing.
pub fn archive_preview(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    links: &CodeLinkLog,
    roots: &CodeRootLog,
    input: ArchivePreviewInput,
) -> Result<ArchivePreviewDto, ApiError> {
    let project = ProjectId::new(input.project_id.clone())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    match input.kind.as_str() {
        "module" => preview_module(
            store, proposals, designs, metalog, links, &project, &input.id,
        ),
        "requirement" => preview_requirement(
            store, proposals, designs, metalog, links, &project, &input.id,
        ),
        "project" => preview_project(store, proposals, designs, metalog, roots, &project),
        other => Err(ApiError::coded(
            "unknown_archive_target",
            format!("unknown target: {other} (use project, module or requirement)"),
        )),
    }
}

/// An owner's links in summary form, ordered by id.
fn link_dtos(links: &CodeLinkLog, scope: LinkScope, owner_id: &str) -> Vec<ArchiveCodeLinkDto> {
    links
        .by_owner(scope, owner_id)
        .into_iter()
        .map(|link| ArchiveCodeLinkDto {
            id: link.id.clone(),
            root_id: link.root_id.clone(),
            rel: link.rel.clone(),
            symbol_name: link.symbol.as_ref().map(|s| s.name.clone()),
            kind: link.kind.as_str().to_string(),
        })
        .collect()
}

fn preview_module(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    links: &CodeLinkLog,
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
    // Dependents, baselines and deliveries aggregated from the content,
    // deduplicated.
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
                "Module {} holds {} item(s): empty it first, one by one.",
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
                "Module {} has {} recorded generation(s): archive it.",
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
                "Module {} is the scope of {}: archive it.",
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
                "Module {} is the scope of {}: archive it.",
                module.as_str(),
                delivery_scoped.join(", ")
            ),
        });
    }
    let code_links = link_dtos(links, LinkScope::Module, module.as_str());
    if !code_links.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_code_links".to_string(),
            message: format!(
                "Module {} has {} link(s) with code: unlink them or archive it.",
                module.as_str(),
                code_links.len()
            ),
        });
    }
    Ok(ArchivePreviewDto {
        project_id: project.as_str().to_string(),
        kind: "module".to_string(),
        id: module.as_str().to_string(),
        archived: known.archived(),
        contents,
        modules: Vec::new(),
        dependents,
        baselines,
        deliveries,
        generations,
        code_links,
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
    links: &CodeLinkLog,
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
                "{} is not a requirement: this dialog only archives modules and requirements.",
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
            message: format!("{artifact_id} has approvals and cannot be deleted: archive it."),
        });
    }
    if !dependents.is_empty() {
        let who: Vec<&str> = dependents.iter().map(|d| d.artifact.id.as_str()).collect();
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_dependents".to_string(),
            message: format!(
                "{artifact_id} cannot be deleted: {} depend on it. Archive it.",
                who.join(", ")
            ),
        });
    }
    if !baselines.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_in_baseline".to_string(),
            message: format!(
                "{artifact_id} cannot be deleted: baseline {} includes it. Archive it.",
                baselines[0].name
            ),
        });
    }
    if !deliveries.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_in_delivery".to_string(),
            message: format!(
                "{artifact_id} cannot be deleted: delivery {} includes it. Archive it.",
                deliveries[0].name
            ),
        });
    }
    if !generations.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_generations".to_string(),
            message: format!(
                "{artifact_id} appears in {} recorded generation(s): archive it.",
                generations.len()
            ),
        });
    }
    let code_links = link_dtos(links, LinkScope::Artifact, artifact.as_str());
    if !code_links.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_code_links".to_string(),
            message: format!(
                "{artifact_id} has {} linked symbol(s): unlink them or archive it.",
                code_links.len()
            ),
        });
    }
    Ok(ArchivePreviewDto {
        project_id: project.as_str().to_string(),
        kind: "requirement".to_string(),
        id: artifact.as_str().to_string(),
        archived: known.archived(),
        contents: Vec::new(),
        modules: Vec::new(),
        dependents,
        baselines,
        deliveries,
        generations,
        code_links,
        approvals: refs.approvals,
        versions: refs.versions,
        can_delete: delete_blockers.is_empty(),
        delete_blockers,
    })
}

/// Advisory project summary: its modules, baselines and deliveries,
/// generations mentioning it and bound roots. A project is not a
/// dependency node (no own dependents, never archived): it can only
/// be deleted empty, rootless and unreferenced.
fn preview_project(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    roots: &CodeRootLog,
    project: &ProjectId,
) -> Result<ArchivePreviewDto, ApiError> {
    let modules: Vec<ModuleDto> = store
        .modules_of(project)
        .iter()
        .map(|m| module_dto(m))
        .collect();
    let baseline_ids: HashSet<ruth_core::domain::BaselineId> = store
        .baselines()
        .iter()
        .filter(|b| b.project() == project)
        .map(|b| b.id().clone())
        .collect();
    let delivery_ids: HashSet<ruth_core::domain::DeliveryId> = store
        .deliveries()
        .iter()
        .filter(|d| d.project() == project)
        .map(|d| d.id().clone())
        .collect();
    let generations = project_generations(store, proposals, designs, project);
    let bound: Vec<String> = roots
        .roots()
        .iter()
        .filter(|r| r.project_id.as_deref() == Some(project.as_str()))
        .map(|r| r.name.clone())
        .collect();
    let mut approvals = 0;
    let mut versions = 0;
    for module in store.modules_of(project) {
        for content in store.artifacts_of(project, module.id()) {
            let refs = store.artifact_references(project, content.id())?;
            approvals += refs.approvals;
            versions += refs.versions;
        }
    }
    let mut delete_blockers = Vec::new();
    if !modules.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_project_not_empty".to_string(),
            message: format!(
                "Project {} still holds {} module(s): delete them first, one by one.",
                project.as_str(),
                modules.len()
            ),
        });
    }
    if !bound.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_roots".to_string(),
            message: format!(
                "Project {} has {} bound folder(s) ({}): unlink first.",
                project.as_str(),
                bound.len(),
                bound.join(", ")
            ),
        });
    }
    if !baseline_ids.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_baselines".to_string(),
            message: format!(
                "Project {} has {} historic baseline(s): it cannot be deleted.",
                project.as_str(),
                baseline_ids.len()
            ),
        });
    }
    if !delivery_ids.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_deliveries".to_string(),
            message: format!(
                "Project {} has {} work deliveries: it cannot be deleted.",
                project.as_str(),
                delivery_ids.len()
            ),
        });
    }
    if !generations.is_empty() {
        delete_blockers.push(ArchiveBlockerDto {
            code: "delete_has_generations".to_string(),
            message: format!(
                "Project {} appears in {} recorded generation(s): it cannot be deleted.",
                project.as_str(),
                generations.len()
            ),
        });
    }
    // Note: code links belong to modules or artifacts; with modules
    // present the first blocker already covers them, and without modules none remain.
    Ok(ArchivePreviewDto {
        project_id: project.as_str().to_string(),
        kind: "project".to_string(),
        id: project.as_str().to_string(),
        archived: false,
        contents: Vec::new(),
        modules,
        dependents: Vec::new(),
        baselines: baseline_dtos(metalog, baseline_ids),
        deliveries: delivery_dtos(store, delivery_ids),
        generations,
        code_links: Vec::new(),
        approvals,
        versions,
        can_delete: delete_blockers.is_empty(),
        delete_blockers,
    })
}

/// Generations mentioning any project module, ordered and
/// deduplicated. Shared by the summary and the execution.
fn project_generations(
    store: &Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    project: &ProjectId,
) -> Vec<ArchiveGenerationDto> {
    let mut generations: Vec<ArchiveGenerationDto> = Vec::new();
    for module in store.modules_of(project) {
        generations.extend(generation_refs(
            project,
            proposals,
            designs,
            GenerationTarget::Module(module.id().as_str()),
        ));
    }
    generations.sort_by(|a, b| {
        a.id.cmp(&b.id)
            .then(a.log.cmp(&b.log))
            .then(a.role.cmp(&b.role))
    });
    generations.dedup_by(|a, b| a.id == b.id && a.log == b.log && a.role == b.role);
    generations
}

fn module_dto(module: &Module) -> ModuleDto {
    ModuleDto {
        id: module.id().as_str().to_string(),
        project_id: module.project().as_str().to_string(),
        name: module.name().to_string(),
        archived: module.archived(),
    }
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

/// Work deliveries including the target, with their own name
/// (deliveries carry it inside, no metalog). Reuses the
/// baselines' `{id, name}` shape.
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

/// The project's generations mentioning the target, ordered by id.
/// For modules: the own ones (`owns`) and those citing their content. For
/// requirements: context, acceptance and update target.
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

/// Archives a module. Always allowed; content hides by context.
pub fn archive_module(store: &mut Store, input: ArchiveModuleInput) -> Result<ModuleDto, ApiError> {
    set_module_archived(store, input, true)
}

/// Restores an archived module. Restores no individual files.
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

/// Archives a requirement and returns its updated authoritative detail.
pub fn archive_requirement(
    store: &mut Store,
    input: ArchiveRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    set_requirement_archived(store, input, true)
}

/// Restores an individually archived requirement.
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

/// Deletes a module revalidating the conditions: empty, no own
/// generations and no baseline scope. Returns the deleted id.
pub fn delete_module_checked(
    store: &mut Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    metalog: &BaselineMetaLog,
    links: &CodeLinkLog,
    input: DeleteModuleInput,
) -> Result<String, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id.clone())?;
    check_module_deletable(links, module.as_str())?;
    let owned = owned_generations(&project, proposals, designs, module.as_str());
    if !owned.is_empty() {
        return Err(ApiError::coded(
            "delete_has_generations",
            format!(
                "Module {} has {} recorded generation(s): archive it.",
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
                "Module {} is the scope of {}: archive it.",
                module.as_str(),
                scoped.join(", ")
            ),
        ));
    }
    Ok(store.delete_module(&project, &module)?.as_str().to_string())
}

/// Deletes a requirement revalidating the conditions: the core requires a
/// draft without dependents or baselines; zero generation references
/// are additionally required here. Returns the deleted id.
pub fn delete_requirement_checked(
    store: &mut Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    links: &CodeLinkLog,
    input: DeleteRequirementInput,
) -> Result<String, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id)?;
    require_requirement(store, &project, &artifact)?;
    check_artifact_deletable(links, artifact.as_str())?;
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
                "{} appears in {} recorded generation(s): archive it.",
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

/// Deletes a project revalidating the conditions: empty, no bound
/// folders, no baselines or deliveries and no generation mentions.
/// Projects never archive: they either exist or get deleted. No cascades.
/// Returns the deleted id.
pub fn delete_project_checked(
    store: &mut Store,
    proposals: &ProposalLog,
    designs: &DesignLog,
    roots: &CodeRootLog,
    input: DeleteProjectInput,
) -> Result<String, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let bound: Vec<String> = roots
        .roots()
        .iter()
        .filter(|r| r.project_id.as_deref() == Some(project.as_str()))
        .map(|r| r.name.clone())
        .collect();
    if !bound.is_empty() {
        return Err(ApiError::coded(
            "delete_has_roots",
            format!(
                "Project {} has {} bound folder(s) ({}): unlink first.",
                project.as_str(),
                bound.len(),
                bound.join(", ")
            ),
        ));
    }
    let baselines = store
        .baselines()
        .iter()
        .filter(|b| b.project() == &project)
        .count();
    if baselines > 0 {
        return Err(ApiError::coded(
            "delete_has_baselines",
            format!(
                "Project {} has {baselines} historic baseline(s): it cannot be deleted.",
                project.as_str(),
            ),
        ));
    }
    let deliveries = store
        .deliveries()
        .iter()
        .filter(|d| d.project() == &project)
        .count();
    if deliveries > 0 {
        return Err(ApiError::coded(
            "delete_has_deliveries",
            format!(
                "Project {} has {deliveries} work deliveries: it cannot be deleted.",
                project.as_str(),
            ),
        ));
    }
    let generations = project_generations(store, proposals, designs, &project);
    if !generations.is_empty() {
        return Err(ApiError::coded(
            "delete_has_generations",
            format!(
                "Project {} appears in {} recorded generation(s): it cannot be deleted.",
                project.as_str(),
                generations.len()
            ),
        ));
    }
    Ok(store.delete_project(&project)?.as_str().to_string())
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
                "{} is not a requirement: this action only accepts modules and requirements.",
                artifact.as_str()
            ),
        ));
    }
    Ok(())
}

/// Generations whose module is the given one (same project).
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
