//! Versioned schema with transactional, idempotent migrations.
//!
//! Tables (v1): projects, modules, artifacts (the three core types),
//! versions with provenance and order, exact sources with position,
//! approvals with position, baselines with entries. In addition, `meta`
//! holds the identifier counter and the last opening.
//!
//! Tables (v2, milestone 5): assisted generations with their exact
//! context, questions and proposals with acceptance state. The v1→v2
//! migration only adds tables: existing data is fully preserved.
//!
//! Tables (v3, milestone 6): design generations (flow or ER) with their
//! exact context, questions and one proposal with canonical JSON spec
//! and acceptance state. The migration only adds tables.
//!
//! Columns (v4, milestone 8): `design_generations` pins the target
//! artifact and its version when the generation proposes updating an
//! existing design (null on creation ones). The migration only adds columns.
//!
//! Table (v5, milestone 9): `baseline_meta` with the human name,
//! description and scope of each domain baseline. The migration only
//! adds the table.
//!
//! Table (v6, milestone 10): `design_layouts` with the visual layout
//! (element positions per artifact and version) of the design editor.
//! Pure presentation: it never influences validation, currency or
//! approvals. The migration only adds the table.
//!
//! Columns (v7, archiving): `archived` on `modules` and `artifacts` with
//! the reversible domain archiving (0 = active). The migration only adds
//! columns with default 0: everything existing stays active.
//!
//! Names (v8, renaming): `name` on `projects` and `modules` (backfilled
//! with the ID: the initial name is the identifier), `title` on
//! `artifacts` (NULL = no own title), `title` on `baseline_entries`
//! (title pinned at baseline creation) and the `title_history` table
//! with the title history. The migration only adds and backfills: nothing
//! previous is lost or regenerated.
//!
//! Work deliveries (v9, living design): `work_deliveries` with their own
//! name, description and scope (no separate metalog) and
//! `work_delivery_entries` with the title pinned at delivery creation.
//! The migration only adds tables: earlier databases have no deliveries
//! and stay intact.
//!
//! Screen proposals (v10, mockups as input): generations with their exact
//! context, questions and per-screen proposals (canonical JSON of a
//! single-screen mockup, explanation and state). The migration only adds
//! tables.
//!
//! Code generations (v13, living diagrams): `code_generations` with the
//! exact source requirement, model, template, usage and explanation;
//! `code_gen_scope` with the scope (root, path and fingerprint at
//! generation); `code_gen_notes` with assumptions and questions;
//! `code_proposal_files` with the full proposed content and per-file
//! state. As in v2/v3: no FK into the domain (the requirement may have
//! been deleted and the api marks stale instead of breaking). The
//! migration only adds tables.
//!
//! Screen origin (v14, proposals from mockups): `code_generations`
//! gains mockup + screen + the exact mockup version (NULL on older
//! rows = requirement origin) and `code_gen_screen_sources` keeps the
//! sources cited by the screen (artifact + exact version). No FK into
//! the domain, same as the source requirement.

use std::path::Path;

use rusqlite::{Connection, TransactionBehavior};

use crate::error::StoreError;

pub const SCHEMA_VERSION: i64 = 15;

const DDL_V13: &str = "
-- Code generations: one per requirement and scope, with its
-- explanation and metadata. No FK into the domain: the source
-- requirement may have been deleted (it was a draft) and loading tolerates it.
CREATE TABLE IF NOT EXISTS code_generations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    requirement_artifact_id TEXT NOT NULL,
    requirement_version_id TEXT NOT NULL,
    model TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL,
    explanation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_code_generations_module ON code_generations(module_id);
-- Scope at generation: what was read and with which fingerprint.
CREATE TABLE IF NOT EXISTS code_gen_scope(
    generation_id TEXT NOT NULL REFERENCES code_generations(id),
    pos INTEGER NOT NULL,
    root_id TEXT NOT NULL,
    rel TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (generation_id, pos)
);
-- Assumptions and questions of the proposal.
CREATE TABLE IF NOT EXISTS code_gen_notes(
    generation_id TEXT NOT NULL REFERENCES code_generations(id),
    kind TEXT NOT NULL,
    pos INTEGER NOT NULL,
    note TEXT NOT NULL,
    PRIMARY KEY (generation_id, kind, pos),
    CHECK(kind IN ('assumption', 'question'))
);
-- Proposed files with full content and per-file state.
CREATE TABLE IF NOT EXISTS code_proposal_files(
    generation_id TEXT NOT NULL REFERENCES code_generations(id),
    pos INTEGER NOT NULL,
    root_id TEXT NOT NULL,
    rel TEXT NOT NULL,
    operation TEXT NOT NULL,
    expected_fingerprint TEXT,
    content TEXT NOT NULL,
    state TEXT NOT NULL,
    decided_at TEXT,
    PRIMARY KEY (generation_id, pos),
    CHECK(operation IN ('create', 'modify')),
    CHECK(state IN ('pending', 'accepted', 'discarded'))
);
";

const DDL_V14: &str = "
-- Sources cited by the origin screen: requirement + exact version.
CREATE TABLE IF NOT EXISTS code_gen_screen_sources(
    generation_id TEXT NOT NULL REFERENCES code_generations(id),
    pos INTEGER NOT NULL,
    artifact_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    PRIMARY KEY (generation_id, pos)
);
";

const DDL_V15: &str = "
-- Saved workspaces (recents): references only, never file contents.
-- No FK: the linked project may be deleted and missing paths are
-- reported at restore time, never silently dropped here.
CREATE TABLE IF NOT EXISTS recent_workspaces(
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    project_id TEXT,
    root_paths_json TEXT NOT NULL,
    last_opened TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recent_workspaces_opened ON recent_workspaces(last_opened);
";

const DDL_V12: &str = "
-- Code↔knowledge links: a module with folders/files (manual) or an
-- artifact with detected symbols (with evidence). No FK into the domain
-- nor into code_roots (both are rewritten with DELETE + INSERT; integrity
-- is verified on load). Module links carry no symbol; artifact links require
-- one. `inferred` reserved for the future.
CREATE TABLE IF NOT EXISTS code_links(
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    root_id TEXT NOT NULL,
    rel TEXT NOT NULL,
    symbol_id TEXT,
    symbol_name TEXT,
    symbol_kind TEXT,
    range_start_line INTEGER,
    range_start_col INTEGER,
    range_end_line INTEGER,
    range_end_col INTEGER,
    evidence_hash TEXT,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK(scope IN ('module', 'artifact')),
    CHECK(kind IN ('manual', 'detected', 'inferred')),
    CHECK(scope <> 'module' OR symbol_id IS NULL),
    CHECK(scope <> 'artifact' OR symbol_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_links_module
    ON code_links(owner_id, root_id, rel) WHERE scope = 'module';
CREATE UNIQUE INDEX IF NOT EXISTS idx_code_links_symbol
    ON code_links(owner_id, root_id, rel, symbol_id) WHERE scope = 'artifact';
CREATE INDEX IF NOT EXISTS idx_code_links_owner ON code_links(scope, owner_id);
CREATE INDEX IF NOT EXISTS idx_code_links_root ON code_links(root_id);
-- Structure analysis snapshots: metadata and analyzer result (symbols,
-- relations, per-file hashes). No file contents: `result_json` keeps only
-- the detected IR. Dangling root references are tolerated (the folder may
-- disappear; verify reports it as missing instead of breaking the load).
CREATE TABLE IF NOT EXISTS structure_snapshots(
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    files_json TEXT NOT NULL,
    result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_project ON structure_snapshots(project_id);
";

const DDL_V11: &str = "
-- Code workspace roots: stable id, absolute path chosen by the person,
-- display name and order. No FK: the folder may not exist on reopen
-- (marked missing, without deleting the row).
CREATE TABLE IF NOT EXISTS code_roots(
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    name TEXT NOT NULL,
    pos INTEGER NOT NULL
);
";

const DDL_V10: &str = "
-- As in v2/v3: no FK into the domain (save rewrites it with DELETE +
-- INSERT); integrity is verified on load. One proposal per screen.
CREATE TABLE IF NOT EXISTS mockup_generations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    model TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mockup_context(
    generation_id TEXT NOT NULL REFERENCES mockup_generations(id),
    pos INTEGER NOT NULL,
    version_id TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS mockup_questions(
    generation_id TEXT NOT NULL REFERENCES mockup_generations(id),
    pos INTEGER NOT NULL,
    question TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS mockup_proposals(
    generation_id TEXT NOT NULL REFERENCES mockup_generations(id),
    temp_id TEXT NOT NULL,
    title TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    explanation TEXT NOT NULL,
    state TEXT NOT NULL,
    artifact_id TEXT,
    accepted_content TEXT,
    PRIMARY KEY(generation_id, temp_id)
);
";

const DDL_V9: &str = "
CREATE TABLE IF NOT EXISTS work_deliveries(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    scope_module TEXT,
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_delivery_entries(
    delivery_id TEXT NOT NULL REFERENCES work_deliveries(id),
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_id TEXT NOT NULL REFERENCES versions(id),
    title TEXT,
    PRIMARY KEY(delivery_id, artifact_id)
);
";

const DDL_V8: &str = "
CREATE TABLE IF NOT EXISTS title_history(
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    pos INTEGER NOT NULL,
    title TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY(artifact_id, pos)
);
";

const DDL: &str = "
CREATE TABLE IF NOT EXISTS projects(
    id TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS modules(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id)
);
CREATE TABLE IF NOT EXISTS artifacts(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS versions(
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    number INTEGER NOT NULL,
    content TEXT NOT NULL,
    provenance_kind TEXT NOT NULL,
    provenance_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS version_sources(
    version_id TEXT NOT NULL REFERENCES versions(id),
    pos INTEGER NOT NULL,
    source_id TEXT NOT NULL REFERENCES versions(id),
    PRIMARY KEY(version_id, pos)
);
CREATE TABLE IF NOT EXISTS approvals(
    version_id TEXT NOT NULL REFERENCES versions(id),
    approved_by TEXT NOT NULL,
    at TEXT NOT NULL,
    pos INTEGER NOT NULL,
    PRIMARY KEY(version_id, approved_by)
);
CREATE TABLE IF NOT EXISTS baselines(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS baseline_entries(
    baseline_id TEXT NOT NULL REFERENCES baselines(id),
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_id TEXT NOT NULL REFERENCES versions(id),
    PRIMARY KEY(baseline_id, artifact_id)
);
CREATE TABLE IF NOT EXISTS meta(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
";

const DDL_V2: &str = "
-- No foreign keys into the domain tables: `save` rewrites them with
-- DELETE + INSERT and an immediate FK would break every save. Integrity
-- (existing project, module and artifact) is verified on load.
CREATE TABLE IF NOT EXISTS generations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    model TEXT NOT NULL,
    description TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS generation_context(
    generation_id TEXT NOT NULL REFERENCES generations(id),
    pos INTEGER NOT NULL,
    version_id TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS generation_questions(
    generation_id TEXT NOT NULL REFERENCES generations(id),
    pos INTEGER NOT NULL,
    question TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS proposals(
    generation_id TEXT NOT NULL REFERENCES generations(id),
    temp_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    state TEXT NOT NULL,
    artifact_id TEXT,
    accepted_content TEXT,
    PRIMARY KEY(generation_id, temp_id)
);
CREATE TABLE IF NOT EXISTS proposal_acceptance(
    generation_id TEXT NOT NULL,
    temp_id TEXT NOT NULL,
    pos INTEGER NOT NULL,
    item TEXT NOT NULL,
    PRIMARY KEY(generation_id, temp_id, pos),
    FOREIGN KEY(generation_id, temp_id) REFERENCES proposals(generation_id, temp_id)
);
CREATE TABLE IF NOT EXISTS proposal_assumptions(
    generation_id TEXT NOT NULL,
    temp_id TEXT NOT NULL,
    pos INTEGER NOT NULL,
    item TEXT NOT NULL,
    PRIMARY KEY(generation_id, temp_id, pos),
    FOREIGN KEY(generation_id, temp_id) REFERENCES proposals(generation_id, temp_id)
);
";

const DDL_V3: &str = "
-- As in v2: no FK into the domain (save rewrites it); integrity is
-- verified on load. A single proposal per design generation.
CREATE TABLE IF NOT EXISTS design_generations(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    template_version INTEGER NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS design_context(
    generation_id TEXT NOT NULL REFERENCES design_generations(id),
    pos INTEGER NOT NULL,
    version_id TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS design_questions(
    generation_id TEXT NOT NULL REFERENCES design_generations(id),
    pos INTEGER NOT NULL,
    question TEXT NOT NULL,
    PRIMARY KEY(generation_id, pos)
);
CREATE TABLE IF NOT EXISTS design_proposals(
    generation_id TEXT PRIMARY KEY REFERENCES design_generations(id),
    title TEXT NOT NULL,
    spec_json TEXT NOT NULL,
    explanation TEXT NOT NULL,
    state TEXT NOT NULL,
    artifact_id TEXT,
    accepted_content TEXT
);
";

const DDL_V5: &str = "
-- As in v2/v3: no FK into the domain (save rewrites it with DELETE +
-- INSERT); baseline existence is verified on load.
CREATE TABLE IF NOT EXISTS baseline_meta(
    baseline_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope_module TEXT,
    created_at TEXT NOT NULL
);
";

const DDL_V6: &str = "
-- As in v2/v3/v5: no FK into the domain (save rewrites it with DELETE +
-- INSERT); versions are never deleted, so there are no orphans. The
-- layout is presentation: it is not validated against the domain on load.
CREATE TABLE IF NOT EXISTS design_layouts(
    artifact_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    PRIMARY KEY(artifact_id, version_id)
);
";

/// Opens (or creates) the file and applies pragmas. Writes no data: the
/// validation decides later whether this opening may continue.
pub(crate) fn open(path: &Path) -> Result<Connection, StoreError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| StoreError::Io {
                path: path.to_path_buf(),
                message: e.to_string(),
            })?;
        }
    }
    let conn = Connection::open(path).map_err(|e| StoreError::convert(path, e))?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA busy_timeout = 0;
         PRAGMA locking_mode = EXCLUSIVE;
         PRAGMA journal_mode = DELETE;
         PRAGMA synchronous = FULL;",
    )
    .map_err(|e| StoreError::convert(path, e))?;
    Ok(conn)
}

/// Does the column already exist? Makes migration ALTERs idempotent.
fn has_column(
    tx: &rusqlite::Transaction,
    path: &Path,
    table: &str,
    column: &str,
) -> Result<bool, StoreError> {
    let mut stmt = tx
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| StoreError::convert(path, e))?;
    let names: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| StoreError::convert(path, e))?
        .collect::<Result<_, _>>()
        .map_err(|e| StoreError::convert(path, e))?;
    Ok(names.iter().any(|name| name == column))
}

/// Declared schema version, without writing anything.
pub(crate) fn read_version(conn: &Connection, path: &Path) -> Result<i64, StoreError> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| StoreError::convert(path, e))
}

/// Idempotent migration in an immediate transaction. Only called once the
/// opening is already validated (new) or the data already loaded fine: the
/// write takes the persistent lock that excludes second instances.
pub(crate) fn migrate(conn: &mut Connection, path: &Path, fresh: bool) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute_batch(DDL)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v1→v2: only adds tables (`IF NOT EXISTS` makes it
    // idempotent); the v1 data stays intact.
    tx.execute_batch(DDL_V2)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v2→v3: same, for design generations.
    tx.execute_batch(DDL_V3)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v3→v4: target columns on design generations. The ALTER
    // is guarded per column (SQLite has no IF NOT EXISTS here): repeating
    // the migration is a no-op.
    for (column, ddl) in [
        (
            "target_artifact_id",
            "ALTER TABLE design_generations ADD COLUMN target_artifact_id TEXT",
        ),
        (
            "target_version_id",
            "ALTER TABLE design_generations ADD COLUMN target_version_id TEXT",
        ),
    ] {
        if !has_column(&tx, path, "design_generations", column)? {
            tx.execute(ddl, [])
                .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    if fresh {
        // Fresh install: the counter starts at 1. On existing databases it
        // is untouched: if missing later, it is tampering and loading rejects it.
        tx.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('next_id', '1')",
            [],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    // Migration v4→v5: same, for baseline metadata.
    tx.execute_batch(DDL_V5)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v5→v6: same, for visual editor layouts.
    tx.execute_batch(DDL_V6)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v6→v7: archiving flags with default 0 (active). As in
    // v4, the ALTER is guarded per column so repeating is a no-op.
    for (table, column) in [("modules", "archived"), ("artifacts", "archived")] {
        if !has_column(&tx, path, table, column)? {
            tx.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"),
                [],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    // Migration v7→v8: names and titles. Name columns are born with
    // default '' and backfilled with the ID (the initial name is the
    // identifier); titles are born NULL (no own title).
    for table in ["projects", "modules"] {
        if !has_column(&tx, path, table, "name")? {
            tx.execute(
                &format!("ALTER TABLE {table} ADD COLUMN name TEXT NOT NULL DEFAULT ''"),
                [],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    tx.execute("UPDATE projects SET name = id WHERE name = ''", [])
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute("UPDATE modules SET name = id WHERE name = ''", [])
        .map_err(|e| StoreError::convert(path, e))?;
    for (table, column) in [("artifacts", "title"), ("baseline_entries", "title")] {
        if !has_column(&tx, path, table, column)? {
            tx.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} TEXT"), [])
                .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    tx.execute_batch(DDL_V8)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v8→v9: work deliveries. New tables, always empty in
    // earlier databases: nothing to backfill or convert.
    tx.execute_batch(DDL_V9)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v9→v10: same, for screen proposals.
    tx.execute_batch(DDL_V10)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v10→v11: same, for code workspace roots.
    tx.execute_batch(DDL_V11)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v11→v12: associate roots with projects (new column, NULL
    // = loose folder, no project) + links and structure-snapshot tables.
    // Earlier data stays intact.
    if !has_column(&tx, path, "code_roots", "project_id")? {
        tx.execute("ALTER TABLE code_roots ADD COLUMN project_id TEXT", [])
            .map_err(|e| StoreError::convert(path, e))?;
    }
    tx.execute_batch(DDL_V12)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v12→v13: same, for code generations.
    tx.execute_batch(DDL_V13)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v13→v14: screen provenance on code generations (NULL
    // columns = requirement origin) + sources table. ALTER guarded per
    // column, as in v4: repeating is a no-op.
    for column in ["screen_artifact_id", "screen_id", "screen_version_id"] {
        if !has_column(&tx, path, "code_generations", column)? {
            tx.execute(
                &format!("ALTER TABLE code_generations ADD COLUMN {column} TEXT"),
                [],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    tx.execute_batch(DDL_V14)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migration v14→v15: recent workspaces table. New table, always
    // empty in earlier databases: nothing to backfill.
    tx.execute_batch(DDL_V15)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute("PRAGMA user_version = 15", [])
        .map_err(|e| StoreError::convert(path, e))?;
    // Guaranteed real write: takes the lock that excludes second instances.
    let pid = std::process::id();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('last_opened', ?)",
        [format!("pid={pid} at={now}")],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}
