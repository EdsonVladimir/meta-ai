//! Errores de dominio: tipados y comprensibles, sin strings ambiguos.

use std::fmt;

use crate::domain::{
    AgentId, ArtifactId, BaselineId, DeliveryId, HumanId, ModuleId, Name, ProjectId, VersionId,
};

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
    DeliveryNotFound {
        delivery: DeliveryId,
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
    DuplicateDelivery {
        delivery: DeliveryId,
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
    /// Una entrega de trabajo vacía no exporta nada.
    EmptyDelivery,
    /// El mismo artefacto aparece dos veces en una entrega de trabajo.
    DeliveryDuplicateArtifact {
        artifact: ArtifactId,
    },
    /// La versión indicada no pertenece al artefacto indicado.
    DeliveryMismatch {
        artifact: ArtifactId,
        version: VersionId,
    },
    /// Operación de escritura sobre un módulo archivado.
    ArchivedModule {
        module: ModuleId,
    },
    /// Operación de escritura sobre un artefacto archivado (propio o por
    /// contexto de su módulo).
    ArchivedArtifact {
        artifact: ArtifactId,
    },
    /// La versión depende de una fuente archivada: no puede aprobarse ni
    /// entrar en una baseline hasta restaurar la fuente o revisar la versión.
    ArchivedSource {
        version: VersionId,
        source: VersionId,
    },
    /// El artefacto tiene versiones aprobadas: no puede eliminarse.
    DeleteHasApprovals {
        artifact: ArtifactId,
    },
    /// Otros artefactos dependen de sus versiones: no puede eliminarse.
    DeleteHasDependents {
        artifact: ArtifactId,
        dependents: Vec<ArtifactId>,
    },
    /// Alguna baseline lo incluye: no puede eliminarse.
    DeleteInBaseline {
        artifact: ArtifactId,
        baseline: BaselineId,
    },
    /// Alguna entrega de trabajo lo incluye: no puede eliminarse.
    DeleteInDelivery {
        artifact: ArtifactId,
        delivery: DeliveryId,
    },
    /// El módulo aún contiene artefactos: no puede eliminarse.
    DeleteModuleNotEmpty {
        module: ModuleId,
        artifacts: Vec<ArtifactId>,
    },
    /// El nombre o título está vacío (o solo espacios).
    EmptyName,
    /// El nombre o título supera el máximo documentado.
    NameTooLong {
        chars: usize,
    },
    /// El nombre cambió desde que se leyó: hay que revisar y reintentar.
    StaleName {
        expected: Option<String>,
        actual: Option<String>,
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
            Self::DeliveryNotFound { delivery } => write!(f, "entrega inexistente: {delivery}"),
            Self::DuplicateProject { project } => write!(f, "proyecto duplicado: {project}"),
            Self::DuplicateModule { module } => write!(f, "módulo duplicado: {module}"),
            Self::DuplicateArtifact { artifact } => write!(f, "artefacto duplicado: {artifact}"),
            Self::DuplicateVersion { version } => write!(f, "versión duplicada: {version}"),
            Self::DuplicateBaseline { baseline } => write!(f, "baseline duplicada: {baseline}"),
            Self::DuplicateDelivery { delivery } => write!(f, "entrega duplicada: {delivery}"),
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
            Self::EmptyDelivery => write!(f, "una entrega necesita al menos un artefacto"),
            Self::DeliveryDuplicateArtifact { artifact } => {
                write!(f, "artefacto duplicado en la entrega: {artifact}")
            }
            Self::DeliveryMismatch { artifact, version } => {
                write!(
                    f,
                    "la versión {version} no pertenece al artefacto {artifact}"
                )
            }
            Self::ArchivedModule { module } => {
                write!(
                    f,
                    "el módulo {module} está archivado: restaúralo para operar con él"
                )
            }
            Self::ArchivedArtifact { artifact } => {
                write!(
                    f,
                    "el artefacto {artifact} está archivado: restaúralo para operar con él"
                )
            }
            Self::ArchivedSource { version, source } => {
                write!(
                    f,
                    "la versión {version} depende de {source}, que está archivada: \
                     restaura la fuente o crea una versión revisada sin ella"
                )
            }
            Self::DeleteHasApprovals { artifact } => {
                write!(
                    f,
                    "{artifact} tiene aprobaciones y no puede eliminarse: archívalo"
                )
            }
            Self::DeleteHasDependents {
                artifact,
                dependents,
            } => {
                let who = dependents
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ");
                write!(
                    f,
                    "{artifact} no puede eliminarse: dependen de él {who}. Archívalo"
                )
            }
            Self::DeleteInBaseline { artifact, baseline } => {
                write!(
                    f,
                    "{artifact} no puede eliminarse: la baseline {baseline} lo incluye. Archívalo"
                )
            }
            Self::DeleteInDelivery { artifact, delivery } => {
                write!(
                    f,
                    "{artifact} no puede eliminarse: la entrega {delivery} lo incluye. Archívalo"
                )
            }
            Self::DeleteModuleNotEmpty { module, artifacts } => {
                write!(
                    f,
                    "el módulo {module} no está vacío ({}): vacíalo primero",
                    artifacts
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
            Self::EmptyName => {
                write!(f, "el nombre no puede estar vacío")
            }
            Self::NameTooLong { chars } => {
                write!(
                    f,
                    "el nombre tiene {chars} caracteres; el máximo es {}",
                    Name::MAX_CHARS
                )
            }
            Self::StaleName { expected, actual } => {
                write!(
                    f,
                    "el nombre cambió mientras lo editabas (esperabas {}, ahora es {}): \
                     revísalo y guarda de nuevo",
                    display_name(expected.as_deref()),
                    display_name(actual.as_deref())
                )
            }
        }
    }
}

/// Cómo mostrar un nombre esperado/actual en mensajes (`None` = sin título).
fn display_name(name: Option<&str>) -> String {
    match name {
        Some(text) => format!("«{text}»"),
        None => "«sin título»".to_string(),
    }
}

fn opt(id: &Option<VersionId>) -> String {
    id.as_ref()
        .map(ToString::to_string)
        .unwrap_or_else(|| "ninguna".to_string())
}

impl std::error::Error for CoreError {}
