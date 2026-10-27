//! Entidades del dominio con sus invariantes locales.
//!
//! Las invariantes que abarcan varias entidades (ciclos, vigencia, coherencia
//! de baselines) viven en [`analysis`](crate::domain::analysis) y se aplican
//! desde los casos de uso. Los campos son privados: nadie puede mutar una
//! entidad saltándose sus constructores.

use std::fmt;

use crate::domain::{
    AgentId, ArtifactId, BaselineId, CoreError, HumanId, ModuleId, ProjectId, VersionId,
};

/// Contenido textual no vacío de una versión. En este hito no hay parsers de
/// UML, Mermaid ni modelos de base de datos: solo texto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Content(String);

impl Content {
    pub fn new(content: impl Into<String>) -> Result<Self, CoreError> {
        let content = content.into();
        if content.trim().is_empty() {
            return Err(CoreError::EmptyContent);
        }
        Ok(Self(content))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Fecha suministrada como entrada. El dominio no lee el reloj: quien llama
/// aporta la fecha (la frontera decidirá su formato exacto).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Date(String);

impl Date {
    pub fn new(date: impl Into<String>) -> Result<Self, CoreError> {
        let date = date.into();
        if date.trim().is_empty() {
            return Err(CoreError::EmptyDate);
        }
        Ok(Self(date))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Tipo de artefacto con identidad estable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ArtifactType {
    Requirement,
    Flow,
    DataModel,
}

impl fmt::Display for ArtifactType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Requirement => f.write_str("requisito"),
            Self::Flow => f.write_str("flujo"),
            Self::DataModel => f.write_str("modelo de datos"),
        }
    }
}

/// Quién realiza una acción: una persona o un agente de IA.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Author {
    Human(HumanId),
    Agent(AgentId),
}

/// Origen de una versión: autoría humana o propuesta de IA.
///
/// Tener procedencia humana es un dato del dominio, no autenticación: el
/// control de identidad se implementará en la frontera correspondiente.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provenance {
    Human(HumanId),
    AiProposal { agent: AgentId },
}

impl Provenance {
    pub fn from_author(author: &Author) -> Self {
        match author {
            Author::Human(human) => Self::Human(human.clone()),
            Author::Agent(agent) => Self::AiProposal {
                agent: agent.clone(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    id: ProjectId,
}

impl Project {
    pub fn new(id: ProjectId) -> Self {
        Self { id }
    }

    pub fn id(&self) -> &ProjectId {
        &self.id
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Module {
    id: ModuleId,
    project: ProjectId,
}

impl Module {
    pub fn new(id: ModuleId, project: ProjectId) -> Self {
        Self { id, project }
    }

    pub fn id(&self) -> &ModuleId {
        &self.id
    }

    pub fn project(&self) -> &ProjectId {
        &self.project
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    id: ArtifactId,
    project: ProjectId,
    module: ModuleId,
    artifact_type: ArtifactType,
}

impl Artifact {
    pub fn new(
        id: ArtifactId,
        project: ProjectId,
        module: ModuleId,
        artifact_type: ArtifactType,
    ) -> Self {
        Self {
            id,
            project,
            module,
            artifact_type,
        }
    }

    pub fn id(&self) -> &ArtifactId {
        &self.id
    }

    pub fn project(&self) -> &ProjectId {
        &self.project
    }

    pub fn module(&self) -> &ModuleId {
        &self.module
    }

    pub fn artifact_type(&self) -> ArtifactType {
        self.artifact_type
    }
}

/// Versión inmutable: identidad, número, contenido y procedencia. Una edición
/// crea una versión nueva; el historial nunca cambia.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    id: VersionId,
    artifact: ArtifactId,
    number: u32,
    content: Content,
    provenance: Provenance,
    /// Versiones fuente exactas de las que deriva; nunca "latest".
    sources: Vec<VersionId>,
}

impl Version {
    pub fn new(
        id: VersionId,
        artifact: ArtifactId,
        number: u32,
        content: Content,
        provenance: Provenance,
        sources: Vec<VersionId>,
    ) -> Self {
        Self {
            id,
            artifact,
            number,
            content,
            provenance,
            sources,
        }
    }

    pub fn id(&self) -> &VersionId {
        &self.id
    }

    pub fn artifact(&self) -> &ArtifactId {
        &self.artifact
    }

    pub fn number(&self) -> u32 {
        self.number
    }

    pub fn content(&self) -> &Content {
        &self.content
    }

    pub fn provenance(&self) -> &Provenance {
        &self.provenance
    }

    pub fn sources(&self) -> &[VersionId] {
        &self.sources
    }
}

/// Aprobación de una versión exacta por una persona en una fecha dada. El
/// historial de aprobaciones nunca se borra y una versión nueva no hereda
/// aprobaciones (cada aprobación apunta a una versión exacta).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Approval {
    version: VersionId,
    approved_by: HumanId,
    at: Date,
}

impl Approval {
    pub fn new(version: VersionId, approved_by: HumanId, at: Date) -> Self {
        Self {
            version,
            approved_by,
            at,
        }
    }

    pub fn version(&self) -> &VersionId {
        &self.version
    }

    pub fn approved_by(&self) -> &HumanId {
        &self.approved_by
    }

    pub fn at(&self) -> &Date {
        &self.at
    }
}

/// Conjunto coherente de versiones aprobadas para exportación futura.
/// Inmutable y reproducible: guarda versiones exactas ordenadas de forma
/// determinista, así que no le afectan cambios posteriores del proyecto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Baseline {
    id: BaselineId,
    project: ProjectId,
    entries: Vec<(ArtifactId, VersionId)>,
    at: Date,
}

impl Baseline {
    pub fn new(
        id: BaselineId,
        project: ProjectId,
        mut entries: Vec<(ArtifactId, VersionId)>,
        at: Date,
    ) -> Self {
        entries.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
        Self {
            id,
            project,
            entries,
            at,
        }
    }

    pub fn id(&self) -> &BaselineId {
        &self.id
    }

    pub fn project(&self) -> &ProjectId {
        &self.project
    }

    pub fn entries(&self) -> &[(ArtifactId, VersionId)] {
        &self.entries
    }

    pub fn at(&self) -> &Date {
        &self.at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_content() {
        assert_eq!(Content::new("   "), Err(CoreError::EmptyContent));
    }

    #[test]
    fn rejects_blank_date() {
        assert_eq!(Date::new(""), Err(CoreError::EmptyDate));
    }

    #[test]
    fn provenance_follows_author() {
        let human = Author::Human(HumanId::new("ana").expect("id"));
        let agent = Author::Agent(AgentId::new("agent-1").expect("id"));
        assert!(matches!(
            Provenance::from_author(&human),
            Provenance::Human(_)
        ));
        assert!(matches!(
            Provenance::from_author(&agent),
            Provenance::AiProposal { .. }
        ));
    }

    #[test]
    fn baseline_orders_entries_deterministically() {
        let baseline = Baseline::new(
            BaselineId::new("b1").expect("id"),
            ProjectId::new("p").expect("id"),
            vec![
                (
                    ArtifactId::new("z").expect("id"),
                    VersionId::new("z1").expect("id"),
                ),
                (
                    ArtifactId::new("a").expect("id"),
                    VersionId::new("a1").expect("id"),
                ),
            ],
            Date::new("2026-10-27").expect("date"),
        );
        let order: Vec<&str> = baseline.entries().iter().map(|(a, _)| a.as_str()).collect();
        assert_eq!(order, vec!["a", "z"]);
    }
}
