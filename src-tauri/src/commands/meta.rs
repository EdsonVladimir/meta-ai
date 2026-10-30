//! Meta Tauri commands (milestone 1, unchanged).
//!
//! - `meta_status`: local environment read (key present? which model?).
//!   No network; may be called when showing the UI.
//! - `test_meta_connection`: the only real Meta call. Requires an
//!   explicit button gesture, allows a single simultaneous test and never retries.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

/// Tauri-managed lock allowing a single simultaneous test.
#[derive(Default)]
pub struct TestLock {
    busy: AtomicBool,
}

/// Serializable local state. The key never leaves the native process.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MetaStatus {
    configured: bool,
    model: String,
}

#[tauri::command]
pub fn meta_status() -> MetaStatus {
    MetaStatus {
        configured: ruth_meta::api_key_present(),
        model: ruth_meta::resolve_model(),
    }
}

#[tauri::command]
pub async fn test_meta_connection(
    lock: State<'_, TestLock>,
) -> Result<ruth_meta::ConnectionSuccess, ruth_meta::MetaError> {
    if lock
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err(ruth_meta::MetaError::busy());
    }
    let _guard = LockGuard { lock: &lock };

    let config = ruth_meta::MetaConfig::from_env()?;
    ruth_meta::test_connection(&config).await
}

struct LockGuard<'a> {
    lock: &'a TestLock,
}

impl Drop for LockGuard<'_> {
    fn drop(&mut self) {
        self.lock.busy.store(false, Ordering::SeqCst);
    }
}
