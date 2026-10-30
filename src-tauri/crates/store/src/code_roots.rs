//! Code workspace roots: stable id, path, name, order and
//! associated project (`None` = loose folder).
//!
//! Total rewrite on each save (DELETE + INSERT in one transaction),
//! like the rest of the adapter. No FK: the folder may not exist on
//! reopen (marked missing, without deleting the row) and the associated
//! project is verified on load.

use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::path::Path;

use ruth_code::CodeRoot;
use ruth_core::application::Store;
use ruth_core::domain::ProjectId;

use crate::error::StoreError;

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodeRootLog {
    roots: Vec<CodeRoot>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

impl CodeRootLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn roots(&self) -> &[CodeRoot] {
        &self.roots
    }

    /// Rehydrates a validated root (load or publish after save).
    pub fn rehydrate(
        &mut self,
        id: String,
        path: String,
        name: String,
        project_id: Option<String>,
    ) {
        self.roots.push(CodeRoot {
            id,
            path,
            name,
            project_id,
        });
    }
}

pub(crate) fn save_code_roots(
    conn: &mut Connection,
    path: &Path,
    roots: &[CodeRoot],
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    write_code_roots(&tx, path, roots)?;
    // The counter also advances here (`root-N` IDs share it): if not
    // persisted, a restart would reuse identifiers.
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Total root rewrite inside an already open transaction.
/// Shared by `save_code_roots` and by atomic replication.
pub(crate) fn write_code_roots(
    tx: &Transaction,
    path: &Path,
    roots: &[CodeRoot],
) -> Result<(), StoreError> {
    tx.execute("DELETE FROM code_roots", [])
        .map_err(|e| StoreError::convert(path, e))?;
    for (pos, root) in roots.iter().enumerate() {
        tx.execute(
            "INSERT INTO code_roots(id, path, name, pos, project_id) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![root.id, root.path, root.name, pos as u32, root.project_id],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    Ok(())
}

pub(crate) fn load_code_roots(
    conn: &Connection,
    path: &Path,
    store: &Store,
    with_project: bool,
) -> Result<CodeRootLog, StoreError> {
    // Loading runs before migrating: on v11 the column does not exist yet
    // and all roots enter loose (the migration preserves that NULL).
    let mut stmt = conn
        .prepare(if with_project {
            "SELECT id, path, name, project_id FROM code_roots ORDER BY pos"
        } else {
            "SELECT id, path, name FROM code_roots ORDER BY pos"
        })
        .map_err(|e| StoreError::convert(path, e))?;
    let rows: Vec<(String, String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3).unwrap_or(None),
            ))
        })
        .map_err(|e| StoreError::convert(path, e))?
        .collect::<Result<_, _>>()
        .map_err(|e| StoreError::convert(path, e))?;
    let mut log = CodeRootLog::new();
    for (id, path_value, name, project_id) in rows {
        if id.trim().is_empty() || path_value.trim().is_empty() || name.trim().is_empty() {
            return Err(invalid("invalid code root"));
        }
        if let Some(pid) = project_id.as_deref() {
            let project = ProjectId::new(pid).map_err(|_| invalid("invalid project on root"))?;
            if store.project(&project).is_none() {
                return Err(invalid(format!("root {id} points to a missing project")));
            }
        }
        log.rehydrate(id, path_value, name, project_id);
    }
    Ok(log)
}
