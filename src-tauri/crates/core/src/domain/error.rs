//! Domain errors: typed and understandable, no ambiguous strings.

use std::fmt;

use crate::domain::{
    AgentId, ArtifactId, BaselineId, DeliveryId, HumanId, ModuleId, Name, ProjectId, VersionId,
};

/// A core operation failure. Operations returning an error do not
/// mutate state: they validate everything first and only then mutate.
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
    /// The module does not belong to the given project.
    ModuleNotInProject {
        module: ModuleId,
        project: ProjectId,
    },
    /// The artifact does not belong to the given project.
    ArtifactNotInProject {
        artifact: ArtifactId,
        project: ProjectId,
    },
    /// A source points at a version from another project.
    CrossProjectDependency {
        from: VersionId,
        to: VersionId,
    },
    /// The same source declared twice in one version.
    DuplicateSource {
        source: VersionId,
    },
    /// The dependency would create a cycle; includes the cycle path.
    DependencyCycle {
        cycle: Vec<VersionId>,
    },
    /// An artifact versions are not consecutive from 1.
    NonConsecutiveVersions {
        artifact: ArtifactId,
    },
    /// Optimistic concurrency: the current version is no longer the expected one.
    StaleVersion {
        expected: Option<VersionId>,
        actual: Option<VersionId>,
    },
    /// The version has sources that are no longer current.
    VersionNotValid {
        version: VersionId,
        stale_sources: Vec<VersionId>,
    },
    /// The version is not its artifact current one.
    VersionNotCurrent {
        version: VersionId,
        current: VersionId,
    },
    /// The version has no approval.
    VersionNotApproved {
        version: VersionId,
    },
    /// The same person tries to approve the same version twice.
    DuplicateApproval {
        version: VersionId,
        human: HumanId,
    },
    /// Only a person can approve; an agent cannot, not even its own.
    ApproverMustBeHuman {
        approver: AgentId,
    },
    /// An empty baseline exports nothing.
    EmptyBaseline,
    /// The same artifact appears twice in a baseline.
    BaselineDuplicateArtifact {
        artifact: ArtifactId,
    },
    /// The given version does not belong to the given artifact.
    BaselineMismatch {
        artifact: ArtifactId,
        version: VersionId,
    },
    /// The baseline lacks a source needed to reproduce the version.
    BaselineMissingSource {
        version: VersionId,
        source: VersionId,
    },
    /// An empty work delivery exports nothing.
    EmptyDelivery,
    /// The same artifact appears twice in a work delivery.
    DeliveryDuplicateArtifact {
        artifact: ArtifactId,
    },
    /// The given version does not belong to the given artifact.
    DeliveryMismatch {
        artifact: ArtifactId,
        version: VersionId,
    },
    /// Write operation on an archived module.
    ArchivedModule {
        module: ModuleId,
    },
    /// Write operation on an archived artifact (its own or via its
    /// module context).
    ArchivedArtifact {
        artifact: ArtifactId,
    },
    /// The version depends on an archived source: it cannot be approved
    /// or enter a baseline until the source is restored or the version reviewed.
    ArchivedSource {
        version: VersionId,
        source: VersionId,
    },
    /// The artifact has approved versions: it cannot be deleted.
    DeleteHasApprovals {
        artifact: ArtifactId,
    },
    /// Other artifacts depend on its versions: it cannot be deleted.
    DeleteHasDependents {
        artifact: ArtifactId,
        dependents: Vec<ArtifactId>,
    },
    /// Some baseline includes it: it cannot be deleted.
    DeleteInBaseline {
        artifact: ArtifactId,
        baseline: BaselineId,
    },
    /// Some work delivery includes it: it cannot be deleted.
    DeleteInDelivery {
        artifact: ArtifactId,
        delivery: DeliveryId,
    },
    /// The module still holds artifacts: it cannot be deleted.
    DeleteModuleNotEmpty {
        module: ModuleId,
        artifacts: Vec<ArtifactId>,
    },
    /// The project still holds modules: it cannot be deleted.
    DeleteProjectNotEmpty {
        project: ProjectId,
        modules: Vec<ModuleId>,
    },
    /// The name or title is empty (or only spaces).
    EmptyName,
    /// The name or title exceeds the documented maximum.
    NameTooLong {
        chars: usize,
    },
    /// The name changed since it was read: review and retry.
    StaleName {
        expected: Option<String>,
        actual: Option<String>,
    },
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyId { entity } => write!(f, "empty {entity} identifier"),
            Self::EmptyDate => write!(f, "empty date: provide it as input"),
            Self::EmptyContent => write!(f, "empty content: a version needs text"),
            Self::ProjectNotFound { project } => write!(f, "missing project: {project}"),
            Self::ModuleNotFound { module } => write!(f, "missing module: {module}"),
            Self::ArtifactNotFound { artifact } => write!(f, "missing artifact: {artifact}"),
            Self::VersionNotFound { version } => write!(f, "missing version: {version}"),
            Self::BaselineNotFound { baseline } => write!(f, "missing baseline: {baseline}"),
            Self::DeliveryNotFound { delivery } => write!(f, "missing delivery: {delivery}"),
            Self::DuplicateProject { project } => write!(f, "duplicate project: {project}"),
            Self::DuplicateModule { module } => write!(f, "duplicate module: {module}"),
            Self::DuplicateArtifact { artifact } => write!(f, "duplicate artifact: {artifact}"),
            Self::DuplicateVersion { version } => write!(f, "duplicate version: {version}"),
            Self::DuplicateBaseline { baseline } => write!(f, "duplicate baseline: {baseline}"),
            Self::DuplicateDelivery { delivery } => write!(f, "duplicate delivery: {delivery}"),
            Self::ModuleNotInProject { module, project } => {
                write!(f, "module {module} does not belong to project {project}")
            }
            Self::ArtifactNotInProject { artifact, project } => {
                write!(
                    f,
                    "artifact {artifact} does not belong to project {project}"
                )
            }
            Self::CrossProjectDependency { from, to } => {
                write!(f, "dependency across different projects: {from} → {to}")
            }
            Self::DuplicateSource { source } => {
                write!(f, "duplicate source in the version: {source}")
            }
            Self::DependencyCycle { cycle } => {
                let path = cycle
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(" → ");
                write!(f, "the dependency would create a cycle: {path}")
            }
            Self::NonConsecutiveVersions { artifact } => {
                write!(f, "the versions of {artifact} are not consecutive from 1")
            }
            Self::StaleVersion { expected, actual } => {
                write!(
                    f,
                    "the current version changed: expected {}, current {}",
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
                write!(f, "version {version} is not current (stale sources: {sources}); create a reviewed version")
            }
            Self::VersionNotCurrent { version, current } => {
                write!(
                    f,
                    "version {version} is not the current one (current: {current})"
                )
            }
            Self::VersionNotApproved { version } => {
                write!(f, "version {version} has no approval")
            }
            Self::DuplicateApproval { version, human } => {
                write!(f, "{human} already approved version {version}")
            }
            Self::ApproverMustBeHuman { approver } => {
                write!(f, "only a person can approve; {approver} is an AI proposal")
            }
            Self::EmptyBaseline => write!(f, "a baseline needs at least one artifact"),
            Self::BaselineDuplicateArtifact { artifact } => {
                write!(f, "duplicate artifact in the baseline: {artifact}")
            }
            Self::BaselineMismatch { artifact, version } => {
                write!(
                    f,
                    "version {version} does not belong to artifact {artifact}"
                )
            }
            Self::BaselineMissingSource { version, source } => {
                write!(f, "the baseline lacks source {source} needed for {version}")
            }
            Self::EmptyDelivery => write!(f, "a delivery needs at least one artifact"),
            Self::DeliveryDuplicateArtifact { artifact } => {
                write!(f, "duplicate artifact in the delivery: {artifact}")
            }
            Self::DeliveryMismatch { artifact, version } => {
                write!(
                    f,
                    "version {version} does not belong to artifact {artifact}"
                )
            }
            Self::ArchivedModule { module } => {
                write!(
                    f,
                    "module {module} is archived: restore it to operate with it"
                )
            }
            Self::ArchivedArtifact { artifact } => {
                write!(
                    f,
                    "artifact {artifact} is archived: restore it to operate with it"
                )
            }
            Self::ArchivedSource { version, source } => {
                write!(
                    f,
                    "version {version} depends on {source}, which is archived: \
                     restore the source or create a reviewed version without it"
                )
            }
            Self::DeleteHasApprovals { artifact } => {
                write!(
                    f,
                    "{artifact} has approvals and cannot be deleted: archive it"
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
                    "{artifact} cannot be deleted: {who} depend on it. Archive it"
                )
            }
            Self::DeleteInBaseline { artifact, baseline } => {
                write!(
                    f,
                    "{artifact} cannot be deleted: baseline {baseline} includes it. Archive it"
                )
            }
            Self::DeleteInDelivery { artifact, delivery } => {
                write!(
                    f,
                    "{artifact} cannot be deleted: delivery {delivery} includes it. Archive it"
                )
            }
            Self::DeleteModuleNotEmpty { module, artifacts } => {
                write!(
                    f,
                    "module {module} is not empty ({}): empty it first",
                    artifacts
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
            Self::DeleteProjectNotEmpty { project, modules } => {
                write!(
                    f,
                    "project {project} still holds {} module(s) ({}): delete them first, one by one",
                    modules.len(),
                    modules
                        .iter()
                        .map(ToString::to_string)
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
            Self::EmptyName => {
                write!(f, "the name cannot be empty")
            }
            Self::NameTooLong { chars } => {
                write!(
                    f,
                    "the name has {chars} chars; the maximum is {}",
                    Name::MAX_CHARS
                )
            }
            Self::StaleName { expected, actual } => {
                write!(
                    f,
                    "the name changed while you edited it (you expected {}, now it is {}): \
                     review it and save again",
                    display_name(expected.as_deref()),
                    display_name(actual.as_deref())
                )
            }
        }
    }
}

/// How to show an expected/actual name in messages (`None` = untitled).
fn display_name(name: Option<&str>) -> String {
    match name {
        Some(text) => format!("\"{text}\""),
        None => "\"untitled\"".to_string(),
    }
}

fn opt(id: &Option<VersionId>) -> String {
    id.as_ref()
        .map(ToString::to_string)
        .unwrap_or_else(|| "none".to_string())
}

impl std::error::Error for CoreError {}
