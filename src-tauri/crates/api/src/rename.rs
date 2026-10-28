//! Renombrado de proyectos, módulos, requisitos y diagramas.
//!
//! Sin Tauri ni E/S: adaptadores finos sobre los casos de uso del núcleo.
//! Renombrar no toca identidades, versiones, fuentes, aprobaciones ni
//! impacto: proyectos y módulos cambian su nombre organizativo, y
//! requisitos y diagramas su título (metadato versionado con historial).
//! Toda operación exige el nombre esperado y revalida archivado en Rust.

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, HumanId, ModuleId, Name, ProjectId};

use crate::archive::require_requirement;
use crate::dto::{
    GetRequirementInput, ListModulesInput, ModuleDto, ProjectDto, RenameArtifactInput,
    RenameModuleInput, RenameProjectInput, RequirementDetail,
};
use crate::error::ApiError;
use crate::logic::{get_requirement, list_modules, list_projects};

/// Renombra un proyecto y devuelve el DTO actualizado.
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
        .ok_or_else(|| ApiError::internal("el proyecto renombrado no aparece"))
}

/// Renombra un módulo y devuelve el DTO actualizado.
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
    .ok_or_else(|| ApiError::internal("el módulo renombrado no aparece"))
}

/// Cambia el título de un requisito y devuelve su detalle autoritativo.
/// `now` es la fecha generada en la frontera para el historial.
pub fn rename_requirement(
    store: &mut Store,
    input: RenameArtifactInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    rename_titled(store, input, now, true)
}

/// Cambia el título de un diagrama (flujo o modelo de datos).
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
                "{} no es un diagrama: esta acción solo admite flujos y modelos de datos.",
                artifact.as_str()
            ),
        ));
    }
    Ok(())
}
