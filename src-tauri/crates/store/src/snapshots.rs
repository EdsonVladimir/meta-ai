//! Structure-analysis snapshots saved in the project.
//!
//! Pure persistence data: each snapshot keeps the name, the date,
//! the analyzed files (root, path, FNV hash and bytes) and the
//! analyzer result (symbols, relations and limits) as is.
//!
//! DETECTED content, never proposed design: opening a snapshot creates
//! no requirements or dependencies. No file content is stored:
//! `result_json` keeps only the IR (names, signatures, ranges, hashes).
//! Staleness is not stored: it is computed by rereading the files and
//! comparing hashes (`ruth-api`), never with redundant flags.

use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;

use ruth_core::application::Store;
use ruth_core::domain::ProjectId;

use crate::error::StoreError;

/// Snapshot display name (1..=80 characters).
pub const MAX_SNAPSHOT_NAME_CHARS: usize = 80;
/// Files per snapshot (same as the analyzer cap).
pub const MAX_SNAPSHOT_FILES: usize = 20;
/// Maximum serialized result size (1 MiB).
pub const MAX_RESULT_BYTES: usize = 1_000_000;

/// File included in the snapshot, with the source hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotFile {
    pub root_id: String,
    pub rel: String,
    pub hash: String,
    pub bytes: u64,
}

/// Stored snapshot, mirror of a `structure_snapshots` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredSnapshot {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub created_at: String,
    pub files_json: String,
    pub result_json: String,
}

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SnapshotLog {
    snapshots: Vec<StoredSnapshot>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

/// Snapshot files, in save order.
pub fn parse_files(files_json: &str) -> Result<Vec<SnapshotFile>, StoreError> {
    let raw: serde_json::Value =
        serde_json::from_str(files_json).map_err(|_| invalid("invalid files_json"))?;
    let items = raw
        .as_array()
        .ok_or_else(|| invalid("files_json is not a list"))?;
    if items.len() > MAX_SNAPSHOT_FILES {
        return Err(invalid("the snapshot exceeds the file cap"));
    }
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let root_id = item
            .get("rootId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| invalid("file without a root"))?;
        let rel = item
            .get("rel")
            .and_then(|v| v.as_str())
            .ok_or_else(|| invalid("file without a path"))?;
        let hash = item
            .get("hash")
            .and_then(|v| v.as_str())
            .ok_or_else(|| invalid("file without a source hash"))?;
        let bytes = item.get("bytes").and_then(|v| v.as_u64()).unwrap_or(0);
        if root_id.trim().is_empty() || rel.trim().is_empty() || hash.trim().is_empty() {
            return Err(invalid("incomplete file in the snapshot"));
        }
        out.push(SnapshotFile {
            root_id: root_id.to_string(),
            rel: rel.to_string(),
            hash: hash.to_string(),
            bytes,
        });
    }
    Ok(out)
}

impl SnapshotLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn all(&self) -> &[StoredSnapshot] {
        &self.snapshots
    }

    pub fn get(&self, id: &str) -> Option<&StoredSnapshot> {
        self.snapshots.iter().find(|snap| snap.id == id)
    }

    /// A project snapshots (or loose ones with `None`), by id.
    pub fn by_project(&self, project_id: Option<&str>) -> Vec<&StoredSnapshot> {
        let mut out: Vec<&StoredSnapshot> = self
            .snapshots
            .iter()
            .filter(|snap| snap.project_id.as_deref() == project_id)
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Records a validated snapshot: unique identity, bounded name,
    /// parseable files and result within the size cap.
    pub fn record(&mut self, snapshot: StoredSnapshot) -> Result<(), StoreError> {
        if snapshot.id.trim().is_empty() {
            return Err(invalid("the snapshot has no identity"));
        }
        if self.get(&snapshot.id).is_some() {
            return Err(invalid(format!("duplicate snapshot: {}", snapshot.id)));
        }
        let name_len = snapshot.name.chars().count();
        if name_len == 0 || name_len > MAX_SNAPSHOT_NAME_CHARS {
            return Err(invalid("invalid snapshot name"));
        }
        parse_files(&snapshot.files_json)?;
        if snapshot.result_json.len() > MAX_RESULT_BYTES {
            return Err(invalid("the result exceeds 1 MiB"));
        }
        if serde_json::from_str::<serde_json::Value>(&snapshot.result_json).is_err() {
            return Err(invalid("invalid result_json"));
        }
        self.snapshots.push(snapshot);
        Ok(())
    }

    /// Deletes a snapshot by id. Touches neither files nor domain.
    pub fn remove(&mut self, id: &str) -> Result<StoredSnapshot, StoreError> {
        let pos = self
            .snapshots
            .iter()
            .position(|snap| snap.id == id)
            .ok_or_else(|| invalid(format!("missing snapshot: {id}")))?;
        Ok(self.snapshots.remove(pos))
    }
}

pub(crate) fn save_snapshot(
    conn: &mut Connection,
    path: &Path,
    snapshot: &StoredSnapshot,
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute(
        "INSERT INTO structure_snapshots(id, project_id, name, created_at, files_json, result_json)
         VALUES (?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            snapshot.id,
            snapshot.project_id,
            snapshot.name,
            snapshot.created_at,
            snapshot.files_json,
            snapshot.result_json,
        ],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

pub(crate) fn delete_snapshot(
    conn: &mut Connection,
    path: &Path,
    id: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let removed = tx
        .execute("DELETE FROM structure_snapshots WHERE id = ?", [id])
        .map_err(|e| StoreError::convert(path, e))?;
    if removed == 0 {
        return Err(invalid(format!("missing snapshot: {id}")));
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Loads verifying the associated project and the JSON shapes.
/// Referenced roots tolerate dangling: removing a folder does not delete
/// historic snapshots; verify shows their files as missing.
pub(crate) fn load_snapshots(
    conn: &Connection,
    path: &Path,
    store: &Store,
) -> Result<SnapshotLog, StoreError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, name, created_at, files_json, result_json
             FROM structure_snapshots ORDER BY id",
        )
        .map_err(|e| StoreError::convert(path, e))?;
    let rows: Vec<(String, Option<String>, String, String, String, String)> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
            ))
        })
        .map_err(|e| StoreError::convert(path, e))?
        .collect::<Result<_, _>>()
        .map_err(|e| StoreError::convert(path, e))?;
    let mut log = SnapshotLog::new();
    for (id, project_id, name, created_at, files_json, result_json) in rows {
        if let Some(pid) = project_id.as_deref() {
            let project =
                ProjectId::new(pid).map_err(|_| invalid("invalid project on snapshot"))?;
            if store.project(&project).is_none() {
                return Err(invalid(format!(
                    "snapshot {id} points to a missing project"
                )));
            }
        }
        log.record(StoredSnapshot {
            id,
            project_id,
            name,
            created_at,
            files_json,
            result_json,
        })?;
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored(id: &str, project_id: Option<&str>) -> StoredSnapshot {
        StoredSnapshot {
            id: id.to_string(),
            project_id: project_id.map(str::to_string),
            name: "Analysis 1".to_string(),
            created_at: "2026-10-28T00:00:00Z".to_string(),
            files_json: r#"[{"rootId":"root-1","rel":"a.ts","hash":"ab12","bytes":9}]"#.to_string(),
            result_json: r#"{"files":[],"symbols":[],"relations":[]}"#.to_string(),
        }
    }

    #[test]
    fn records_fetches_and_filters_by_project() {
        let mut log = SnapshotLog::new();
        log.record(stored("snap-1", Some("proy-1"))).expect("a");
        log.record(stored("snap-2", None)).expect("b");
        assert_eq!(log.by_project(Some("proy-1")).len(), 1);
        assert_eq!(log.by_project(None).len(), 1);
        assert_eq!(
            log.get("snap-1").map(|s| &s.name),
            Some(&"Analysis 1".to_string())
        );
        log.remove("snap-1").expect("remove");
        assert!(log.get("snap-1").is_none());
        assert!(log.remove("snap-1").is_err());
    }

    #[test]
    fn rejects_invalid_shapes() {
        let mut log = SnapshotLog::new();
        log.record(stored("snap-1", None)).expect("first");
        assert!(log.record(stored("snap-1", None)).is_err(), "duplicate id");
        let mut bad = stored("snap-2", None);
        bad.name = String::new();
        assert!(log.record(bad).is_err(), "empty name");
        let mut bad = stored("snap-3", None);
        bad.files_json = "no-json".to_string();
        assert!(log.record(bad).is_err(), "invalid files");
        let mut bad = stored("snap-4", None);
        bad.files_json = "[]".to_string();
        bad.result_json = "x".repeat(MAX_RESULT_BYTES + 1);
        assert!(log.record(bad).is_err(), "huge result");
    }
}
