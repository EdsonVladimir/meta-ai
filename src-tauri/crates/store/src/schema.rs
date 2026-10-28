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
//!
//! Columnas (v4, hito 8): `design_generations` fija el artefacto objetivo y
//! su versión cuando la generación propone actualizar un diseño existente
//! (nulas en las de creación). La migración solo añade columnas.
//!
//! Tabla (v5, hito 9): `baseline_meta` con nombre, descripción y alcance
//! humanos de cada baseline del dominio. La migración solo añade la tabla.
//!
//! Tabla (v6, hito 10): `design_layouts` con la disposición visual (posiciones
//! de elementos por artefacto y versión) del editor de diseños. Presentación
//! pura: jamás influye en validación, vigencia ni aprobaciones. La migración
//! solo añade la tabla.
//!
//! Columnas (v7, archivo): `archived` en `modules` y `artifacts` con el
//! archivado reversible del dominio (0 = activo). La migración solo añade
//! columnas con defecto 0: todo lo existente sigue activo.
//!
//! Nombres (v8, renombrado): `name` en `projects` y `modules` (se rellena
//! con el ID: el nombre inicial es el identificador), `title` en
//! `artifacts` (NULL = sin título propio), `title` en `baseline_entries`
//! (título fijado al crear la baseline) y tabla `title_history` con el
//! historial de títulos. La migración solo añade y rellena: nada previo
//! se pierde ni se regenera.
//!
//! Entregas de trabajo (v9, diseño vivo): `work_deliveries` con nombre,
//! descripción y alcance propios (sin metalog separado) y
//! `work_delivery_entries` con el título fijado al crear la entrega.
//! La migración solo añade tablas: las bases anteriores no tienen
//! entregas y siguen intactas.

use std::path::Path;

use rusqlite::{Connection, TransactionBehavior};

use crate::error::StoreError;

pub const SCHEMA_VERSION: i64 = 9;

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

const DDL_V5: &str = "
-- Como en v2/v3: sin FK hacia el dominio (save lo reescribe con DELETE +
-- INSERT); la existencia de la baseline se verifica al cargar.
CREATE TABLE IF NOT EXISTS baseline_meta(
    baseline_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope_module TEXT,
    created_at TEXT NOT NULL
);
";

const DDL_V6: &str = "
-- Como en v2/v3/v5: sin FK hacia el dominio (save lo reescribe con DELETE +
-- INSERT); las versiones nunca se borran, así que no hay huérfanos. La
-- disposición es presentación: no se valida contra el dominio al cargar.
CREATE TABLE IF NOT EXISTS design_layouts(
    artifact_id TEXT NOT NULL,
    version_id TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    PRIMARY KEY(artifact_id, version_id)
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

/// ¿Existe ya la columna? Hace idempotentes los ALTER de migración.
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
    // Migración v3→v4: columnas de objetivo en generaciones de diseño. El
    // ALTER se protege por columna (SQLite no tiene IF NOT EXISTS aquí):
    // repetir la migración es un no-op.
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
        // Instalación nueva: el contador empieza en 1. En bases existentes no
        // se toca: si falta después, es manipulación y la carga lo rechaza.
        tx.execute(
            "INSERT OR IGNORE INTO meta(key, value) VALUES ('next_id', '1')",
            [],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    // Migración v4→v5: igual, para los metadatos de baselines.
    tx.execute_batch(DDL_V5)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migración v5→v6: igual, para las disposiciones del editor visual.
    tx.execute_batch(DDL_V6)
        .map_err(|e| StoreError::convert(path, e))?;
    // Migración v6→v7: flags de archivado con defecto 0 (activo). Como en
    // v4, el ALTER se protege por columna para que repetir sea un no-op.
    for (table, column) in [("modules", "archived"), ("artifacts", "archived")] {
        if !has_column(&tx, path, table, column)? {
            tx.execute(
                &format!("ALTER TABLE {table} ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"),
                [],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    // Migración v7→v8: nombres y títulos. Las columnas de nombre nacen con
    // defecto '' y se rellenan con el ID (el nombre inicial es el
    // identificador); los títulos nacen NULL (sin título propio).
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
    // Migración v8→v9: entregas de trabajo. Tablas nuevas, siempre vacías
    // en bases anteriores: nada que rellenar ni convertir.
    tx.execute_batch(DDL_V9)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute("PRAGMA user_version = 9", [])
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
