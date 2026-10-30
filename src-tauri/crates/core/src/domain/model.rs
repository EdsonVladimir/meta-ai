//! Domain entities with their local invariants.
//!
//! Invariants spanning several entities (cycles, freshness, baseline
//! coherence) live in [`analysis`](crate::domain::analysis) and apply
//! from the use cases. Fields are private: nobody can mutate an
//! entity skipping its constructors.

use std::collections::HashMap;
use std::fmt;

use crate::domain::{
    AgentId, ArtifactId, BaselineId, CoreError, DeliveryId, HumanId, ModuleId, ProjectId, VersionId,
};

/// Non-empty textual content of a version. In this milestone there are no
/// UML, Mermaid or database-model parsers: only text.
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

/// Date supplied as input. The domain reads no clock: the caller
/// provides the date (the boundary will decide its exact format).
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

/// Artifact kind with a stable identity.
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
            Self::Requirement => f.write_str("requirement"),
            Self::Flow => f.write_str("flow"),
            Self::DataModel => f.write_str("data model"),
            Self::Mockup => f.write_str("mockup"),
        }
    }
}

/// Who performs an action: a person or an AI agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Author {
    Human(HumanId),
    Agent(AgentId),
}

/// Origin of a version: human authorship or AI proposal.
///
/// Having human provenance is domain data, not authentication:
/// identity control will be implemented at the corresponding boundary.
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

/// Organizational name or title: non-empty free text up to 120
/// chars. Stored without edge spaces. Duplicates are allowed:
/// identity is the ID, never the name.
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
    /// Editable organizational name. On creation, the ID; renaming touches
    /// neither identity nor anything hanging from it.
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

    /// Only called by the use cases (`Store::rename_*`, which validate
    /// membership, archiving and concurrency) and reconstitution.
    pub fn set_name(&mut self, name: Name) {
        self.name = name.value;
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Module {
    id: ModuleId,
    project: ProjectId,
    /// Editable organizational name. On creation, the ID.
    name: String,
    /// Reversible archiving: hides content by context without touching
    /// the individual state of its artifacts. Only the use cases change it.
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

    /// Only called by the use cases (`Store::rename_*`, which validate
    /// membership, archiving and concurrency) and reconstitution.
    pub fn set_name(&mut self, name: Name) {
        self.name = name.value;
    }

    pub fn archived(&self) -> bool {
        self.archived
    }

    /// Reconstitution from persistence (any value is valid: archiving
    /// has no own invariants). Normal operations use the use cases
    /// (`Store::set_*_archived`).
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
    /// Editable title as metadata, separate from semantic content.
    /// `None` = no own title (presentation derives a readable one without
    /// touching the domain). Renaming creates no versions and touches no approvals.
    title: Option<String>,
    /// Individually reversible archiving. The effective archiving of an artifact
    /// is this flag or its module one (computed, not stored).
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

    /// Only called by the use cases (`Store::rename_artifact`, which
    /// validates membership, archiving and concurrency) and reconstitution.
    pub fn set_title(&mut self, title: Option<Name>) {
        self.title = title.map(|name| name.value);
    }

    pub fn archived(&self) -> bool {
        self.archived
    }

    /// Reconstitution from persistence (any value is valid: archiving
    /// has no own invariants). Normal operations use the use cases
    /// (`Store::set_*_archived`).
    pub fn set_archived(&mut self, archived: bool) {
        self.archived = archived;
    }
}

/// Immutable version: identity, number, content and provenance. An edit
/// creates a new version; history never changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Version {
    id: VersionId,
    artifact: ArtifactId,
    number: u32,
    content: Content,
    provenance: Provenance,
    /// Exact source versions it derives from; never "latest".
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

/// Approval of an exact version by a person on a given date. The
/// approval history is never deleted and a new version inherits no
/// approvals (each approval points at an exact version).
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

/// Recorded title change: versioned artifact metadata, separate from
/// semantic content. It creates no versions and touches no approvals.
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

/// Coherent set of approved versions for future export. Immutable and
/// reproducible: it stores exact versions sorted deterministically, so
/// later project changes do not affect it. It also pins the current
/// title of each entry: exporting the historic baseline never consults
/// current titles.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Baseline {
    id: BaselineId,
    project: ProjectId,
    entries: Vec<(ArtifactId, VersionId)>,
    /// Current title of each entry when creating the baseline (`None` = no
    /// own title then). Fixed forever: the historic baseline keeps its
    /// original names.
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

    /// Pinned title of an entry (outer `None` = the entry does not exist;
    /// inner `None` = it existed but had no own title).
    pub fn title_of(&self, artifact: &ArtifactId) -> Option<Option<&str>> {
        self.titles.get(artifact).map(|t| t.as_deref())
    }

    pub fn at(&self) -> &Date {
        &self.at
    }
}

/// Work/draft delivery: a snapshot of saved versions to share or
/// export work in progress, WITHOUT requiring approval. Separate from
/// [`Baseline`]: its invariants do not relax the approved-baseline ones.
/// Entries must be current, from the project, unarchived and closed
/// under sources; reviews and staleness are identified on read, not
/// forbidden on creation. Immutable once created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkDelivery {
    id: DeliveryId,
    project: ProjectId,
    name: String,
    description: Option<String>,
    scope_module: Option<ModuleId>,
    entries: Vec<(ArtifactId, VersionId)>,
    /// Current title of each entry when creating the delivery, fixed
    /// forever (same as in the baseline).
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

    /// Pinned title of an entry (outer `None` = the entry does not exist;
    /// inner `None` = it existed but had no own title).
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
