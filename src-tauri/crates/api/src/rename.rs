//! Renaming projects, modules, requirements and diagrams.
//!
//! No Tauri or I/O: thin adapters over the core use cases.
//! Renaming touches no identities, versions, sources, approvals or
//! impact: projects and modules change their organizational name, and
//! requirements and diagrams their title (versioned metadata with history).
//! Every operation requires the expected name and revalidates archiving in Rust.

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, HumanId, ModuleId, Name, ProjectId};

use crate::archive::require_requirement;
use crate::dto::{
    GetRequirementInput, ListModulesInput, ModuleDto, ProjectDto, RenameArtifactInput,
    RenameModuleInput, RenameProjectInput, RequirementDetail,
};
use crate::error::ApiError;
use crate::logic::{get_requirement, list_modules, list_projects};

/// Renames a project and returns the updated DTO.
pub fn rename_project(
    store: &mut Store,
    input: RenameProjectInput,
) -> Result<ProjectDto, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let name = Name::new(input.name)?;
    store.rename_project(&project, &input.expected_name, name)?;
    list_projects(store)
        .into_iter()
        .find(|p| p.id == project.as_str())
        .ok_or_else(|| ApiError::internal("the renamed project is missing"))
}

/// Renames a module and returns the updated DTO.
pub fn rename_module(store: &mut Store, input: RenameModuleInput) -> Result<ModuleDto, ApiError> {
    let project = ProjectId::new(input.project_id.clone())?;
    let module = ModuleId::new(input.module_id)?;
    let name = Name::new(input.name)?;
    store.rename_module(&project, &module, &input.expected_name, name)?;
    list_modules(
        store,
        ListModulesInput {
            project_id: input.project_id,
        },
    )?
    .into_iter()
    .find(|m| m.id == module.as_str())
    .ok_or_else(|| ApiError::internal("the renamed module is missing"))
}

/// Changes a requirement title and returns its authoritative detail.
/// `now` is the boundary-generated date for the history.
pub fn rename_requirement(
    store: &mut Store,
    input: RenameArtifactInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    rename_titled(store, input, now, true)
}

/// Changes a diagram title (flow or data model).
pub fn rename_design(
    store: &mut Store,
    input: RenameArtifactInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    rename_titled(store, input, now, false)
}

fn rename_titled(
    store: &mut Store,
    input: RenameArtifactInput,
    now: &str,
    requirement: bool,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ArtifactId::new(input.artifact_id)?;
    if requirement {
        require_requirement(store, &project, &artifact)?;
    } else {
        require_design(store, &project, &artifact)?;
    }
    let title = Name::new(input.title)?;
    let by = HumanId::new(input.by)?;
    let at = ruth_core::domain::Date::new(now.to_string())?;
    store.rename_artifact(
        &project,
        &artifact,
        input.expected_title.as_deref(),
        title,
        &by,
        at,
    )?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact.as_str().to_string(),
        },
    )
}

fn require_design(
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
    if known.artifact_type() == ArtifactType::Requirement {
        return Err(ApiError::coded(
            "not_a_design",
            format!(
                "{} is not a diagram: this action only accepts flows and data models.",
                artifact.as_str()
            ),
        ));
    }
    Ok(())
}
