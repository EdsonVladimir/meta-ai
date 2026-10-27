//! Lógica de comandos: traduce entradas a casos de uso y casos de uso a DTOs.
//!
//! Sin Tauri ni E/S: recibe `Store`, `IdGen` y la fecha actual como entradas,
//! así que es testeable sin tiempo de ejecución nativo. Toda mutación pasa
//! por los casos de uso existentes; aquí no se duplican reglas.

use ruth_core::application::Store;
use ruth_core::domain::{
    Approval, Artifact, ArtifactType, Author, CoreError, HumanId, Module, ModuleId, Project,
    ProjectId,
};

use crate::dto::{
    ApprovalDto, ApproveVersionInput, ArtifactDto, CreateModuleInput, CreateRequirementInput,
    GetRequirementInput, ListArtifactsInput, ListModulesInput, ListRequirementsInput, ModuleDto,
    ProjectDto, ProvenanceDto, RequirementDetail, SaveVersionInput, VersionDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;

pub fn create_project(store: &mut Store, ids: &mut IdGen) -> Result<ProjectDto, ApiError> {
    let project = store.create_project(ids.project())?;
    Ok(ProjectDto::from_project(&project))
}

pub fn list_projects(store: &Store) -> Vec<ProjectDto> {
    store
        .projects()
        .iter()
        .map(|p| ProjectDto::from_project(p))
        .collect()
}

pub fn create_module(
    store: &mut Store,
    ids: &mut IdGen,
    input: CreateModuleInput,
) -> Result<ModuleDto, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = store.create_module(&project, ids.module())?;
    Ok(ModuleDto::from_module(&module))
}

pub fn list_modules(store: &Store, input: ListModulesInput) -> Result<Vec<ModuleDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    Ok(store
        .modules_of(&project)
        .iter()
        .map(|m| ModuleDto::from_module(m))
        .collect())
}

pub fn create_requirement(
    store: &mut Store,
    ids: &mut IdGen,
    input: CreateRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    let content = ruth_core::domain::Content::new(input.content)?;
    let author = Author::Human(HumanId::new(input.author)?);
    let artifact_id = ids.requirement();
    store.create_artifact(
        &project,
        &module,
        artifact_id.clone(),
        ArtifactType::Requirement,
    )?;
    let version_id = IdGen::version(&artifact_id, 1);
    store.create_version(
        &project,
        &artifact_id,
        None,
        version_id,
        content,
        &author,
        &[],
    )?;
    detail(store, &artifact_id)
}

pub fn list_requirements(
    store: &Store,
    input: ListRequirementsInput,
) -> Result<Vec<ArtifactDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    Ok(store
        .artifacts_of(&project, &module)
        .iter()
        .filter(|a| a.artifact_type() == ArtifactType::Requirement)
        .map(|a| ArtifactDto::from_artifact(a))
        .collect())
}

/// Todos los artefactos del módulo, de cualquier tipo, para el navegador.
pub fn list_artifacts(
    store: &Store,
    input: ListArtifactsInput,
) -> Result<Vec<ArtifactDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    Ok(store
        .artifacts_of(&project, &module)
        .iter()
        .map(|a| ArtifactDto::from_artifact(a))
        .collect())
}

pub fn get_requirement(
    store: &Store,
    input: GetRequirementInput,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id)?;
    detail(store, &artifact)
}

pub fn save_version(
    store: &mut Store,
    input: SaveVersionInput,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id)?;
    let expected = ruth_core::domain::VersionId::new(input.expected_version_id)?;
    let content = ruth_core::domain::Content::new(input.content)?;
    let author = Author::Human(HumanId::new(input.author)?);
    let number = store.versions_of(&artifact).len() as u32 + 1;
    let version_id = IdGen::version(&artifact, number);
    store.create_version(
        &project,
        &artifact,
        Some(&expected),
        version_id,
        content,
        &author,
        &[],
    )?;
    detail(store, &artifact)
}

/// Aprueba la versión actual y devuelve el detalle autoritativo actualizado.
/// `now` es la fecha generada en la frontera (el dominio no lee el reloj).
pub fn approve_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id)?;
    let expected = ruth_core::domain::VersionId::new(input.expected_version_id)?;
    let approver = Author::Human(HumanId::new(input.approver)?);
    let at = ruth_core::domain::Date::new(now.to_string())?;
    store.approve(&project, &artifact, &expected, &approver, at)?;
    detail(store, &artifact)
}

fn detail(
    store: &Store,
    artifact: &ruth_core::domain::ArtifactId,
) -> Result<RequirementDetail, ApiError> {
    let Some(artifact_ref) = store.artifact(artifact) else {
        return Err(CoreError::ArtifactNotFound {
            artifact: artifact.clone(),
        }
        .into());
    };
    let versions: Vec<VersionDto> = store
        .versions_of(artifact)
        .iter()
        .map(|v| VersionDto::from_version(v))
        .collect();
    let Some(current) = versions.last() else {
        return Err(ApiError::internal(format!(
            "el requisito {artifact} no tiene versiones"
        )));
    };
    let current_version_id = current.id.clone();
    let mut approvals = Vec::new();
    for version in store.versions_of(artifact) {
        approvals.extend(
            store
                .approvals_of(version.id())
                .iter()
                .map(|a| ApprovalDto::from_approval(a)),
        );
    }
    Ok(RequirementDetail {
        artifact: ArtifactDto::from_artifact(artifact_ref),
        versions,
        approvals,
        current_version_id,
    })
}

impl ProjectDto {
    fn from_project(project: &Project) -> Self {
        Self {
            id: project.id().as_str().to_string(),
        }
    }
}

impl ModuleDto {
    fn from_module(module: &Module) -> Self {
        Self {
            id: module.id().as_str().to_string(),
            project_id: module.project().as_str().to_string(),
        }
    }
}

impl ArtifactDto {
    fn from_artifact(artifact: &Artifact) -> Self {
        Self {
            id: artifact.id().as_str().to_string(),
            project_id: artifact.project().as_str().to_string(),
            module_id: artifact.module().as_str().to_string(),
            kind: match artifact.artifact_type() {
                ArtifactType::Requirement => "requirement",
                ArtifactType::Flow => "flow",
                ArtifactType::DataModel => "data_model",
            }
            .to_string(),
        }
    }
}

impl VersionDto {
    fn from_version(version: &ruth_core::domain::Version) -> Self {
        Self {
            id: version.id().as_str().to_string(),
            number: version.number(),
            content: version.content().as_str().to_string(),
            provenance: ProvenanceDto::from_provenance(version.provenance()),
            sources: version
                .sources()
                .iter()
                .map(|s| s.as_str().to_string())
                .collect(),
        }
    }
}

impl ProvenanceDto {
    fn from_provenance(provenance: &ruth_core::domain::Provenance) -> Self {
        match provenance {
            ruth_core::domain::Provenance::Human(human) => Self {
                kind: "human".to_string(),
                by: human.as_str().to_string(),
            },
            ruth_core::domain::Provenance::AiProposal { agent } => Self {
                kind: "ai".to_string(),
                by: agent.as_str().to_string(),
            },
        }
    }
}

impl ApprovalDto {
    fn from_approval(approval: &Approval) -> Self {
        Self {
            version_id: approval.version().as_str().to_string(),
            approved_by: approval.approved_by().as_str().to_string(),
            at: approval.at().as_str().to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Store, IdGen) {
        (Store::new(), IdGen::new())
    }

    fn baby_requirement(store: &mut Store, ids: &mut IdGen) -> RequirementDetail {
        let project = create_project(store, ids).expect("proyecto");
        let module = create_module(
            store,
            ids,
            CreateModuleInput {
                project_id: project.id.clone(),
            },
        )
        .expect("módulo");
        create_requirement(
            store,
            ids,
            CreateRequirementInput {
                project_id: project.id,
                module_id: module.id,
                content: "Confirmar una venta descuenta stock.".to_string(),
                author: "ana".to_string(),
            },
        )
        .expect("requisito")
    }

    #[test]
    fn creates_edits_and_approves_a_requirement() {
        let (mut store, mut ids) = setup();
        let detail = baby_requirement(&mut store, &mut ids);
        assert_eq!(detail.versions.len(), 1);
        assert_eq!(detail.current_version_id, detail.versions[0].id);
        assert!(detail.approvals.is_empty());

        let saved = save_version(
            &mut store,
            SaveVersionInput {
                project_id: detail.artifact.project_id.clone(),
                artifact_id: detail.artifact.id.clone(),
                expected_version_id: detail.current_version_id.clone(),
                content: "Confirmar descuenta stock; reservas antes.".to_string(),
                author: "ana".to_string(),
            },
        )
        .expect("guardar");
        assert_eq!(saved.versions.len(), 2);
        assert_eq!(
            saved.versions[0].content,
            "Confirmar una venta descuenta stock."
        );
        assert_eq!(saved.versions[1].number, 2);

        let approved = approve_version(
            &mut store,
            ApproveVersionInput {
                project_id: detail.artifact.project_id.clone(),
                artifact_id: detail.artifact.id.clone(),
                expected_version_id: saved.current_version_id.clone(),
                approver: "bruno".to_string(),
            },
            "2026-10-27T10:00:00Z",
        )
        .expect("aprobar");
        assert_eq!(approved.approvals.len(), 1);
        assert_eq!(approved.approvals[0].approved_by, "bruno");
        assert_eq!(approved.approvals[0].version_id, saved.current_version_id);
    }

    #[test]
    fn stale_expected_version_fails_without_mutation() {
        let (mut store, mut ids) = setup();
        let detail = baby_requirement(&mut store, &mut ids);
        let before = store.clone();
        let err = save_version(
            &mut store,
            SaveVersionInput {
                project_id: detail.artifact.project_id.clone(),
                artifact_id: detail.artifact.id.clone(),
                expected_version_id: "req-3-v99".to_string(),
                content: "cambio con base obsoleta".to_string(),
                author: "ana".to_string(),
            },
        )
        .expect_err("debe fallar");
        assert_eq!(err.kind, "stale_version");
        assert_eq!(store, before);
    }

    #[test]
    fn empty_content_is_rejected() {
        let (mut store, mut ids) = setup();
        let project = create_project(&mut store, &mut ids).expect("proyecto");
        let module = create_module(
            &mut store,
            &mut ids,
            CreateModuleInput {
                project_id: project.id.clone(),
            },
        )
        .expect("módulo");
        let err = create_requirement(
            &mut store,
            &mut ids,
            CreateRequirementInput {
                project_id: project.id,
                module_id: module.id,
                content: "   ".to_string(),
                author: "ana".to_string(),
            },
        )
        .expect_err("debe fallar");
        assert_eq!(err.kind, "empty_content");
    }

    #[test]
    fn lists_projects_modules_and_requirements() {
        let (mut store, mut ids) = setup();
        let detail = baby_requirement(&mut store, &mut ids);
        assert_eq!(list_projects(&store).len(), 1);
        let modules = list_modules(
            &store,
            ListModulesInput {
                project_id: detail.artifact.project_id.clone(),
            },
        )
        .expect("módulos");
        assert_eq!(modules.len(), 1);
        let reqs = list_requirements(
            &store,
            ListRequirementsInput {
                project_id: detail.artifact.project_id.clone(),
                module_id: detail.artifact.module_id.clone(),
            },
        )
        .expect("requisitos");
        assert_eq!(reqs.len(), 1);
        assert_eq!(reqs[0].kind, "requirement");
    }

    #[test]
    fn unknown_project_listing_fails_stably() {
        let (store, _) = setup();
        let err = list_modules(
            &store,
            ListModulesInput {
                project_id: "proy-9".to_string(),
            },
        )
        .expect_err("debe fallar");
        assert_eq!(err.kind, "project_not_found");
    }
}
