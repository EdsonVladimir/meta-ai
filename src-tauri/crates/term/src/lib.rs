//! Sesiones de terminal real sobre PTY (`portable-pty`).
//!
//! `TerminalManager` abre hasta [`MAX_SESSIONS`] shells interactivos, cada
//! uno en su PTY con un hilo lector dedicado (fuera del hilo de interfaz).
//! La salida viaja por [`EventSink`] en fragmentos acotados y ya
//! decodificados a UTF-8 (las secuencias multibyte partidas entre lecturas
//! se recomponen; lo inválido se sustituye, nunca se rompe el flujo).
//!
//! Reglas de seguridad (ver README):
//! - El hijo hereda el entorno del proceso **menos** la familia `META_*`
//!   (incluida `META_API_KEY`). Nada de lo que Ruth sepa de inferencia
//!   cruza a la terminal. Si el shell del usuario carga sus propias
//!   credenciales desde su configuración personal, Ruth no puede
//!   impedirlo y no afirma lo contrario.
//! - El shell se lanza como proceso con programa y argumentos separados;
//!   jamás se concatena entrada en comandos del sistema.
//! - Los identificadores (`term-N`, monótonos, sin reutilizar) los genera
//!   Rust; la interfaz no elige comandos ni programas.
//! - Los errores nunca incluyen variables de entorno ni contenido.
//!
//! El sumidero es un trait para no atar el gestor a Tauri: la app usa uno
//! que emite eventos y las pruebas uno que graba.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

/// Sesiones simultáneas iniciales.
pub const MAX_SESSIONS: usize = 3;
/// Lectura máxima por fragmento emitido (la decodificación UTF-8 puede
/// retener hasta 3 bytes de una secuencia partida).
pub const MAX_OUTPUT_CHUNK: usize = 8 * 1024;
/// Carga máxima aceptada en una escritura (pegados grandes van por partes).
pub const MAX_WRITE_BYTES: usize = 256 * 1024;
/// Dimensiones admitidas: columnas 2–512, filas 1–256.
pub const MIN_COLS: u16 = 2;
pub const MAX_COLS: u16 = 512;
pub const MIN_ROWS: u16 = 1;
pub const MAX_ROWS: u16 = 256;

/// Prefijo de entorno que nunca cruza al hijo (cubre `META_API_KEY`).
pub const SCRUB_PREFIX: &str = "META_";

/// Destino de la salida y los avisos de fin. Todo corre en hilos lectores,
/// nunca en el hilo de interfaz.
pub trait EventSink: Send + Sync {
    fn output(&self, id: &str, data: &str);
    fn exited(&self, id: &str, code: Option<i32>);
}

/// Cómo lanzar el shell: programa y argumentos separados.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
}

impl ShellSpec {
    pub fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.to_string(),
            args: args.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// Texto para mostrar en la interfaz (`/bin/bash`, `sh -i`, …).
    pub fn display(&self) -> String {
        if self.args.is_empty() {
            self.program.clone()
        } else {
            format!("{} {}", self.program, self.args.join(" "))
        }
    }
}

/// Shell predeterminado: `$SHELL` (programa y argumentos separados por
/// espacios, sin interpretación) o `/bin/sh`; en Windows PowerShell.
pub fn resolve_shell() -> ShellSpec {
    #[cfg(unix)]
    {
        if let Ok(from_env) = std::env::var("SHELL") {
            let mut parts = from_env.split_whitespace();
            if let Some(program) = parts.next() {
                return ShellSpec {
                    program: program.to_string(),
                    args: parts.map(str::to_string).collect(),
                };
            }
        }
        ShellSpec::new("/bin/sh", &[])
    }
    #[cfg(windows)]
    {
        ShellSpec::new("powershell.exe", &[])
    }
}

/// Quita del entorno hijo la familia `META_*` (incluida `META_API_KEY`).
/// Pura y probada: el resto del entorno se conserva intacto para que el
/// shell del usuario funcione igual que fuera de Ruth.
pub fn scrub_env(vars: &mut Vec<(String, String)>) {
    vars.retain(|(key, _)| !key.starts_with(SCRUB_PREFIX));
}

/// Entorno para el hijo: el del proceso, depurado. Nunca se registra.
pub fn child_env() -> Vec<(String, String)> {
    let mut vars: Vec<(String, String)> = std::env::vars().collect();
    scrub_env(&mut vars);
    vars
}

/// Carpeta inicial cuando la persona no elige ninguna: su `$HOME`
/// (`%USERPROFILE%` en Windows) o el directorio actual como repliegue.
pub fn default_cwd() -> PathBuf {
    #[cfg(unix)]
    let home = std::env::var("HOME").ok().map(PathBuf::from);
    #[cfg(windows)]
    let home = std::env::var("USERPROFILE").ok().map(PathBuf::from);
    #[cfg(not(any(unix, windows)))]
    let home: Option<PathBuf> = None;
    home.filter(|dir| dir.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Decodifica `chunk` sumándolo a lo pendiente y devuelve el texto listo,
/// reteniendo en `pending` como máximo una secuencia incompleta (< 4
/// bytes). Lo inválido se sustituye por `�`; el flujo nunca se corta.
pub fn decode_incremental(pending: &mut Vec<u8>, chunk: &[u8]) -> String {
    pending.extend_from_slice(chunk);
    let mut text = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(valid) => {
                text.push_str(valid);
                pending.clear();
                return text;
            }
            Err(err) => {
                let up_to = err.valid_up_to();
                // SAFETY: `valid_up_to` delimita UTF-8 válido.
                text.push_str(unsafe { std::str::from_utf8_unchecked(&pending[..up_to]) });
                match err.error_len() {
                    Some(len) => {
                        text.push('�');
                        pending.drain(..up_to + len);
                    }
                    None => {
                        pending.drain(..up_to);
                        return text;
                    }
                }
            }
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TermErrorKind {
    TooManySessions,
    UnknownSession,
    SessionExited,
    SpawnFailed,
    BadSize,
    BadDirectory,
    PayloadTooLarge,
    Io,
}

/// Error estable: `kind` para la interfaz, mensaje en español sin secretos.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermError {
    pub kind: TermErrorKind,
    pub message: String,
}

impl TermError {
    fn new(kind: TermErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            TermErrorKind::TooManySessions => "too_many_sessions",
            TermErrorKind::UnknownSession => "unknown_session",
            TermErrorKind::SessionExited => "session_exited",
            TermErrorKind::SpawnFailed => "spawn_failed",
            TermErrorKind::BadSize => "bad_size",
            TermErrorKind::BadDirectory => "bad_directory",
            TermErrorKind::PayloadTooLarge => "payload_too_large",
            TermErrorKind::Io => "io_error",
        }
    }
}

impl std::fmt::Display for TermError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for TermError {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionStatus {
    Running,
    Exited { code: Option<i32> },
}

/// Ficha pública de una sesión: carpeta, shell y estado.
#[derive(Clone, Debug, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub shell: String,
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    pub running: bool,
    pub exit_code: Option<i32>,
}

struct Session {
    seq: u64,
    shell_display: String,
    cwd: String,
    cols: u16,
    rows: u16,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    status: Arc<Mutex<SessionStatus>>,
    reader: Option<JoinHandle<()>>,
}

impl Session {
    fn info(&self, id: &str) -> SessionInfo {
        let (running, exit_code) = match *self.status.lock().unwrap_or_else(|p| p.into_inner()) {
            SessionStatus::Running => (true, None),
            SessionStatus::Exited { code } => (false, code),
        };
        SessionInfo {
            id: id.to_string(),
            shell: self.shell_display.clone(),
            cwd: self.cwd.clone(),
            cols: self.cols,
            rows: self.rows,
            running,
            exit_code,
        }
    }
}

pub struct TerminalManager {
    sink: Arc<dyn EventSink>,
    next_seq: u64,
    sessions: HashMap<String, Session>,
}

impl TerminalManager {
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self {
            sink,
            next_seq: 1,
            sessions: HashMap::new(),
        }
    }

    /// Abre una sesión con el shell predeterminado y el entorno depurado.
    /// Es la única vía que expone Tauri: la interfaz no elige programas.
    pub fn create(
        &mut self,
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, TermError> {
        let shell = resolve_shell();
        let env = child_env();
        self.create_with(&shell, &env, cwd, cols, rows)
    }

    /// Vía interna (y de pruebas) con shell y entorno explícitos.
    pub fn create_with(
        &mut self,
        shell: &ShellSpec,
        env: &[(String, String)],
        cwd: Option<PathBuf>,
        cols: u16,
        rows: u16,
    ) -> Result<SessionInfo, TermError> {
        if self.sessions.len() >= MAX_SESSIONS {
            return Err(TermError::new(
                TermErrorKind::TooManySessions,
                format!(
                    "Ya hay {MAX_SESSIONS} terminales abiertas. Cierra una antes de abrir otra."
                ),
            ));
        }
        if !(MIN_COLS..=MAX_COLS).contains(&cols) || !(MIN_ROWS..=MAX_ROWS).contains(&rows) {
            return Err(TermError::new(
                TermErrorKind::BadSize,
                format!(
                    "Tamaño inválido ({cols}×{rows}): columnas {MIN_COLS}–{MAX_COLS}, filas {MIN_ROWS}–{MAX_ROWS}."
                ),
            ));
        }
        let base = cwd.unwrap_or_else(default_cwd);
        let canonical = base.canonicalize().map_err(|_| {
            TermError::new(
                TermErrorKind::BadDirectory,
                format!("La carpeta {} no existe o no es accesible.", base.display()),
            )
        })?;
        if !canonical.is_dir() {
            return Err(TermError::new(
                TermErrorKind::BadDirectory,
                format!("La ruta {} no es una carpeta.", canonical.display()),
            ));
        }

        let id = format!("term-{}", self.next_seq);
        let seq = self.next_seq;
        self.next_seq += 1;

        let pty_system = native_pty_system();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size).map_err(|err| {
            TermError::new(
                TermErrorKind::SpawnFailed,
                format!("No se pudo abrir la terminal: {err}."),
            )
        })?;
        let mut cmd = CommandBuilder::new(&shell.program);
        cmd.args(shell.args.iter().map(String::as_str));
        cmd.cwd(&canonical);
        cmd.env_clear();
        for (key, value) in env {
            cmd.env(key, value);
        }
        let child = pair.slave.spawn_command(cmd).map_err(|err| {
            TermError::new(
                TermErrorKind::SpawnFailed,
                format!("No se pudo iniciar {}: {err}.", shell.program),
            )
        })?;
        drop(pair.slave);
        let reader = pair.master.try_clone_reader().map_err(|err| {
            TermError::new(
                TermErrorKind::SpawnFailed,
                format!("No se pudo leer la terminal: {err}."),
            )
        })?;

        let writer = pair.master.take_writer().map_err(|err| {
            TermError::new(
                TermErrorKind::SpawnFailed,
                format!("No se pudo escribir en la terminal: {err}."),
            )
        })?;
        let master = Arc::new(Mutex::new(pair.master));
        let writer = Arc::new(Mutex::new(writer));
        let child = Arc::new(Mutex::new(child));
        let status = Arc::new(Mutex::new(SessionStatus::Running));
        let handle = spawn_reader(
            id.clone(),
            reader,
            Arc::clone(&child),
            Arc::clone(&status),
            Arc::clone(&self.sink),
        );
        let session = Session {
            seq,
            shell_display: shell.display(),
            cwd: canonical.to_string_lossy().to_string(),
            cols,
            rows,
            master,
            writer,
            child,
            status,
            reader: Some(handle),
        };
        let info = session.info(&id);
        self.sessions.insert(id, session);
        Ok(info)
    }

    fn get(&self, id: &str) -> Result<&Session, TermError> {
        self.sessions.get(id).ok_or_else(|| {
            TermError::new(
                TermErrorKind::UnknownSession,
                format!("La sesión {id} no existe (quizá ya se cerró)."),
            )
        })
    }

    /// Ficha de una sesión (carpeta, shell, tamaño, estado).
    pub fn describe(&self, id: &str) -> Result<SessionInfo, TermError> {
        Ok(self.get(id)?.info(id))
    }

    /// Sesiones por orden de creación.
    pub fn list(&self) -> Vec<SessionInfo> {
        let mut entries: Vec<(&String, &Session)> = self.sessions.iter().collect();
        entries.sort_by_key(|(_, session)| session.seq);
        entries
            .iter()
            .map(|(id, session)| session.info(id))
            .collect()
    }

    pub fn running_count(&self) -> usize {
        self.sessions
            .values()
            .filter(|session| {
                matches!(
                    *session.status.lock().unwrap_or_else(|p| p.into_inner()),
                    SessionStatus::Running
                )
            })
            .count()
    }

    fn check_running(session: &Session, id: &str) -> Result<(), TermError> {
        match *session.status.lock().unwrap_or_else(|p| p.into_inner()) {
            SessionStatus::Running => Ok(()),
            SessionStatus::Exited { code } => Err(TermError::new(
                TermErrorKind::SessionExited,
                match code {
                    Some(code) => format!("La sesión {id} ya terminó (código {code})."),
                    None => format!("La sesión {id} ya terminó."),
                },
            )),
        }
    }

    /// Escribe teclas en la sesión (Ctrl+C, flechas y escapes viajan tal
    /// cual: los interpreta el programa del PTY, no Ruth).
    pub fn write(&self, id: &str, data: &str) -> Result<(), TermError> {
        let session = self.get(id)?;
        Self::check_running(session, id)?;
        if data.len() > MAX_WRITE_BYTES {
            return Err(TermError::new(
                TermErrorKind::PayloadTooLarge,
                format!(
                    "Carga demasiado grande ({} bytes, máximo {} KiB). Pégala por partes.",
                    data.len(),
                    MAX_WRITE_BYTES / 1024
                ),
            ));
        }
        let mut writer = session.writer.lock().unwrap_or_else(|p| p.into_inner());
        writer.write_all(data.as_bytes()).map_err(|err| {
            TermError::new(
                TermErrorKind::Io,
                format!("No se pudo escribir en la sesión {id}: {err}."),
            )
        })
    }

    /// Redimensiona el PTY (filas/columnas); el programa recibe `SIGWINCH`.
    pub fn resize(&mut self, id: &str, cols: u16, rows: u16) -> Result<SessionInfo, TermError> {
        if !(MIN_COLS..=MAX_COLS).contains(&cols) || !(MIN_ROWS..=MAX_ROWS).contains(&rows) {
            return Err(TermError::new(
                TermErrorKind::BadSize,
                format!(
                    "Tamaño inválido ({cols}×{rows}): columnas {MIN_COLS}–{MAX_COLS}, filas {MIN_ROWS}–{MAX_ROWS}."
                ),
            ));
        }
        let session = self.get(id)?;
        Self::check_running(session, id)?;
        {
            let master = session.master.lock().unwrap_or_else(|p| p.into_inner());
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|err| {
                    TermError::new(
                        TermErrorKind::Io,
                        format!("No se pudo redimensionar la sesión {id}: {err}."),
                    )
                })?;
        }
        let session = self.sessions.get_mut(id).expect("sesión comprobada");
        session.cols = cols;
        session.rows = rows;
        Ok(session.info(id))
    }

    /// Cierra la sesión: mata al hijo, espera su fin, recoge el hilo lector
    /// y suelta el PTY. No deja huérfanos por el camino feliz.
    pub fn close(&mut self, id: &str) -> Result<(), TermError> {
        let mut session = self.sessions.remove(id).ok_or_else(|| {
            TermError::new(
                TermErrorKind::UnknownSession,
                format!("La sesión {id} no existe (quizá ya se cerró)."),
            )
        })?;
        kill_and_reap(&session.child);
        if let Some(handle) = session.reader.take() {
            let _ = handle.join();
        }
        Ok(())
    }

    /// Cierra todo (salida de la app): mata a cada hijo antes de soltar.
    pub fn shutdown(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            let _ = self.close(&id);
        }
    }
}

/// Mata al hijo y espera su fin (hasta ~1 s); lo mejor posible según la
/// plataforma, sin bloquear eternamente.
fn kill_and_reap(child: &Arc<Mutex<Box<dyn Child + Send + Sync>>>) {
    let mut guard = child.lock().unwrap_or_else(|p| p.into_inner());
    let _ = guard.kill();
    for _ in 0..100 {
        match guard.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return,
        }
    }
}

/// Hilo lector: lee hasta EOF, emite fragmentos decodificados y al final
/// espera al hijo, marca el estado y emite el aviso de fin.
fn spawn_reader(
    id: String,
    mut reader: Box<dyn Read + Send>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    status: Arc<Mutex<SessionStatus>>,
    sink: Arc<dyn EventSink>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!("ruth-term-{id}"))
        .spawn(move || {
            let mut pending: Vec<u8> = Vec::new();
            let mut buf = [0u8; MAX_OUTPUT_CHUNK];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = decode_incremental(&mut pending, &buf[..n]);
                        if !text.is_empty() {
                            sink.output(&id, &text);
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                    Err(_) => break,
                }
            }
            if !pending.is_empty() {
                sink.output(&id, &String::from_utf8_lossy(&pending));
            }
            let code = child
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .wait()
                .ok()
                .map(|exit| exit.exit_code() as i32);
            *status.lock().unwrap_or_else(|p| p.into_inner()) = SessionStatus::Exited { code };
            sink.exited(&id, code);
        })
        .expect("no se pudo lanzar el hilo lector de la terminal")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_quita_meta_y_conserva_el_resto() {
        let mut vars = vec![
            ("META_API_KEY".to_string(), "secreta".to_string()),
            ("META_FOO".to_string(), "x".to_string()),
            ("PATH".to_string(), "/bin".to_string()),
            ("HOME".to_string(), "/home/u".to_string()),
        ];
        scrub_env(&mut vars);
        assert_eq!(
            vars,
            vec![
                ("PATH".to_string(), "/bin".to_string()),
                ("HOME".to_string(), "/home/u".to_string()),
            ]
        );
    }

    #[test]
    fn decode_recompone_multibyte_partido() {
        let mut pending = Vec::new();
        let emoji = "áé".as_bytes();
        let first = decode_incremental(&mut pending, &emoji[..1]);
        assert_eq!(first, "");
        assert!(!pending.is_empty());
        let rest = decode_incremental(&mut pending, &emoji[1..]);
        assert_eq!(rest, "áé");
        assert!(pending.is_empty());
    }

    #[test]
    fn decode_sustituye_lo_invalido_sin_cortar() {
        let mut pending = Vec::new();
        let text = decode_incremental(&mut pending, b"ok\xff\xfemal");
        assert_eq!(text, "ok��mal");
        assert!(pending.is_empty());
    }
}
