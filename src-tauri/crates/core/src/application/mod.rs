//! Application: use-case coordination over an in-memory [`Store`].
//!
//! Each operation validates everything before mutating: an error leaves state intact.

mod store;

pub use store::{ArtifactReferences, Snapshot, Store};
