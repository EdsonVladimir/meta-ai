//! Saved workspaces (recents): references only, never file contents.
//!
//! Each entry points at a project (optional) and a list of root paths.
//! Restoring re-adds missing roots by path and selects the project when
//! it still exists; missing paths and deleted projects are reported,
//! never silently dropped or merged. Total rewrite on each save
//! (DELETE + INSERT in one transaction), like the rest of the adapter.

use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;

use crate::error::StoreError;

/// Cap of kept entries; the oldest beyond it are pruned on save.
pub const MAX_RECENT_WORKSPACES: usize = 20;

/// Stored entry, mirror of the `recent_workspaces` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRecent {
    pub id: String,
    pub label: String,
    pub project_id: Option<String>,
    pub root_paths: Vec<String>,
    pub last_opened: String,
    pub created_at: String,
}

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RecentLog {
    recents: Vec<StoredRecent>,
}

impl RecentLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn recents(&self) -> &[StoredRecent] {
        &self.recents
    }

    /// Replaces the whole log after a confirmed save.
    pub fn replace(&mut self, recents: Vec<StoredRecent>) {
        self.recents = recents;
    }
}

pub(crate) fn load_recents(conn: &Connection, path: &Path) -> Result<RecentLog, StoreError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, label, project_id, root_paths_json, last_opened, created_at
             FROM recent_workspaces ORDER BY last_opened DESC, id DESC",
        )
        .map_err(|e| StoreError::convert(path, e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| StoreError::convert(path, e))?;
    let mut log = RecentLog::new();
    for row in rows {
        let (id, label, project_id, paths_json, last_opened, created_at) =
            row.map_err(|e| StoreError::convert(path, e))?;
        if id.trim().is_empty() || label.trim().is_empty() {
            continue;
        }
        // Hand-edited JSON never breaks opening: illegible means no paths.
        let root_paths: Vec<String> = serde_json::from_str(&paths_json).unwrap_or_default();
        log.recents.push(StoredRecent {
            id,
            label,
            project_id: project_id.filter(|p| !p.trim().is_empty()),
            root_paths: root_paths
                .into_iter()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
            last_opened,
            created_at,
        });
    }
    Ok(log)
}

pub(crate) fn save_recents(
    conn: &mut Connection,
    path: &Path,
    recents: &[StoredRecent],
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute("DELETE FROM recent_workspaces", [])
        .map_err(|e| StoreError::convert(path, e))?;
    for recent in recents.iter().take(MAX_RECENT_WORKSPACES) {
        let paths_json =
            serde_json::to_string(&recent.root_paths).unwrap_or_else(|_| "[]".to_string());
        tx.execute(
            "INSERT INTO recent_workspaces(id, label, project_id, root_paths_json, last_opened, created_at)
             VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                recent.id,
                recent.label,
                recent.project_id,
                paths_json,
                recent.last_opened,
                recent.created_at
            ],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory() -> Connection {
        let conn = Connection::open_in_memory().expect("memory db");
        conn.execute_batch(
            "CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE recent_workspaces(
                 id TEXT PRIMARY KEY, label TEXT NOT NULL, project_id TEXT,
                 root_paths_json TEXT NOT NULL, last_opened TEXT NOT NULL,
                 created_at TEXT NOT NULL);",
        )
        .expect("ddl");
        conn
    }

    fn entry(id: &str) -> StoredRecent {
        StoredRecent {
            id: id.to_string(),
            label: format!("label-{id}"),
            project_id: Some("proy-1".to_string()),
            root_paths: vec!["/repo/a".to_string()],
            last_opened: "2026-10-29T12:00:00Z".to_string(),
            created_at: "2026-10-29T11:00:00Z".to_string(),
        }
    }

    #[test]
    fn roundtrip_orders_by_last_opened() {
        let mut conn = memory();
        let path = Path::new("memory");
        let older = StoredRecent {
            last_opened: "2026-10-28T12:00:00Z".to_string(),
            ..entry("ws-1")
        };
        save_recents(&mut conn, path, &[older, entry("ws-2")], 7).expect("save");
        let log = load_recents(&conn, path).expect("load");
        assert_eq!(log.recents().len(), 2);
        assert_eq!(log.recents()[0].id, "ws-2");
        assert_eq!(log.recents()[0].root_paths, vec!["/repo/a".to_string()]);
    }

    #[test]
    fn prunes_beyond_cap() {
        let mut conn = memory();
        let path = Path::new("memory");
        let many: Vec<StoredRecent> = (0..25)
            .map(|i| StoredRecent {
                last_opened: format!("2026-10-29T12:{i:02}:00Z"),
                ..entry(&format!("ws-{i}"))
            })
            .collect();
        save_recents(&mut conn, path, &many, 7).expect("save");
        let log = load_recents(&conn, path).expect("load");
        assert_eq!(log.recents().len(), MAX_RECENT_WORKSPACES);
    }

    #[test]
    fn tolerates_hand_edited_rows() {
        let conn = memory();
        let path = Path::new("memory");
        conn.execute(
            "INSERT INTO recent_workspaces VALUES ('ws-bad', 'Bad', NULL, 'not-json', 't', 't')",
            [],
        )
        .expect("insert");
        conn.execute(
            "INSERT INTO recent_workspaces VALUES ('', 'Empty', NULL, '[]', 't', 't')",
            [],
        )
        .expect("insert");
        let log = load_recents(&conn, path).expect("load");
        assert_eq!(log.recents().len(), 1);
        assert!(log.recents()[0].root_paths.is_empty());
    }
}
