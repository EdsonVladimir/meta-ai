//! Comandos organizados por funcionalidad.
//!
//! Los comandos del núcleo comparten el acceso al estado: un bloqueo corto,
//! comprobación de disponibilidad y llamada a `ruth-api`. Los comandos de
//! Meta no tocan este estado; el de generación lo suelta durante la red.

pub mod archive;
pub mod baseline;
pub mod delivery;
pub mod design;
pub mod impact;
pub mod meta;
pub mod mockup;
pub mod proposals;
pub mod rename;
pub mod requirements;
pub mod terminal;

use std::collections::HashSet;
use std::sync::{Mutex, MutexGuard};

use ruth_api::ApiError;

use crate::state::AppStateInner;

/// Vista mutable del estado listo: dominio, ids, base, registros de
/// generaciones y disposiciones visuales. Vive solo dentro del bloqueo que
/// la entrega.
pub(crate) struct Ready<'a> {
    pub store: &'a mut ruth_core::application::Store,
    pub ids: &'a mut ruth_api::IdGen,
    pub db: &'a ruth_store::DbActor,
    pub log: &'a mut ruth_store::ProposalLog,
    pub designs: &'a mut ruth_store::DesignLog,
    pub baseline_meta: &'a mut ruth_store::BaselineMetaLog,
    pub layouts: &'a mut ruth_store::LayoutLog,
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
        }),
        AppStateInner::Unavailable { message } => Err(ApiError::storage_message(message.clone())),
    }
}

fn lock_failed(what: &str) -> ApiError {
    ApiError::internal(format!("{what} bloqueado"))
}

pub(crate) fn lock(
    mutex: &Mutex<AppStateInner>,
) -> Result<MutexGuard<'_, AppStateInner>, ApiError> {
    mutex.lock().map_err(|_| lock_failed("estado del núcleo"))
}

/// Marca un módulo con generación en curso. Compartida por requisitos y
/// diseño: una sola generación simultánea por módulo, sea del tipo que sea.
pub(crate) fn mark_inflight(set: &Mutex<HashSet<String>>, module: &str) -> Result<(), ApiError> {
    let mut flying = set
        .lock()
        .map_err(|_| ApiError::internal("generaciones en curso bloqueado"))?;
    if !flying.insert(module.to_string()) {
        return Err(ApiError::coded(
            "generation_busy",
            "Ya hay una generación en curso para este módulo. Espera a que termine.",
        ));
    }
    Ok(())
}

/// Libera la marca al terminar, por cualquier camino (éxito, error o
/// cancelación): el `Drop` corre aunque la red falle.
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
