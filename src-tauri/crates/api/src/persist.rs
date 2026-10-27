//! Mutaciones atómicas validadas + persistidas.
//!
//! Cada mutación valida con el núcleo sobre una copia, guarda la copia en
//! una transacción SQLite y solo entonces la publica en memoria. Si la
//! validación o el guardado fallan, memoria y disco conservan la versión
//! anterior y el error indica qué pasó.

use ruth_core::application::Store;
use ruth_store::DbActor;

use crate::error::ApiError;
use crate::ids::IdGen;

pub fn transact<T>(
    store: &mut Store,
    ids: &mut IdGen,
    db: &DbActor,
    op: impl FnOnce(&mut Store, &mut IdGen) -> Result<T, ApiError>,
) -> Result<T, ApiError> {
    let mut draft = store.clone();
    let mut ids_draft = ids.clone();
    let out = op(&mut draft, &mut ids_draft)?;
    db.save(&draft, ids_draft.checkpoint())
        .map_err(ApiError::storage)?;
    *store = draft;
    *ids = ids_draft;
    Ok(out)
}
