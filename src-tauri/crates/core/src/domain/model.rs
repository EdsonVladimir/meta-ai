//! Entidades del dominio con sus invariantes locales.
//!
//! Las invariantes que abarcan varias entidades (ciclos, vigencia, coherencia
//! de baselines) viven en [`analysis`](crate::domain::analysis) y se aplican
//! desde los casos de uso. Los campos son privados: nadie puede mutar una
//! entidad saltándose sus constructores.

use std::collections::HashMap;
use std::fmt;

use crate::domain::{
    AgentId, ArtifactId, BaselineId, CoreError, DeliveryId, HumanId, ModuleId, ProjectId, VersionId,
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
    Mockup,
}

impl fmt::Display for ArtifactType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Requirement => f.write_str("requisito"),
            Self::Flow => f.write_str("flujo"),
            Self::DataModel => f.write_str("modelo de datos"),
            Self::Mockup => f.write_str("mockup"),
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

/// Nombre organizativo o título: texto libre no vacío de hasta 120
/// caracteres. Se guarda sin espacios extremos. Los duplicados se permiten:
/// la identidad es el ID, nunca el nombre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Name {
    value: String,
}

impl Name {
    pub const MAX_CHARS: usize = 120;

    pub fn new(value: String) -> Result<Self, CoreError> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(CoreError::EmptyName);
        }
        let chars = trimmed.chars().count();
        if chars > Self::MAX_CHARS {
            return Err(CoreError::NameTooLong { chars });
        }
        Ok(Self {
            value: trimmed.to_string(),
        })
    }

    pub fn as_str(&self) -> &str {
        &self.value
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Project {
    id: ProjectId,
    /// Nombre organizativo editable. Al crear, el ID; renombrar no toca
    /// la identidad ni nada que cuelgue de ella.
    name: String,
}

impl Project {
    pub fn new(id: ProjectId) -> Self {
        let name = id.as_str().to_string();
        Self { id, name }
    }

    pub fn id(&self) -> &ProjectId {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Solo lo llaman los casos de uso (`rename_*` del `Store`, que validan
    /// pertenencia, archivado y concurrencia) y la reconstitución.
    pub fn set_name(&mut self, name: Name) {
        self.name = name.value;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Module {
    id: ModuleId,
    project: ProjectId,
    /// Nombre organizativo editable. Al crear, el ID.
    name: String,
    /// Archivado reversible: oculta el contenido por contexto sin tocar el
    /// estado individual de sus artefactos. Solo lo cambian los casos de uso.
    archived: bool,
}

impl Module {
    pub fn new(id: ModuleId, project: ProjectId) -> Self {
        let name = id.as_str().to_string();
        Self {
            id,
            project,
            name,
            archived: false,
        }
    }

    pub fn id(&self) -> &ModuleId {
        &self.id
    }

    pub fn project(&self) -> &ProjectId {
        &self.project
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    /// Solo lo llaman los casos de uso (`rename_*` del `Store`, que validan
    /// pertenencia, archivado y concurrencia) y la reconstitución.
    pub fn set_name(&mut self, name: Name) {
        self.name = name.value;
    }

    pub fn archived(&self) -> bool {
        self.archived
    }

    /// Reconstitución desde persistencia (cualquier valor es válido: el
    /// archivado no tiene invariantes propias). Las operaciones normales
    /// usan los casos de uso (`set_*_archived` del `Store`).
    pub fn set_archived(&mut self, archived: bool) {
        self.archived = archived;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Artifact {
    id: ArtifactId,
    project: ProjectId,
    module: ModuleId,
    artifact_type: ArtifactType,
    /// Título editable como metadato, separado del contenido semántico.
    /// `None` = sin título propio (la presentación deriva uno legible sin
    /// tocar el dominio). Renombrar no crea versiones ni toca aprobaciones.
    title: Option<String>,
    /// Archivado individual reversible. El archivado efectivo de un artefacto
    /// es este flag o el de su módulo (se calcula, no se almacena).
    archived: bool,
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
            title: None,
            archived: false,
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

    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// Solo lo llaman los casos de uso (`rename_artifact` del `Store`, que
    /// valida pertenencia, archivado y concurrencia) y la reconstitución.
    pub fn set_title(&mut self, title: Option<Name>) {
        self.title = title.map(|name| name.value);
    }

    pub fn archived(&self) -> bool {
        self.archived
    }

    /// Reconstitución desde persistencia (cualquier valor es válido: el
    /// archivado no tiene invariantes propias). Las operaciones normales
    /// usan los casos de uso (`set_*_archived` del `Store`).
    pub fn set_archived(&mut self, archived: bool) {
        self.archived = archived;
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

/// Cambio de título registrado: metadato versionado del artefacto, separado
/// del contenido semántico. No crea versiones ni toca aprobaciones.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TitleChange {
    artifact: ArtifactId,
    title: String,
    by: HumanId,
    at: Date,
}

impl TitleChange {
    pub fn new(artifact: ArtifactId, title: Name, by: HumanId, at: Date) -> Self {
        Self {
            artifact,
            title: title.value,
            by,
            at,
        }
    }

    pub fn artifact(&self) -> &ArtifactId {
        &self.artifact
    }

    pub fn title(&self) -> &str {
        &self.title
    }

    pub fn by(&self) -> &HumanId {
        &self.by
    }

    pub fn at(&self) -> &Date {
        &self.at
    }
}

/// Conjunto coherente de versiones aprobadas para exportación futura.
/// Inmutable y reproducible: guarda versiones exactas ordenadas de forma
/// determinista, así que no le afectan cambios posteriores del proyecto.
/// También fija el título vigente de cada entrada: exportar la baseline
/// histórica jamás consulta títulos actuales.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Baseline {
    id: BaselineId,
    project: ProjectId,
    entries: Vec<(ArtifactId, VersionId)>,
    /// Título vigente de cada entrada al crear la baseline (`None` = sin
    /// título propio entonces). Fijo para siempre: la baseline histórica
    /// conserva sus nombres originales.
    titles: HashMap<ArtifactId, Option<String>>,
    at: Date,
}

impl Baseline {
    pub fn new(
        id: BaselineId,
        project: ProjectId,
        mut entries: Vec<(ArtifactId, VersionId)>,
        titles: HashMap<ArtifactId, Option<String>>,
        at: Date,
    ) -> Self {
        entries.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
        Self {
            id,
            project,
            entries,
            titles,
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

    /// Título fijado de una entrada (`None` externo = la entrada no existe;
    /// `None` interno = existía pero sin título propio).
    pub fn title_of(&self, artifact: &ArtifactId) -> Option<Option<&str>> {
        self.titles.get(artifact).map(|t| t.as_deref())
    }

    pub fn at(&self) -> &Date {
        &self.at
    }
}

/// Entrega de trabajo/borrador: foto de versiones guardadas para compartir
/// o exportar trabajo en curso, SIN exigir aprobación. Separada de
/// [`Baseline`]: sus invariantes no relajan las de la baseline aprobada.
/// Las entradas deben ser actuales, del proyecto, no archivadas y cerradas
/// bajo fuentes; las revisiones y desactualizaciones se identifican al
/// leer, no se prohíben al crear. Inmutable una vez creada.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkDelivery {
    id: DeliveryId,
    project: ProjectId,
    name: String,
    description: Option<String>,
    scope_module: Option<ModuleId>,
    entries: Vec<(ArtifactId, VersionId)>,
    /// Título vigente de cada entrada al crear la entrega, fijo para
    /// siempre (igual que en la baseline).
    titles: HashMap<ArtifactId, Option<String>>,
    at: Date,
}

impl WorkDelivery {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: DeliveryId,
        project: ProjectId,
        name: String,
        description: Option<String>,
        scope_module: Option<ModuleId>,
        mut entries: Vec<(ArtifactId, VersionId)>,
        titles: HashMap<ArtifactId, Option<String>>,
        at: Date,
    ) -> Self {
        entries.sort_by(|a, b| a.0.as_str().cmp(b.0.as_str()));
        Self {
            id,
            project,
            name,
            description,
            scope_module,
            entries,
            titles,
            at,
        }
    }

    pub fn id(&self) -> &DeliveryId {
        &self.id
    }

    pub fn project(&self) -> &ProjectId {
        &self.project
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    pub fn scope_module(&self) -> Option<&ModuleId> {
        self.scope_module.as_ref()
    }

    pub fn entries(&self) -> &[(ArtifactId, VersionId)] {
        &self.entries
    }

    /// Título fijado de una entrada (`None` externo = la entrada no existe;
    /// `None` interno = existía pero sin título propio).
    pub fn title_of(&self, artifact: &ArtifactId) -> Option<Option<&str>> {
        self.titles.get(artifact).map(|t| t.as_deref())
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
            std::collections::HashMap::new(),
            Date::new("2026-10-27").expect("date"),
        );
        let order: Vec<&str> = baseline.entries().iter().map(|(a, _)| a.as_str()).collect();
        assert_eq!(order, vec!["a", "z"]);
    }
}
