//! Dominio: tipos, invariantes y operaciones puras.
//!
//! Sin E/S ni estado global. Todo lo que necesita (identificadores, contenido,
//! fechas) llega como parámetro.

mod analysis;
mod error;
mod ids;
mod model;

pub use analysis::{
    compute_impact, dependency_cycle, duplicate_source, find_cycle, stale_sources,
    version_is_valid, ImpactReport, ImpactedArtifact, Validity, VersionView,
};
pub use error::CoreError;
pub use ids::{
    AgentId, ArtifactId, BaselineId, DeliveryId, HumanId, ModuleId, ProjectId, VersionId,
};
pub use model::{
    Approval, Artifact, ArtifactType, Author, Baseline, Content, Date, Module, Name, Project,
    Provenance, TitleChange, Version, WorkDelivery,
};
