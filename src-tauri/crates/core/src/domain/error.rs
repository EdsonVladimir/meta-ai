//! Errores de dominio: tipados y comprensibles, sin strings ambiguos.

use std::fmt;

use crate::domain::{AgentId, ArtifactId, BaselineId, HumanId, ModuleId, ProjectId, VersionId};

/// Fallo de una operación del núcleo. Las operaciones que devuelven error no
/// modifican el estado: primero validan todo y solo después mutan.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CoreError {
    EmptyId {
        entity: &'static str,
    },
    EmptyDate,
    EmptyContent,
    ProjectNotFound {
        project: ProjectId,
    },
    ModuleNotFound {
        module: ModuleId,
    },
    ArtifactNotFound {
        artifact: ArtifactId,
    },
    VersionNotFound {
        version: VersionId,
    },
    BaselineNotFound {
        baseline: BaselineId,
    },
    DuplicateProject {
        project: ProjectId,
    },
    DuplicateModule {
        module: ModuleId,
    },
    DuplicateArtifact {
        artifact: ArtifactId,
    },
    DuplicateVersion {
        version: VersionId,
    },
    DuplicateBaseline {
        baseline: BaselineId,
    },
    /// El módulo no pertenece al proyecto indicado.
    ModuleNotInProject {
        module: ModuleId,
        project: ProjectId,
    },
    /// El artefacto no pertenece al proyecto indicado.
    ArtifactNotInProject {
        artifact: ArtifactId,
        project: ProjectId,
    },
    /// Una fuente apunta a una versión de otro proyecto.
    CrossProjectDependency {
        from: VersionId,
        to: VersionId,
    },
    /// La misma fuente declarada dos veces en una versión.
    DuplicateSource {
        source: VersionId,
    },
    /// La dependencia crearía un ciclo; incluye el camino del ciclo.
    DependencyCycle {
        cycle: Vec<VersionId>,
    },
    /// Las versiones de un artefacto no son consecutivas desde 1.
    NonConsecutiveVersions {
        artifact: ArtifactId,
    },
    /// Concurrencia optimista: la versión actual ya no es la esperada.
    StaleVersion {
        expected: Option<VersionId>,
        actual: Option<VersionId>,
    },
    /// La versión tiene fuentes que ya no son actuales.
    VersionNotValid {
        version: VersionId,
        stale_sources: Vec<VersionId>,
    },
    /// La versión no es la actual de su artefacto.
    VersionNotCurrent {
        version: VersionId,
        current: VersionId,
    },
    /// La versión no tiene ninguna aprobación.
    VersionNotApproved {
        version: VersionId,
    },
    /// La misma persona intenta aprobar dos veces la misma versión.
    DuplicateApproval {
        version: VersionId,
        human: HumanId,
    },
    /// Solo una persona puede aprobar; un agente no puede, ni siquiera lo suyo.
    ApproverMustBeHuman {
        approver: AgentId,
    },
    /// Una baseline vacía no exporta nada.
    EmptyBaseline,
    /// El mismo artefacto aparece dos veces en una baseline.
    BaselineDuplicateArtifact {
        artifact: ArtifactId,
    },
    /// La versión indicada no pertenece al artefacto indicado.
    BaselineMismatch {
        artifact: ArtifactId,
        version: VersionId,
    },
    /// Falta en la baseline una fuente necesaria para reproducir la versión.
    BaselineMissingSource {
        version: VersionId,
        source: VersionId,
    },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyId { entity } => write!(f, "identificador de {entity} vacío"),
            Self::EmptyDate => write!(f, "fecha vacía: indícala como entrada"),
            Self::EmptyContent => write!(f, "contenido vacío: una versión necesita texto"),
            Self::ProjectNotFound { project } => write!(f, "proyecto inexistente: {project}"),
            Self::ModuleNotFound { module } => write!(f, "módulo inexistente: {module}"),
            Self::ArtifactNotFound { artifact } => write!(f, "artefacto inexistente: {artifact}"),
            Self::VersionNotFound { version } => write!(f, "versión inexistente: {version}"),
            Self::BaselineNotFound { baseline } => write!(f, "baseline inexistente: {baseline}"),
            Self::DuplicateProject { project } => write!(f, "proyecto duplicado: {project}"),
            Self::DuplicateModule { module } => write!(f, "módulo duplicado: {module}"),
            Self::DuplicateArtifact { artifact } => write!(f, "artefacto duplicado: {artifact}"),
            Self::DuplicateVersion { version } => write!(f, "versión duplicada: {version}"),
            Self::DuplicateBaseline { baseline } => write!(f, "baseline duplicada: {baseline}"),
            Self::ModuleNotInProject { module, project } => {
                write!(f, "el módulo {module} no pertenece al proyecto {project}")
            }
            Self::ArtifactNotInProject { artifact, project } => {
                write!(
                    f,
                    "el artefacto {artifact} no pertenece al proyecto {project}"
                )
            }
            Self::CrossProjectDependency { from, to } => {
                write!(f, "dependencia entre proyectos distintos: {from} → {to}")
            }
            Self::DuplicateSource { source } => {
                write!(f, "fuente duplicada en la versión: {source}")
            }
            Self::DependencyCycle { cycle } => {
                let path = cycle
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(" → ");
                write!(f, "la dependencia crearía un ciclo: {path}")
            }
            Self::NonConsecutiveVersions { artifact } => {
                write!(f, "las versiones de {artifact} no son consecutivas desde 1")
            }
            Self::StaleVersion { expected, actual } => {
                write!(
                    f,
                    "la versión actual cambió: esperada {}, actual {}",
                    opt(expected),
                    opt(actual)
                )
            }
            Self::VersionNotValid {
                version,
                stale_sources,
            } => {
                let sources = stale_sources
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(f, "la versión {version} no está vigente (fuentes desactualizadas: {sources}); crea una versión revisada")
            }
            Self::VersionNotCurrent { version, current } => {
                write!(
                    f,
                    "la versión {version} no es la actual (actual: {current})"
                )
            }
            Self::VersionNotApproved { version } => {
                write!(f, "la versión {version} no tiene aprobación")
            }
            Self::DuplicateApproval { version, human } => {
                write!(f, "{human} ya aprobó la versión {version}")
            }
            Self::ApproverMustBeHuman { approver } => {
                write!(
                    f,
                    "solo una persona puede aprobar; {approver} es una propuesta de IA"
                )
            }
            Self::EmptyBaseline => write!(f, "una baseline necesita al menos un artefacto"),
            Self::BaselineDuplicateArtifact { artifact } => {
                write!(f, "artefacto duplicado en la baseline: {artifact}")
            }
            Self::BaselineMismatch { artifact, version } => {
                write!(
                    f,
                    "la versión {version} no pertenece al artefacto {artifact}"
                )
            }
            Self::BaselineMissingSource { version, source } => {
                write!(
                    f,
                    "la baseline no incluye la fuente {source} necesaria para {version}"
                )
            }
        }
    }
}

fn opt(id: &Option<VersionId>) -> String {
    id.as_ref()
        .map(ToString::to_string)
        .unwrap_or_else(|| "ninguna".to_string())
}

impl std::error::Error for CoreError {}
