//! Commands organized by feature.
//!
//! Core commands share state access: a short lock,
//! an availability check and a `ruth-api` call. Meta
//! commands never touch this state; the generation one releases it during network.

pub mod archive;
pub mod baseline;
pub mod code;
pub mod code_links;
pub mod codegen;
pub mod delivery;
pub mod design;
pub mod impact;
pub mod meta;
pub mod mockup;
pub mod proposals;
pub mod recent;
pub mod rename;
pub mod replicate;
pub mod requirements;
pub mod terminal;

use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};

use ruth_api::ApiError;

use crate::state::AppStateInner;

/// Mutable ready-state view: domain, ids, database, generation
/// and visual-layout logs. Lives only inside the lock that
/// delivers it.
pub(crate) struct Ready<'a> {
    pub store: &'a mut ruth_core::application::Store,
    pub ids: &'a mut ruth_api::IdGen,
    pub db: &'a ruth_store::DbActor,
    pub log: &'a mut ruth_store::ProposalLog,
    pub designs: &'a mut ruth_store::DesignLog,
    pub baseline_meta: &'a mut ruth_store::BaselineMetaLog,
    pub layouts: &'a mut ruth_store::LayoutLog,
    pub mockups: &'a mut ruth_store::MockupLog,
    pub code_roots: &'a mut ruth_store::CodeRootLog,
    pub code_links: &'a mut ruth_store::CodeLinkLog,
    pub snapshots: &'a mut ruth_store::SnapshotLog,
    pub codegen: &'a mut ruth_store::CodeGenLog,
    pub recents: &'a mut ruth_store::RecentLog,
}

pub(crate) fn ready<'a>(
    guard: &'a mut MutexGuard<'_, AppStateInner>,
) -> Result<Ready<'a>, ApiError> {
    match &mut **guard {
        AppStateInner::Ready(ready) => Ok(Ready {
            store: &mut ready.store,
            ids: &mut ready.ids,
            db: &ready.db,
            log: &mut ready.proposals,
            designs: &mut ready.designs,
            baseline_meta: &mut ready.baseline_meta,
            layouts: &mut ready.layouts,
            mockups: &mut ready.mockups,
            code_roots: &mut ready.code_roots,
            code_links: &mut ready.code_links,
            snapshots: &mut ready.snapshots,
            codegen: &mut ready.codegen,
            recents: &mut ready.recents,
        }),
        AppStateInner::Unavailable { message } => Err(ApiError::storage_message(message.clone())),
    }
}

fn lock_failed(what: &str) -> ApiError {
    ApiError::internal(format!("{what} locked"))
}

pub(crate) fn lock(
    mutex: &Mutex<AppStateInner>,
) -> Result<MutexGuard<'_, AppStateInner>, ApiError> {
    mutex.lock().map_err(|_| lock_failed("core state"))
}

/// Marks a module with a generation in flight. Shared by requirements
/// and design: a single simultaneous generation per module, of any kind.
pub(crate) fn mark_inflight(set: &Mutex<HashSet<String>>, module: &str) -> Result<(), ApiError> {
    let mut flying = set
        .lock()
        .map_err(|_| ApiError::internal("in-flight generations locked"))?;
    if !flying.insert(module.to_string()) {
        return Err(ApiError::coded(
            "generation_busy",
            "A generation is already running for this module. Wait for it to finish.",
        ));
    }
    Ok(())
}

/// Releases the mark on finish, by any path (success, error or
/// cancellation): `Drop` runs even when the network fails.
pub(crate) struct InflightGuard<'a> {
    set: &'a Mutex<HashSet<String>>,
    module: String,
}

impl<'a> InflightGuard<'a> {
    pub(crate) fn hold(set: &'a Mutex<HashSet<String>>, module: String) -> Self {
        Self { set, module }
    }
}

impl Drop for InflightGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut flying) = self.set.lock() {
            flying.remove(&self.module);
        }
    }
}
