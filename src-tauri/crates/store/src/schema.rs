//! Esquema versionado con migraciones transaccionales e idempotentes.
//!
//! Tablas (v1): proyectos, módulos, artefactos (los tres tipos del núcleo),
//! versiones con procedencia y orden, fuentes exactas con posición,
//! aprobaciones con posición, baselines con entradas. Además `meta` guarda
//! el contador de identificadores y la última apertura.
//!
//! Tablas (v2, hito 5): generaciones asistidas con su contexto exacto,
//! preguntas y propuestas con estado de aceptación. La migración v1→v2 solo
//! añade tablas: los datos existentes se conservan íntegramente.
//!
//! Tablas (v3, hito 6): generaciones de diseño (flujo o ER) con su contexto
//! exacto, preguntas y una propuesta con especificación JSON canónica y
//! estado de aceptación. La migración solo añade tablas.

use std::path::Path;

use rusqlite::{Connection, TransactionBehavior};

use crate::error::StoreError;

pub const SCHEMA_VERSION: i64 = 3;

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
-- Sin claves foráneas hacia las tablas del dominio: `save` las reescribe
-- con DELETE + INSERT y una FK inmediata rompería cada guardado. La
-- integridad (proyecto, módulo y artefacto existentes) se verifica al cargar.
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
-- Como en v2: sin FK hacia el dominio (save lo reescribe); la integridad se
-- verifica al cargar. Una sola propuesta por generación de diseño.
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

/// Abre (o crea) el archivo y aplica pragmas. No escribe datos: la
/// validación decide después si esta apertura puede continuar.
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

/// Versión de esquema declarada, sin escribir nada.
pub(crate) fn read_version(conn: &Connection, path: &Path) -> Result<i64, StoreError> {
    conn.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| StoreError::convert(path, e))
}

/// Migración idempotente en una transacción inmediata. Solo se llama cuando
/// la apertura ya está validada (nueva) o los datos ya cargaron bien: la
/// escritura toma el bloqueo persistente que excluye segundas instancias.
pub(crate) fn migrate(conn: &mut Connection, path: &Path, fresh: bool) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute_batch(DDL)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migración v1→v2: solo añade tablas (`IF NOT EXISTS` la hace
    // idempotente); los datos de la v1 quedan intactos.
    tx.execute_batch(DDL_V2)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migración v2→v3: igual, para las generaciones de diseño.
    tx.execute_batch(DDL_V3)
        .map_err(|e| StoreError::convert(path, e))?;
    if fresh {
        // Instalación nueva: el contador empieza en 1. En bases existentes no
        // se toca: si falta después, es manipulación y la carga lo rechaza.
        tx.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('next_id', '1')",
            [],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    tx.execute("PRAGMA user_version = 3", [])
        .map_err(|e| StoreError::convert(path, e))?;
    // Escritura real garantizada: toma el bloqueo que excluye segundas instancias.
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
