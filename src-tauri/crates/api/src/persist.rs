//! Validated + persisted atomic mutations.
//!
//! Each mutation validates with the core over a copy, saves the copy in
//! a SQLite transaction and only then publishes it in memory. If
//! validation or saving fail, memory and disk keep the previous
//! version and the error tells what happened.

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
