//! SQLite adapter for the core: reliable local persistence.
//!
//! # Minimal contract
//!
//! - The persistence unit is the complete `Store` snapshot plus the
//!   identifier counter. Each mutation validates with the core over a
//!   copy, saves the copy in a transaction and only then publishes it
//!   in memory. On failure, memory and disk keep the previous version
//!   and success is never reported before the save commits.
//! - Identities, numbers, sources, approvals and dates are preserved
//!   verbatim: never regenerated on load or save.
//! - Loading rebuilds with `Store::reconstitute`, which revalidates
//!   the invariants. Invalid data, corruption or a future schema
//!   reject without writing anything.
//! - Reads use memory (equal to the last confirmed commit).
//! - Only domain state lives here. No API keys, drafts, UI selections
//!   or credentials are stored.
//!
//! Assisted generations (milestone 5) share the same version-2 tables
//! with their own operations: register, accept (domain + state in a
//! single transaction) and discard. `save` does not touch them.
//!
//! # Cost and limits
//!
//! Each mutation rewrites the whole database: O(size) cost per save.
//! It is deliberate (simplicity and obvious atomicity) and plenty for
//! hundreds of versions; on growth, the next step is incremental
//! per-entity writing without changing the contract.
//!
//! # Concurrency
//!
//! - A single SQLite connection lives on a dedicated thread ([`DbActor`],
//!   `Send` behind a `Mutex`); every SQL access goes through it, off the UI thread.
//! - In process, a `Mutex` serializes commands; on disk, `IMMEDIATE`
//!   transactions with `busy_timeout=0` fail fast under contention.
//! - Second instance: the actor takes a persistent `EXCLUSIVE` lock on
//!   open. Another process attempting to open fails with
//!   [`StoreError::Locked`] and a clear message. Two instances at once
//!   are not supported.

mod actor;
pub mod baseline_meta;
pub mod code_links;
pub mod code_roots;
pub mod codegen;
pub mod design;
mod error;
pub mod layout;
pub mod mockups;
mod persist;
pub mod proposals;
pub mod recents;
mod schema;
pub mod snapshots;

pub use actor::{DbActor, Loaded};
pub use baseline_meta::{
    BaselineMeta, BaselineMetaLog, MAX_BASELINE_DESCRIPTION_CHARS, MAX_BASELINE_NAME_CHARS,
};
pub use code_links::{CodeLinkLog, LinkKind, LinkScope, StoredCodeLink, SymbolRef};
pub use code_roots::CodeRootLog;
pub use codegen::{
    CodeFileState, CodeGenLog, CodeScopeEntry, ScreenSourceRef, StoredCodeGeneration,
    StoredProposalFile,
};
pub use design::{DesignLog, StoredDesignGeneration, StoredDesignProposal};
pub use error::StoreError;
pub use layout::LayoutLog;
pub use mockups::{MockupLog, StoredMockupGeneration, StoredMockupProposal};
pub use proposals::{ProposalLog, ProposalState, StoredGeneration, StoredProposal};
pub use recents::{RecentLog, StoredRecent, MAX_RECENT_WORKSPACES};
pub use schema::SCHEMA_VERSION;
pub use snapshots::{
    SnapshotFile, SnapshotLog, StoredSnapshot, MAX_RESULT_BYTES, MAX_SNAPSHOT_FILES,
    MAX_SNAPSHOT_NAME_CHARS,
};
