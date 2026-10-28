//! Estado gestionado por Tauri: el `Store` del núcleo en memoria, el
//! generador de identificadores, el actor SQLite y el registro de
//! generaciones asistidas.
//!
//! Un único `Mutex` serializa los comandos en proceso; el actor serializa el
//! SQL en su hilo; SQLite serializa en disco. Los bloqueos se toman y sueltan
//! dentro de cada comando; nunca se mantienen durante llamadas de red: el
//! comando de generación fotografía el contexto, suelta todo, hace red y
//! registra después.
//!
//! Si la base no pudo abrirse al arrancar, el estado queda como no
//! disponible con un mensaje recuperable: la aplicación abre igual y la
//! interfaz lo muestra sin borrar ni reemplazar nada.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;

use ruth_api::IdGen;
use ruth_core::application::Store;
use ruth_store::{BaselineMetaLog, DbActor, DesignLog, LayoutLog, ProposalLog};

pub struct AppState {
    pub db_path: PathBuf,
    pub inner: Mutex<AppStateInner>,
    /// Módulos con una generación en curso (una simultánea por módulo).
    /// Candado separado y de vida corta: solo marca y desmarca.
    pub inflight: Mutex<HashSet<String>>,
}

/// Contenido del estado listo. Vive en un `Box` dentro del enum para no
/// mover cientos de bytes cada vez que se inspecciona el estado.
pub struct ReadyState {
    pub store: Store,
    pub ids: IdGen,
    pub db: DbActor,
    pub proposals: ProposalLog,
    pub designs: DesignLog,
    pub baseline_meta: BaselineMetaLog,
    pub layouts: LayoutLog,
}

pub enum AppStateInner {
    Ready(Box<ReadyState>),
    Unavailable { message: String },
}

impl AppState {
    pub fn ready(
        db_path: PathBuf,
        store: Store,
        ids: IdGen,
        db: DbActor,
        proposals: ProposalLog,
        designs: DesignLog,
        baseline_meta: BaselineMetaLog,
        layouts: LayoutLog,
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
