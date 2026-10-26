//! Ruth IDE: comandos Tauri del hito 1.
//!
//! Dos comandos y nada más:
//! - `meta_status`: lectura local del entorno (¿hay clave? ¿qué modelo?).
//!   No hace red y puede llamarse al mostrar la interfaz.
//! - `test_meta_connection`: la única llamada real a Meta. Requiere gesto
//!   explícito del botón, permite una sola prueba simultánea y no reintenta.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::State;

/// Candado gestionado por Tauri para permitir una sola prueba simultánea.
#[derive(Default)]
struct TestLock {
    busy: AtomicBool,
}

/// Estado local serializable. La clave nunca sale del proceso nativo.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct MetaStatus {
    configured: bool,
    model: String,
}

#[tauri::command]
fn meta_status() -> MetaStatus {
    MetaStatus {
        configured: ruth_meta::api_key_present(),
        model: ruth_meta::resolve_model(),
    }
}

#[tauri::command]
async fn test_meta_connection(
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TestLock::default())
        .invoke_handler(tauri::generate_handler![meta_status, test_meta_connection])
        .run(tauri::generate_context!())
        .expect("error while running Ruth IDE");
}
