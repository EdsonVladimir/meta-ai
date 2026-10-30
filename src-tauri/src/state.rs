//! Tauri-managed state: the in-memory core `Store`, the identifier
//! generator, the SQLite actor and the assisted-generation log.
//!
//! A single `Mutex` serializes in-process commands; the actor serializes
//! SQL on its thread; SQLite serializes on disk. Locks take and release
//! inside each command; they never hold during network calls: the
//! generation command snapshots the context, releases everything, does
//! network and records afterwards.
//!
//! When the database could not open at startup, the state stays
//! unavailable with a recoverable message: the app still opens and the
//! UI shows it without deleting or replacing anything.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use ruth_api::IdGen;
use ruth_core::application::Store;
use ruth_store::{
    BaselineMetaLog, CodeGenLog, CodeLinkLog, CodeRootLog, DbActor, DesignLog, LayoutLog,
    MockupLog, ProposalLog, RecentLog, SnapshotLog,
};

pub struct AppState {
    pub db_path: PathBuf,
    pub inner: Mutex<AppStateInner>,
    /// Modules with a generation in flight (one simultaneous per module).
    /// Separate, short-lived lock: only marks and unmarks.
    pub inflight: Mutex<HashSet<String>>,
}

/// Ready-state content. Lives in a `Box` inside the enum to avoid
/// moving hundreds of bytes on each state inspection.
pub struct ReadyState {
    pub store: Store,
    pub ids: IdGen,
    pub db: DbActor,
    pub proposals: ProposalLog,
    pub designs: DesignLog,
    pub baseline_meta: BaselineMetaLog,
    pub layouts: LayoutLog,
    pub mockups: MockupLog,
    pub code_roots: CodeRootLog,
    pub code_links: CodeLinkLog,
    pub snapshots: SnapshotLog,
    pub codegen: CodeGenLog,
    pub recents: RecentLog,
}

pub enum AppStateInner {
    Ready(Box<ReadyState>),
    Unavailable { message: String },
}

impl AppState {
    // Thirteen initial state pieces: passed explicitly once at
    // startup (grouping them in another struct would add no safety).
    #[allow(clippy::too_many_arguments)]
    pub fn ready(
        db_path: PathBuf,
        store: Store,
        ids: IdGen,
        db: DbActor,
        proposals: ProposalLog,
        designs: DesignLog,
        baseline_meta: BaselineMetaLog,
        layouts: LayoutLog,
        mockups: MockupLog,
        code_roots: CodeRootLog,
        code_links: CodeLinkLog,
        snapshots: SnapshotLog,
        codegen: CodeGenLog,
        recents: RecentLog,
    ) -> Self {
        Self {
            db_path,
            inner: Mutex::new(AppStateInner::Ready(Box::new(ReadyState {
                store,
                ids,
                db,
                proposals,
                designs,
                baseline_meta,
                layouts,
                mockups,
                code_roots,
                code_links,
                snapshots,
                codegen,
                recents,
            }))),
            inflight: Mutex::new(HashSet::new()),
        }
    }

    pub fn unavailable(db_path: PathBuf, message: String) -> Self {
        Self {
            db_path,
            inner: Mutex::new(AppStateInner::Unavailable { message }),
            inflight: Mutex::new(HashSet::new()),
        }
    }
}
