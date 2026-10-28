//! Aplicación: coordinación de casos de uso sobre un [`Store`] en memoria.
//!
//! Cada operación valida todo antes de mutar: un error deja el estado intacto.

mod store;

pub use store::{ArtifactReferences, Snapshot, Store};
