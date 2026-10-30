//! Integrated terminal commands: thin wrappers over `ruth-term`.
//!
//! The UI asks to create/write/resize/close sessions; output
//! and exit notices travel by events (`ruth-terminal-output`,
//! `ruth-terminal-exit`), never by polling. The commands execute nothing
//! by themselves: they only talk to an existing session's PTY.
//!
//! When closing the window with running sessions, `lib.rs` holds the
//! close and emits `ruth-terminal-close-requested`; the person confirms and
//! then `term_quit_app` kills the sessions and exits (no orphans on the
//! happy path). Nothing terminal-related persists: neither content nor credentials.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ruth_api::ApiError;
use ruth_term::{EventSink, SessionInfo, TerminalManager};
use tauri::{AppHandle, Emitter, State};

/// Managed state: the session manager with its event sink.
/// Separate lock from the core: the terminal never touches the domain.
pub struct TerminalState {
    inner: Mutex<TerminalManager>,
}

impl TerminalState {
    pub fn new(app: &AppHandle) -> Self {
        let sink: Arc<dyn EventSink> = Arc::new(TauriSink { app: app.clone() });
        Self {
            inner: Mutex::new(TerminalManager::new(sink)),
        }
    }

    pub fn running_count(&self) -> usize {
        self.inner
            .lock()
            .map(|manager| manager.running_count())
            .unwrap_or(0)
    }
}

fn lock<'a>(
    state: &'a State<'a, TerminalState>,
) -> Result<std::sync::MutexGuard<'a, TerminalManager>, ApiError> {
    state
        .inner
        .lock()
        .map_err(|_| ApiError::internal("terminals locked"))
}

fn term_err(err: ruth_term::TermError) -> ApiError {
    ApiError::coded(err.kind_str(), err.message)
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputPayload {
    id: String,
    data: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitPayload {
    id: String,
    code: Option<i32>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloseRequestedPayload {
    pub running: usize,
}

struct TauriSink {
    app: AppHandle,
}

impl EventSink for TauriSink {
    fn output(&self, id: &str, data: &str) {
        let _ = self.app.emit(
            "ruth-terminal-output",
            OutputPayload {
                id: id.to_string(),
                data: data.to_string(),
            },
        );
    }

    fn exited(&self, id: &str, code: Option<i32>) {
        let _ = self.app.emit(
            "ruth-terminal-exit",
            ExitPayload {
                id: id.to_string(),
                code,
            },
        );
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalInput {
    /// Starting folder chosen by the person (native dialog) or null for
    /// their home folder. Shown as is; never changes on its own.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIdInput {
    pub id: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteTerminalInput {
    pub id: String,
    pub data: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeTerminalInput {
    pub id: String,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn term_list(state: State<TerminalState>) -> Result<Vec<SessionInfo>, ApiError> {
    Ok(lock(&state)?.list())
}

#[tauri::command]
pub fn term_create(
    state: State<TerminalState>,
    input: CreateTerminalInput,
) -> Result<SessionInfo, ApiError> {
    let cwd = input.cwd.map(PathBuf::from);
    lock(&state)?
        .create(cwd, input.cols, input.rows)
        .map_err(term_err)
}

#[tauri::command]
pub fn term_write(state: State<TerminalState>, input: WriteTerminalInput) -> Result<(), ApiError> {
    lock(&state)?
        .write(&input.id, &input.data)
        .map_err(term_err)
}

#[tauri::command]
pub fn term_resize(
    state: State<TerminalState>,
    input: ResizeTerminalInput,
) -> Result<SessionInfo, ApiError> {
    lock(&state)?
        .resize(&input.id, input.cols, input.rows)
        .map_err(term_err)
}

#[tauri::command]
pub fn term_close(state: State<TerminalState>, input: TerminalIdInput) -> Result<(), ApiError> {
    lock(&state)?.close(&input.id).map_err(term_err)
}

/// Confirmed exit with open terminals: kills all sessions and
/// ends the process. Only invoked from the confirmation dialog.
#[tauri::command]
pub fn term_quit_app(app: AppHandle, state: State<TerminalState>) -> Result<(), ApiError> {
    lock(&state)?.shutdown();
    app.exit(0);
    Ok(())
}
