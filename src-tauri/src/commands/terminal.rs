//! Comandos de terminal integrada: envoltorios finos sobre `ruth-term`.
//!
//! La interfaz pide crear/escribir/redimensionar/cerrar sesiones; la salida
//! y los avisos de fin viajan por eventos (`ruth-terminal-output`,
//! `ruth-terminal-exit`), nunca por polling. Los comandos no ejecutan nada
//! por sí mismos: solo hablan con el PTY de una sesión existente.
//!
//! Al cerrar la ventana con sesiones en marcha, `lib.rs` frena el cierre y
//! emite `ruth-terminal-close-requested`; la persona confirma y entonces
//! `term_quit_app` mata las sesiones y sale (sin huérfanos por el camino
//! feliz). Nada de terminal se persiste: ni contenido ni credenciales.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use ruth_api::ApiError;
use ruth_term::{EventSink, SessionInfo, TerminalManager};
use tauri::{AppHandle, Emitter, State};

/// Estado gestionado: el gestor de sesiones con su sumidero de eventos.
/// Candado separado del núcleo: la terminal no toca el dominio.
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
        .map_err(|_| ApiError::internal("terminales bloqueadas"))
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
    /// Carpeta inicial elegida por la persona (diálogo nativo) o null para
    /// su carpeta personal. Se muestra tal cual; nunca cambia sola.
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

/// Salida confirmada con terminales abiertas: mata todas las sesiones y
/// termina el proceso. Solo se invoca desde el diálogo de confirmación.
#[tauri::command]
pub fn term_quit_app(app: AppHandle, state: State<TerminalState>) -> Result<(), ApiError> {
    lock(&state)?.shutdown();
    app.exit(0);
    Ok(())
}
