//! Guardado y carga de instantáneas completas.
//!
//! `save` reescribe la base entera en una transacción inmediata: o se guarda
//! todo o no se guarda nada. `load` reconstruye con los constructores
//! falibles del dominio y `Store::reconstitute`, sin generar nada nuevo.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{Connection, Transaction, TransactionBehavior};
use ruth_core::application::{Snapshot, Store};
use ruth_core::domain::{
    Approval, Artifact, ArtifactId, ArtifactType, Baseline, BaselineId, Content, CoreError, Date,
    DeliveryId, HumanId, Module, ModuleId, Name, Project, ProjectId, TitleChange, Version,
    VersionId, WorkDelivery,
};

use crate::baseline_meta::{BaselineMeta, BaselineMetaLog};
use crate::design::{DesignLog, StoredDesignGeneration, StoredDesignProposal};
use crate::error::StoreError;
use crate::layout::LayoutLog;
use crate::proposals::{ProposalLog, ProposalState, StoredGeneration, StoredProposal};

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

fn core(err: CoreError) -> StoreError {
    StoreError::InvalidData {
        message: err.to_string(),
    }
}

/// Guarda el estado íntegro (dominio + contador de ids) en una transacción.
/// Si falla, la base conserva la instantánea anterior. No toca las tablas de
/// generaciones: conviven con el dominio y tienen sus propias operaciones.
pub(crate) fn save(
    conn: &mut Connection,
    path: &Path,
    store: &Store,
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    save_domain(&tx, path, store, next_id)?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Reescritura total del dominio dentro de una transacción ya abierta.
/// Compartida por `save` y por la aceptación atómica de propuestas.
fn save_domain(
    tx: &Transaction,
    path: &Path,
    store: &Store,
    next_id: u64,
) -> Result<(), StoreError> {
    // Orden de borrado hijo→padre: `baselines` referencia a `projects`,
    // así que debe vaciarse antes que él (hasta el hito 9 la tabla estaba
    // siempre vacía y el orden erróneo nunca se notó).
    for table in [
        "baseline_entries",
        "baselines",
        "work_delivery_entries",
        "work_deliveries",
        "approvals",
        "version_sources",
        "versions",
        "title_history",
        "artifacts",
        "modules",
        "projects",
    ] {
        tx.execute(&format!("DELETE FROM {table}"), [])
            .map_err(|e| StoreError::convert(path, e))?;
    }
    let mut pending_sources: Vec<(VersionId, usize, VersionId)> = Vec::new();
    for project in store.projects() {
        tx.execute(
            "INSERT INTO projects(id, name) VALUES (?, ?)",
            [project.id().as_str(), project.name()],
        )
        .map_err(|e| StoreError::convert(path, e))?;
        for module in store.modules_of(project.id()) {
            tx.execute(
                "INSERT INTO modules(id, project_id, name, archived) VALUES (?, ?, ?, ?)",
                rusqlite::params![
                    module.id().as_str(),
                    project.id().as_str(),
                    module.name(),
                    i64::from(module.archived())
                ],
            )
            .map_err(|e| StoreError::convert(path, e))?;
            for artifact in store.artifacts_of(project.id(), module.id()) {
                tx.execute(
                    "INSERT INTO artifacts(id, project_id, module_id, kind, title, archived) VALUES (?, ?, ?, ?, ?, ?)",
                    rusqlite::params![
                        artifact.id().as_str(),
                        project.id().as_str(),
                        module.id().as_str(),
                        artifact_kind(artifact.artifact_type()),
                        artifact.title(),
                        i64::from(artifact.archived())
                    ],
                )
                .map_err(|e| StoreError::convert(path, e))?;
                for version in store.versions_of(artifact.id()) {
                    let (provenance_kind, provenance_by) = provenance_parts(version.provenance());
                    tx.execute(
                        "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
                         VALUES (?, ?, ?, ?, ?, ?)",
                        rusqlite::params![
                            version.id().as_str(),
                            artifact.id().as_str(),
                            version.number(),
                            version.content().as_str(),
                            provenance_kind,
                            provenance_by,
                        ],
                    )
                    .map_err(|e| StoreError::convert(path, e))?;
                    for (pos, source) in version.sources().iter().enumerate() {
                        pending_sources.push((version.id().clone(), pos, source.clone()));
                    }
                }
            }
        }
    }
    // Segunda pasada: las fuentes pueden apuntar a versiones de artefactos
    // posteriores en el orden de inserción.
    for (version, pos, source) in &pending_sources {
        tx.execute(
            "INSERT INTO version_sources(version_id, pos, source_id) VALUES (?, ?, ?)",
            rusqlite::params![version.as_str(), *pos as u32, source.as_str()],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    for (pos, approval) in store.approvals().iter().enumerate() {
        tx.execute(
            "INSERT INTO approvals(version_id, approved_by, at, pos) VALUES (?, ?, ?, ?)",
            rusqlite::params![
                approval.version().as_str(),
                approval.approved_by().as_str(),
                approval.at().as_str(),
                pos as u32,
            ],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    for baseline in store.baselines() {
        tx.execute(
            "INSERT INTO baselines(id, project_id, at) VALUES (?, ?, ?)",
            [
                baseline.id().as_str(),
                baseline.project().as_str(),
                baseline.at().as_str(),
            ],
        )
        .map_err(|e| StoreError::convert(path, e))?;
        for (artifact, version) in baseline.entries() {
            let title = baseline.title_of(artifact).flatten();
            tx.execute(
                "INSERT INTO baseline_entries(baseline_id, artifact_id, version_id, title) VALUES (?, ?, ?, ?)",
                rusqlite::params![
                    baseline.id().as_str(),
                    artifact.as_str(),
                    version.as_str(),
                    title,
                ],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    for delivery in store.deliveries() {
        tx.execute(
            "INSERT INTO work_deliveries(id, project_id, name, description, scope_module, at) VALUES (?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                delivery.id().as_str(),
                delivery.project().as_str(),
                delivery.name(),
                delivery.description(),
                delivery.scope_module().map(ModuleId::as_str),
                delivery.at().as_str(),
            ],
        )
        .map_err(|e| StoreError::convert(path, e))?;
        for (artifact, version) in delivery.entries() {
            let title = delivery.title_of(artifact).flatten();
            tx.execute(
                "INSERT INTO work_delivery_entries(delivery_id, artifact_id, version_id, title) VALUES (?, ?, ?, ?)",
                rusqlite::params![
                    delivery.id().as_str(),
                    artifact.as_str(),
                    version.as_str(),
                    title,
                ],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
    }
    // Historial de títulos con posición global: la carga lo reconstruye
    // en el orden exacto de registro.
    for (pos, change) in store.title_changes().iter().enumerate() {
        tx.execute(
            "INSERT INTO title_history(artifact_id, pos, title, changed_by, at) VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                change.artifact().as_str(),
                pos as u32,
                change.title(),
                change.by().as_str(),
                change.at().as_str(),
            ],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Registra una generación validada con sus propuestas pendientes, en una
/// transacción. Si falla, no queda rastro parcial.
pub(crate) fn save_generation(
    conn: &mut Connection,
    path: &Path,
    generation: &StoredGeneration,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    insert_generation(&tx, path, generation)?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

fn insert_generation(
    tx: &Transaction,
    path: &Path,
    generation: &StoredGeneration,
) -> Result<(), StoreError> {
    let convert = |e| StoreError::convert(path, e);
    tx.execute(
        "INSERT INTO generations(id, project_id, module_id, model, description,
         template_version, input_tokens, output_tokens, total_tokens, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            generation.id,
            generation.project_id,
            generation.module_id,
            generation.model,
            generation.description,
            generation.template_version,
            generation.input_tokens,
            generation.output_tokens,
            generation.total_tokens,
            generation.created_at,
        ],
    )
    .map_err(&convert)?;
    for (pos, version) in generation.context_version_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO generation_context(generation_id, pos, version_id) VALUES (?, ?, ?)",
            rusqlite::params![generation.id, pos as u32, version],
        )
        .map_err(&convert)?;
    }
    for (pos, question) in generation.questions.iter().enumerate() {
        tx.execute(
            "INSERT INTO generation_questions(generation_id, pos, question) VALUES (?, ?, ?)",
            rusqlite::params![generation.id, pos as u32, question],
        )
        .map_err(&convert)?;
    }
    for proposal in &generation.proposals {
        if !matches!(proposal.state, ProposalState::Pending) {
            return Err(invalid("las propuestas nuevas deben estar pendientes"));
        }
        tx.execute(
            "INSERT INTO proposals(generation_id, temp_id, title, description, state)
             VALUES (?, ?, ?, ?, 'pending')",
            rusqlite::params![
                generation.id,
                proposal.temp_id,
                proposal.title,
                proposal.description,
            ],
        )
        .map_err(&convert)?;
        insert_items(
            tx,
            path,
            "proposal_acceptance",
            &generation.id,
            &proposal.temp_id,
            &proposal.acceptance,
        )?;
        insert_items(
            tx,
            path,
            "proposal_assumptions",
            &generation.id,
            &proposal.temp_id,
            &proposal.assumptions,
        )?;
    }
    Ok(())
}

fn insert_items(
    tx: &Transaction,
    path: &Path,
    table: &str,
    generation_id: &str,
    temp_id: &str,
    items: &[String],
) -> Result<(), StoreError> {
    for (pos, item) in items.iter().enumerate() {
        tx.execute(
            &format!("INSERT INTO {table}(generation_id, temp_id, pos, item) VALUES (?, ?, ?, ?)"),
            rusqlite::params![generation_id, temp_id, pos as u32, item],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    Ok(())
}

/// Aceptación atómica: reescribe el dominio (con el requisito ya creado) y
/// marca la propuesta como aceptada en la MISMA transacción. Si la propuesta
/// no está pendiente, todo se revierte y memoria y disco quedan intactos.
// Ocho parámetros explícitos en vez de un struct de un solo uso.
#[allow(clippy::too_many_arguments)]
pub(crate) fn accept_proposal(
    conn: &mut Connection,
    path: &Path,
    store: &Store,
    next_id: u64,
    generation_id: &str,
    temp_id: &str,
    artifact_id: &str,
    content: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    save_domain(&tx, path, store, next_id)?;
    let changed = tx
        .execute(
            "UPDATE proposals SET state = 'accepted', artifact_id = ?, accepted_content = ?
             WHERE generation_id = ? AND temp_id = ? AND state = 'pending'",
            rusqlite::params![artifact_id, content, generation_id, temp_id],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    if changed != 1 {
        return Err(invalid(format!(
            "la propuesta {temp_id} no está pendiente de aceptar"
        )));
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Descarta una propuesta pendiente, en una transacción. Idempotente si ya
/// estaba descartada; rechaza si ya se aceptó o no existe.
pub(crate) fn discard_proposal(
    conn: &mut Connection,
    path: &Path,
    generation_id: &str,
    temp_id: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let state: Option<String> = tx
        .query_row(
            "SELECT state FROM proposals WHERE generation_id = ? AND temp_id = ?",
            rusqlite::params![generation_id, temp_id],
            |row| row.get(0),
        )
        .ok();
    match state.as_deref() {
        Some("pending") => {
            tx.execute(
                "UPDATE proposals SET state = 'discarded'
                 WHERE generation_id = ? AND temp_id = ?",
                rusqlite::params![generation_id, temp_id],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
        Some("discarded") => {}
        Some("accepted") => {
            return Err(invalid(format!(
                "la propuesta {temp_id} ya se aceptó y no puede descartarse"
            )));
        }
        _ => {
            return Err(invalid(format!("propuesta desconocida: {temp_id}")));
        }
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Registra una generación de diseño validada con su propuesta pendiente, en
/// una transacción. Si falla, no queda rastro parcial.
pub(crate) fn save_design_generation(
    conn: &mut Connection,
    path: &Path,
    generation: &StoredDesignGeneration,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let convert = |e| StoreError::convert(path, e);
    tx.execute(
        "INSERT INTO design_generations(id, project_id, module_id, kind, model,
         template_version, input_tokens, output_tokens, total_tokens, created_at,
         target_artifact_id, target_version_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            generation.id,
            generation.project_id,
            generation.module_id,
            generation.kind,
            generation.model,
            generation.template_version,
            generation.input_tokens,
            generation.output_tokens,
            generation.total_tokens,
            generation.created_at,
            generation.target_artifact_id,
            generation.target_version_id,
        ],
    )
    .map_err(&convert)?;
    for (pos, version) in generation.context_version_ids.iter().enumerate() {
        tx.execute(
            "INSERT INTO design_context(generation_id, pos, version_id) VALUES (?, ?, ?)",
            rusqlite::params![generation.id, pos as u32, version],
        )
        .map_err(&convert)?;
    }
    for (pos, question) in generation.questions.iter().enumerate() {
        tx.execute(
            "INSERT INTO design_questions(generation_id, pos, question) VALUES (?, ?, ?)",
            rusqlite::params![generation.id, pos as u32, question],
        )
        .map_err(&convert)?;
    }
    if !matches!(generation.proposal.state, ProposalState::Pending) {
        return Err(invalid(
            "las propuestas de diseño nuevas deben estar pendientes",
        ));
    }
    tx.execute(
        "INSERT INTO design_proposals(generation_id, title, spec_json, explanation, state)
         VALUES (?, ?, ?, ?, 'pending')",
        rusqlite::params![
            generation.id,
            generation.proposal.title,
            generation.proposal.spec_json,
            generation.proposal.explanation,
        ],
    )
    .map_err(&convert)?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Aceptación atómica de diseño: reescribe el dominio (con el artefacto ya
/// creado o versionado) y marca la propuesta como aceptada en la MISMA
/// transacción. Si no está pendiente, todo se revierte.
pub(crate) fn accept_design_proposal(
    conn: &mut Connection,
    path: &Path,
    store: &Store,
    next_id: u64,
    generation_id: &str,
    artifact_id: &str,
    content: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    save_domain(&tx, path, store, next_id)?;
    let changed = tx
        .execute(
            "UPDATE design_proposals SET state = 'accepted', artifact_id = ?, accepted_content = ?
             WHERE generation_id = ? AND state = 'pending'",
            rusqlite::params![artifact_id, content, generation_id],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    if changed != 1 {
        return Err(invalid(format!(
            "la propuesta de diseño {generation_id} no está pendiente de aceptar"
        )));
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Guardado de revisión manual de diseño: dominio + disposición visual en
/// una sola transacción. Sin disposición (`None`), solo se guarda el
/// dominio; la disposición anterior de otras versiones queda intacta.
pub(crate) fn save_design_layout(
    conn: &mut Connection,
    path: &Path,
    store: &Store,
    next_id: u64,
    artifact_id: &str,
    version_id: &str,
    layout_json: Option<&str>,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    save_domain(&tx, path, store, next_id)?;
    if let Some(layout) = layout_json {
        tx.execute(
            "INSERT INTO design_layouts(artifact_id, version_id, layout_json)
             VALUES (?, ?, ?)
             ON CONFLICT(artifact_id, version_id) DO UPDATE SET layout_json = excluded.layout_json",
            rusqlite::params![artifact_id, version_id, layout],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Guarda solo una disposición, sin tocar el dominio. Sin disposición
/// (`None`), no escribe nada: equivale a "nada que guardar".
pub(crate) fn upsert_design_layout(
    conn: &mut Connection,
    path: &Path,
    artifact_id: &str,
    version_id: &str,
    layout_json: Option<&str>,
) -> Result<(), StoreError> {
    let Some(layout) = layout_json else {
        return Ok(());
    };
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    tx.execute(
        "INSERT INTO design_layouts(artifact_id, version_id, layout_json)
         VALUES (?, ?, ?)
         ON CONFLICT(artifact_id, version_id) DO UPDATE SET layout_json = excluded.layout_json",
        rusqlite::params![artifact_id, version_id, layout],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Descarta una propuesta de diseño pendiente, en una transacción.
/// Idempotente si ya estaba descartada; rechaza si ya se aceptó o no existe.
pub(crate) fn discard_design_proposal(
    conn: &mut Connection,
    path: &Path,
    generation_id: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let state: Option<String> = tx
        .query_row(
            "SELECT state FROM design_proposals WHERE generation_id = ?",
            rusqlite::params![generation_id],
            |row| row.get(0),
        )
        .ok();
    match state.as_deref() {
        Some("pending") => {
            tx.execute(
                "UPDATE design_proposals SET state = 'discarded' WHERE generation_id = ?",
                rusqlite::params![generation_id],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
        Some("discarded") => {}
        Some("accepted") => {
            return Err(invalid(format!(
                "la propuesta de diseño {generation_id} ya se aceptó y no puede descartarse"
            )));
        }
        _ => {
            return Err(invalid(format!(
                "generación de diseño desconocida: {generation_id}"
            )));
        }
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Carga y valida la instantánea completa (dominio + generaciones). No
/// escribe nada: ante cualquier problema la base queda intacta. Las bases v1
/// (sin tablas de generaciones) cargan con el registro vacío; la migración
/// posterior añade las tablas sin tocar los datos.
pub(crate) fn load(
    conn: &Connection,
    path: &Path,
) -> Result<
    (
        Store,
        u64,
        ProposalLog,
        DesignLog,
        BaselineMetaLog,
        LayoutLog,
    ),
    StoreError,
> {
    let convert = |e| StoreError::convert(path, e);
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(&convert)?;
    verify_tables(conn, path, version)?;
    // Nombres (v8): en esquemas anteriores la columna no existe y el nombre
    // es el ID (valor por defecto del constructor); la migración la añade y
    // la rellena después. Los literales NULL/0 evitan triplicar ramas.
    let mut projects = Vec::new();
    let project_select = if version >= 8 {
        "SELECT id, name FROM projects"
    } else {
        "SELECT id, NULL AS name FROM projects"
    };
    let mut rows = conn.prepare(project_select).map_err(&convert)?;
    let ids: Vec<(String, Option<String>)> = rows
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (id, name) in ids {
        let mut project = Project::new(ProjectId::new(id).map_err(core)?);
        if let Some(name) = name {
            project.set_name(Name::new(name).map_err(core)?);
        }
        projects.push(project);
    }
    // Archivado (v7): en esquemas anteriores la columna no existe y todo se
    // considera activo; la migración la añade con defecto 0 después.
    let mut modules = Vec::new();
    let module_select = if version >= 8 {
        "SELECT id, project_id, name, archived FROM modules"
    } else if version >= 7 {
        "SELECT id, project_id, NULL AS name, archived FROM modules"
    } else {
        "SELECT id, project_id, NULL AS name, 0 AS archived FROM modules"
    };
    let mut rows = conn.prepare(module_select).map_err(&convert)?;
    let rows: Vec<(String, String, Option<String>, i64)> = rows
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (id, project, name, archived) in rows {
        let module = Module::new(
            ModuleId::new(id).map_err(core)?,
            ProjectId::new(project).map_err(core)?,
        );
        let mut module = with_archived_module(module, archived)?;
        if let Some(name) = name {
            module.set_name(Name::new(name).map_err(core)?);
        }
        modules.push(module);
    }
    let mut artifacts = Vec::new();
    let artifact_select = if version >= 8 {
        "SELECT id, project_id, module_id, kind, title, archived FROM artifacts"
    } else if version >= 7 {
        "SELECT id, project_id, module_id, kind, NULL AS title, archived FROM artifacts"
    } else {
        "SELECT id, project_id, module_id, kind, NULL AS title, 0 AS archived FROM artifacts"
    };
    let mut rows = conn.prepare(artifact_select).map_err(&convert)?;
    let rows: Vec<(String, String, String, String, Option<String>, i64)> = rows
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
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (id, project, module, kind, title, archived) in rows {
        let artifact = Artifact::new(
            ArtifactId::new(id).map_err(core)?,
            ProjectId::new(project).map_err(core)?,
            ModuleId::new(module).map_err(core)?,
            parse_kind(&kind)?,
        );
        let mut artifact = with_archived_artifact(artifact, archived)?;
        // NULL = sin título propio (registros anteriores o sin titular).
        if let Some(title) = title {
            artifact.set_title(Some(Name::new(title).map_err(core)?));
        }
        artifacts.push(artifact);
    }
    let mut sources_by_version: HashMap<String, Vec<String>> = HashMap::new();
    let mut rows = conn
        .prepare("SELECT version_id, source_id FROM version_sources ORDER BY version_id, pos")
        .map_err(&convert)?;
    let rows: Vec<(String, String)> = rows
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (version, source) in rows {
        sources_by_version.entry(version).or_default().push(source);
    }
    let mut versions = Vec::new();
    let mut rows = conn
        .prepare(
            "SELECT id, artifact_id, number, content, provenance_kind, provenance_by FROM versions",
        )
        .map_err(&convert)?;
    let rows: Vec<(String, String, i64, String, String, String)> = rows
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
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (id, artifact, number, content, provenance_kind, provenance_by) in rows {
        let number = u32::try_from(number)
            .map_err(|_| invalid(format!("número de versión inválido en {id}")))?;
        let sources = sources_by_version
            .remove(&id)
            .unwrap_or_default()
            .into_iter()
            .map(VersionId::new)
            .collect::<Result<Vec<_>, _>>()
            .map_err(core)?;
        versions.push(Version::new(
            VersionId::new(id).map_err(core)?,
            ArtifactId::new(artifact).map_err(core)?,
            number,
            Content::new(content).map_err(core)?,
            parse_provenance(&provenance_kind, &provenance_by)?,
            sources,
        ));
    }
    if let Some(dangling) = sources_by_version.keys().next() {
        return Err(invalid(format!("fuentes huérfanas de {dangling}")));
    }
    let mut approvals = Vec::new();
    let mut rows = conn
        .prepare("SELECT version_id, approved_by, at FROM approvals ORDER BY pos")
        .map_err(&convert)?;
    let rows: Vec<(String, String, String)> = rows
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (version, by, at) in rows {
        approvals.push(Approval::new(
            VersionId::new(version).map_err(core)?,
            HumanId::new(by).map_err(core)?,
            Date::new(at).map_err(core)?,
        ));
    }
    let mut baselines = Vec::new();
    let mut stmt = conn
        .prepare("SELECT id, project_id, at FROM baselines")
        .map_err(&convert)?;
    let baseline_rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let mut entries_by_baseline: HashMap<String, Vec<(String, String, Option<String>)>> =
        HashMap::new();
    let entry_select = if version >= 8 {
        "SELECT baseline_id, artifact_id, version_id, title FROM baseline_entries"
    } else {
        "SELECT baseline_id, artifact_id, version_id, NULL AS title FROM baseline_entries"
    };
    let mut stmt = conn.prepare(entry_select).map_err(&convert)?;
    let entry_rows: Vec<(String, String, String, Option<String>)> = stmt
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    for (baseline, artifact, version, title) in entry_rows {
        entries_by_baseline
            .entry(baseline)
            .or_default()
            .push((artifact, version, title));
    }
    for (id, project, at) in baseline_rows {
        let mut entries = Vec::new();
        let mut titles = HashMap::new();
        for (artifact, version, title) in entries_by_baseline.remove(&id).unwrap_or_default() {
            let artifact_id = ArtifactId::new(artifact).map_err(core)?;
            // Título fijado al crear la baseline; se valida como nombre.
            let title = title
                .map(Name::new)
                .transpose()
                .map_err(core)?
                .map(|n| n.as_str().to_string());
            titles.insert(artifact_id.clone(), title);
            entries.push((artifact_id, VersionId::new(version).map_err(core)?));
        }
        baselines.push(Baseline::new(
            BaselineId::new(id).map_err(core)?,
            ProjectId::new(project).map_err(core)?,
            entries,
            titles,
            Date::new(at).map_err(core)?,
        ));
    }
    // Historial de títulos (v8): en esquemas anteriores la tabla no existe.
    let mut title_history = Vec::new();
    if version >= 8 {
        let mut stmt = conn
            .prepare("SELECT artifact_id, title, changed_by, at FROM title_history ORDER BY pos")
            .map_err(&convert)?;
        let rows: Vec<(String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (artifact, title, by, at) in rows {
            title_history.push(TitleChange::new(
                ArtifactId::new(artifact).map_err(core)?,
                Name::new(title).map_err(core)?,
                HumanId::new(by).map_err(core)?,
                Date::new(at).map_err(core)?,
            ));
        }
    }
    // Entregas de trabajo (v9): las tablas no existen en esquemas
    // anteriores (sin entregas que conservar).
    // Fila de `work_deliveries`: id, proyecto, nombre, descripción, alcance, fecha.
    type DeliveryRow = (
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    );
    let mut deliveries = Vec::new();
    if version >= 9 {
        let mut stmt = conn
            .prepare(
                "SELECT id, project_id, name, description, scope_module, at FROM work_deliveries",
            )
            .map_err(&convert)?;
        let delivery_rows: Vec<DeliveryRow> = stmt
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
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        let mut entries_by_delivery: HashMap<String, Vec<(String, String, Option<String>)>> =
            HashMap::new();
        let mut stmt = conn
            .prepare(
                "SELECT delivery_id, artifact_id, version_id, title FROM work_delivery_entries",
            )
            .map_err(&convert)?;
        let entry_rows: Vec<(String, String, String, Option<String>)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (delivery, artifact, version, title) in entry_rows {
            entries_by_delivery
                .entry(delivery)
                .or_default()
                .push((artifact, version, title));
        }
        for (id, project, name, description, scope, at) in delivery_rows {
            let mut entries = Vec::new();
            let mut titles = HashMap::new();
            for (artifact, version, title) in entries_by_delivery.remove(&id).unwrap_or_default() {
                let artifact_id = ArtifactId::new(artifact).map_err(core)?;
                let title = title
                    .map(Name::new)
                    .transpose()
                    .map_err(core)?
                    .map(|n| n.as_str().to_string());
                titles.insert(artifact_id.clone(), title);
                entries.push((artifact_id, VersionId::new(version).map_err(core)?));
            }
            let scope = scope.map(ModuleId::new).transpose().map_err(core)?;
            deliveries.push(WorkDelivery::new(
                DeliveryId::new(id).map_err(core)?,
                ProjectId::new(project).map_err(core)?,
                name,
                description,
                scope,
                entries,
                titles,
                Date::new(at).map_err(core)?,
            ));
        }
    }
    let next_id: String = conn
        .query_row("SELECT value FROM meta WHERE key = 'next_id'", [], |row| {
            row.get(0)
        })
        .map_err(|_| invalid("falta el contador de identificadores"))?;
    let next_id: u64 = next_id
        .parse()
        .map_err(|_| invalid("contador de identificadores inválido"))?;
    let store = Store::reconstitute(Snapshot {
        projects,
        modules,
        artifacts,
        versions,
        approvals,
        baselines,
        title_history,
        deliveries,
    })
    .map_err(core)?;
    let proposals = if version >= 2 {
        load_proposals(conn, path, &store)?
    } else {
        ProposalLog::new()
    };
    let designs = if version >= 3 {
        load_designs(conn, path, &store, version)?
    } else {
        DesignLog::new()
    };
    let baseline_meta = if version >= 5 {
        load_baseline_meta(conn, path, &store)?
    } else {
        BaselineMetaLog::new()
    };
    let layouts = if version >= 6 {
        load_layouts(conn, path)?
    } else {
        LayoutLog::new()
    };
    Ok((store, next_id, proposals, designs, baseline_meta, layouts))
}

/// Todas las tablas esperadas existen; si no, la base está manipulada. Las
/// tablas de generaciones solo se exigen desde la v2, las de diseño desde
/// la v3 y los metadatos de baselines desde la v5.
fn verify_tables(conn: &Connection, path: &Path, version: i64) -> Result<(), StoreError> {
    const EXPECTED_V1: [&str; 9] = [
        "projects",
        "modules",
        "artifacts",
        "versions",
        "version_sources",
        "approvals",
        "baselines",
        "baseline_entries",
        "meta",
    ];
    const EXPECTED_V2: [&str; 6] = [
        "generations",
        "generation_context",
        "generation_questions",
        "proposals",
        "proposal_acceptance",
        "proposal_assumptions",
    ];
    const EXPECTED_V3: [&str; 4] = [
        "design_generations",
        "design_context",
        "design_questions",
        "design_proposals",
    ];
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .map_err(|e| StoreError::convert(path, e))?;
    let found: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| StoreError::convert(path, e))?
        .collect::<Result<_, _>>()
        .map_err(|e| StoreError::convert(path, e))?;
    for table in EXPECTED_V1 {
        if !found.iter().any(|name| name == table) {
            return Err(StoreError::Corrupt {
                message: format!("falta la tabla {table}"),
            });
        }
    }
    if version >= 2 {
        for table in EXPECTED_V2 {
            if !found.iter().any(|name| name == table) {
                return Err(StoreError::Corrupt {
                    message: format!("falta la tabla {table}"),
                });
            }
        }
    }
    if version >= 3 {
        for table in EXPECTED_V3 {
            if !found.iter().any(|name| name == table) {
                return Err(StoreError::Corrupt {
                    message: format!("falta la tabla {table}"),
                });
            }
        }
    }
    if version >= 4 {
        let mut stmt = conn
            .prepare("PRAGMA table_info(design_generations)")
            .map_err(|e| StoreError::convert(path, e))?;
        let columns: Vec<String> = stmt
            .query_map([], |row| row.get(1))
            .map_err(|e| StoreError::convert(path, e))?
            .collect::<Result<_, _>>()
            .map_err(|e| StoreError::convert(path, e))?;
        for column in ["target_artifact_id", "target_version_id"] {
            if !columns.iter().any(|name| name == column) {
                return Err(StoreError::Corrupt {
                    message: format!("falta la columna {column}"),
                });
            }
        }
    }
    if version >= 5 && !found.iter().any(|name| name == "baseline_meta") {
        return Err(StoreError::Corrupt {
            message: "falta la tabla baseline_meta".to_string(),
        });
    }
    if version >= 6 && !found.iter().any(|name| name == "design_layouts") {
        return Err(StoreError::Corrupt {
            message: "falta la tabla design_layouts".to_string(),
        });
    }
    if version >= 7 {
        for table in ["modules", "artifacts"] {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|e| StoreError::convert(path, e))?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get(1))
                .map_err(|e| StoreError::convert(path, e))?
                .collect::<Result<_, _>>()
                .map_err(|e| StoreError::convert(path, e))?;
            if !columns.iter().any(|name| name == "archived") {
                return Err(StoreError::Corrupt {
                    message: format!("falta la columna archived en {table}"),
                });
            }
        }
    }
    if version >= 8 {
        for (table, column) in [
            ("projects", "name"),
            ("modules", "name"),
            ("artifacts", "title"),
            ("baseline_entries", "title"),
        ] {
            let mut stmt = conn
                .prepare(&format!("PRAGMA table_info({table})"))
                .map_err(|e| StoreError::convert(path, e))?;
            let columns: Vec<String> = stmt
                .query_map([], |row| row.get(1))
                .map_err(|e| StoreError::convert(path, e))?
                .collect::<Result<_, _>>()
                .map_err(|e| StoreError::convert(path, e))?;
            if !columns.iter().any(|name| name == column) {
                return Err(StoreError::Corrupt {
                    message: format!("falta la columna {column} en {table}"),
                });
            }
        }
        if !found.iter().any(|name| name == "title_history") {
            return Err(StoreError::Corrupt {
                message: "falta la tabla title_history".to_string(),
            });
        }
    }
    if version >= 9 {
        for table in ["work_deliveries", "work_delivery_entries"] {
            if !found.iter().any(|name| name == table) {
                return Err(StoreError::Corrupt {
                    message: format!("falta la tabla {table}"),
                });
            }
        }
    }
    Ok(())
}

/// Carga las generaciones con sus propuestas y verifica su integridad contra
/// el dominio (proyecto, módulo y artefacto aceptado existentes). Las
/// referencias a versiones de contexto no se exigen: si una fuente cambió o
/// falta, la generación se marca desactualizada al consultar, no al cargar.
/// Fila de `generations`: identidad, proyecto, módulo, modelo, descripción,
/// plantilla, uso (3) y fecha.
type GenerationRow = (
    String,
    String,
    String,
    String,
    String,
    i64,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    String,
);

/// Fila de `proposals`: generación, temporal, título, descripción, estado y
/// aceptación (2).
type ProposalRow = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

fn load_proposals(
    conn: &Connection,
    path: &Path,
    store: &Store,
) -> Result<ProposalLog, StoreError> {
    let convert = |e| StoreError::convert(path, e);
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, module_id, model, description, template_version,
             input_tokens, output_tokens, total_tokens, created_at
             FROM generations ORDER BY rowid",
        )
        .map_err(&convert)?;
    let rows: Vec<GenerationRow> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let context = load_ordered(conn, &convert, "generation_context", "version_id")?;
    let questions = load_ordered(conn, &convert, "generation_questions", "question")?;
    let acceptance = load_proposal_items(conn, &convert, "proposal_acceptance")?;
    let assumptions = load_proposal_items(conn, &convert, "proposal_assumptions")?;
    let mut stmt = conn
        .prepare(
            "SELECT generation_id, temp_id, title, description, state, artifact_id, accepted_content
             FROM proposals ORDER BY generation_id, rowid",
        )
        .map_err(&convert)?;
    let proposal_rows: Vec<ProposalRow> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let mut by_generation: HashMap<String, Vec<StoredProposal>> = HashMap::new();
    for (generation_id, temp_id, title, description, state, artifact_id, accepted_content) in
        proposal_rows
    {
        let state = match (state.as_str(), artifact_id, accepted_content) {
            ("pending", None, None) => ProposalState::Pending,
            ("discarded", None, None) => ProposalState::Discarded,
            ("accepted", Some(artifact), Some(content)) => ProposalState::Accepted {
                artifact_id: artifact,
                content,
            },
            (other, _, _) => {
                return Err(invalid(format!(
                    "estado de propuesta inválido: {other} en {temp_id}"
                )));
            }
        };
        let key = (generation_id.clone(), temp_id.clone());
        by_generation
            .entry(generation_id)
            .or_default()
            .push(StoredProposal {
                temp_id,
                title,
                description,
                acceptance: acceptance.get(&key).cloned().unwrap_or_default(),
                assumptions: assumptions.get(&key).cloned().unwrap_or_default(),
                state,
            });
    }
    let mut log = ProposalLog::new();
    for (
        id,
        project_id,
        module_id,
        model,
        description,
        template_version,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at,
    ) in rows
    {
        let template_version = u32::try_from(template_version)
            .map_err(|_| invalid(format!("plantilla inválida en {id}")))?;
        let generation = StoredGeneration {
            id: id.clone(),
            project_id,
            module_id,
            model,
            description,
            context_version_ids: context.get(&id).cloned().unwrap_or_default(),
            template_version,
            input_tokens: opt_u32(input_tokens, &id)?,
            output_tokens: opt_u32(output_tokens, &id)?,
            total_tokens: opt_u32(total_tokens, &id)?,
            created_at,
            questions: questions.get(&id).cloned().unwrap_or_default(),
            proposals: by_generation.remove(&id).unwrap_or_default(),
        };
        verify_generation_refs(store, &generation)?;
        log.record(generation)?;
    }
    if let Some(dangling) = by_generation.keys().next() {
        return Err(invalid(format!("propuestas huérfanas de {dangling}")));
    }
    Ok(log)
}

/// La generación apunta a proyecto y módulo existentes, y cada propuesta
/// aceptada a un artefacto existente. Sin estas FK en SQL (ver esquema v2),
/// la carga es quien lo exige.
fn verify_generation_refs(store: &Store, generation: &StoredGeneration) -> Result<(), StoreError> {
    let project = ProjectId::new(generation.project_id.clone()).map_err(core)?;
    let module = ModuleId::new(generation.module_id.clone()).map_err(core)?;
    if store.project(&project).is_none() {
        return Err(invalid(format!(
            "la generación {} apunta a un proyecto inexistente",
            generation.id
        )));
    }
    if store.module(&module).is_none() {
        return Err(invalid(format!(
            "la generación {} apunta a un módulo inexistente",
            generation.id
        )));
    }
    for proposal in &generation.proposals {
        if let ProposalState::Accepted { artifact_id, .. } = &proposal.state {
            let artifact = ArtifactId::new(artifact_id.clone()).map_err(core)?;
            if store.artifact(&artifact).is_none() {
                return Err(invalid(format!(
                    "la propuesta {} aceptó un artefacto inexistente",
                    proposal.temp_id
                )));
            }
        }
    }
    Ok(())
}

/// Fila de `design_generations`: identidad, proyecto, módulo, tipo, modelo,
/// plantilla, uso (3) y fecha.
type DesignRow = (
    String,
    String,
    String,
    String,
    String,
    i64,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    String,
);

/// Fila de `design_proposals`: generación, título, especificación,
/// explicación, estado y aceptación (2).
type DesignProposalRow = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
);

/// Carga las generaciones de diseño y verifica su integridad contra el
/// dominio. Como en propuestas, el contexto no se exige versión a versión.
/// Las columnas de objetivo (v4) se leen aparte: en v3 no existen y quedan
/// a nulo (la migración las añade después de cargar).
fn load_designs(
    conn: &Connection,
    path: &Path,
    store: &Store,
    version: i64,
) -> Result<DesignLog, StoreError> {
    let convert = |e| StoreError::convert(path, e);
    let mut targets: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    if version >= 4 {
        let mut stmt = conn
            .prepare("SELECT id, target_artifact_id, target_version_id FROM design_generations")
            .map_err(&convert)?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(&convert)?
            .collect::<Result<Vec<(String, Option<String>, Option<String>)>, _>>()
            .map_err(&convert)?;
        for (id, artifact, target_version) in rows {
            targets.insert(id, (artifact, target_version));
        }
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, module_id, kind, model, template_version,
             input_tokens, output_tokens, total_tokens, created_at
             FROM design_generations ORDER BY rowid",
        )
        .map_err(&convert)?;
    let rows: Vec<DesignRow> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
                row.get(7)?,
                row.get(8)?,
                row.get(9)?,
            ))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let context = load_ordered(conn, &convert, "design_context", "version_id")?;
    let questions = load_ordered(conn, &convert, "design_questions", "question")?;
    let mut stmt = conn
        .prepare(
            "SELECT generation_id, title, spec_json, explanation, state, artifact_id, accepted_content
             FROM design_proposals ORDER BY generation_id, rowid",
        )
        .map_err(&convert)?;
    let proposal_rows: Vec<DesignProposalRow> = stmt
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
                row.get(5)?,
                row.get(6)?,
            ))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let mut by_generation: HashMap<String, StoredDesignProposal> = HashMap::new();
    for (generation_id, title, spec_json, explanation, state, artifact_id, accepted_content) in
        proposal_rows
    {
        let state = match (state.as_str(), artifact_id, accepted_content) {
            ("pending", None, None) => ProposalState::Pending,
            ("discarded", None, None) => ProposalState::Discarded,
            ("accepted", Some(artifact), Some(content)) => ProposalState::Accepted {
                artifact_id: artifact,
                content,
            },
            (other, _, _) => {
                return Err(invalid(format!(
                    "estado de propuesta de diseño inválido: {other} en {generation_id}"
                )));
            }
        };
        if by_generation
            .insert(
                generation_id.clone(),
                StoredDesignProposal {
                    title,
                    spec_json,
                    explanation,
                    state,
                },
            )
            .is_some()
        {
            return Err(invalid(format!(
                "propuesta de diseño duplicada en {generation_id}"
            )));
        }
    }
    let mut log = DesignLog::new();
    for (
        id,
        project_id,
        module_id,
        kind,
        model,
        template_version,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at,
    ) in rows
    {
        let template_version = u32::try_from(template_version)
            .map_err(|_| invalid(format!("plantilla inválida en {id}")))?;
        let proposal = by_generation
            .remove(&id)
            .ok_or_else(|| invalid(format!("generación de diseño {id} sin propuesta")))?;
        let (target_artifact_id, target_version_id) = targets.remove(&id).unwrap_or((None, None));
        let generation = StoredDesignGeneration {
            id: id.clone(),
            project_id,
            module_id,
            kind,
            model,
            context_version_ids: context.get(&id).cloned().unwrap_or_default(),
            template_version,
            input_tokens: opt_u32(input_tokens, &id)?,
            output_tokens: opt_u32(output_tokens, &id)?,
            total_tokens: opt_u32(total_tokens, &id)?,
            created_at,
            questions: questions.get(&id).cloned().unwrap_or_default(),
            proposal,
            target_artifact_id,
            target_version_id,
        };
        verify_design_refs(store, &generation)?;
        log.record(generation)?;
    }
    if let Some(dangling) = by_generation.keys().next() {
        return Err(invalid(format!(
            "propuesta de diseño huérfana de {dangling}"
        )));
    }
    Ok(log)
}

/// La generación de diseño apunta a proyecto y módulo existentes, y su
/// propuesta aceptada a un artefacto existente.
fn verify_design_refs(
    store: &Store,
    generation: &StoredDesignGeneration,
) -> Result<(), StoreError> {
    let project = ProjectId::new(generation.project_id.clone()).map_err(core)?;
    let module = ModuleId::new(generation.module_id.clone()).map_err(core)?;
    if store.project(&project).is_none() {
        return Err(invalid(format!(
            "la generación de diseño {} apunta a un proyecto inexistente",
            generation.id
        )));
    }
    if store.module(&module).is_none() {
        return Err(invalid(format!(
            "la generación de diseño {} apunta a un módulo inexistente",
            generation.id
        )));
    }
    if let ProposalState::Accepted { artifact_id, .. } = &generation.proposal.state {
        let artifact = ArtifactId::new(artifact_id.clone()).map_err(core)?;
        if store.artifact(&artifact).is_none() {
            return Err(invalid(format!(
                "la propuesta de diseño {} aceptó un artefacto inexistente",
                generation.id
            )));
        }
    }
    match (
        generation.target_artifact_id.as_deref(),
        generation.target_version_id.as_deref(),
    ) {
        (None, None) => {}
        (Some(artifact), Some(target_version)) => {
            let artifact = ArtifactId::new(artifact).map_err(core)?;
            let target_version = VersionId::new(target_version).map_err(core)?;
            if store.artifact(&artifact).is_none() || store.version(&target_version).is_none() {
                return Err(invalid(format!(
                    "la propuesta de diseño {} apunta a un objetivo inexistente",
                    generation.id
                )));
            }
        }
        _ => {
            return Err(invalid(format!(
                "la propuesta de diseño {} fija medio objetivo",
                generation.id
            )));
        }
    }
    Ok(())
}

/// Carga los metadatos de baselines y verifica que cada uno apunta a una
/// baseline existente del dominio. Solo se llama desde la v5.
fn load_baseline_meta(
    conn: &Connection,
    path: &Path,
    store: &Store,
) -> Result<BaselineMetaLog, StoreError> {
    let convert = |e| StoreError::convert(path, e);
    let mut stmt = conn
        .prepare(
            "SELECT baseline_id, name, description, scope_module, created_at
             FROM baseline_meta ORDER BY rowid",
        )
        .map_err(&convert)?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BaselineMeta {
                baseline_id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                scope_module: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(&convert)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(&convert)?;
    let mut log = BaselineMetaLog::new();
    for meta in rows {
        let id = ruth_core::domain::BaselineId::new(meta.baseline_id.clone()).map_err(core)?;
        if store.baseline(&id).is_none() {
            return Err(invalid(format!(
                "los metadatos {} apuntan a una baseline inexistente",
                meta.baseline_id
            )));
        }
        if let Some(scope) = &meta.scope_module {
            let module = ModuleId::new(scope.clone()).map_err(core)?;
            if store.module(&module).is_none() {
                return Err(invalid(format!(
                    "los metadatos {} apuntan a un módulo inexistente",
                    meta.baseline_id
                )));
            }
        }
        log.record(meta).map_err(|e| match e {
            StoreError::InvalidData { message } => invalid(message),
            other => other,
        })?;
    }
    Ok(log)
}

/// Carga las disposiciones visuales guardadas. No se verifican contra el
/// dominio (es presentación): se rehidratan verbatim y se interpretan al
/// leer; una fila ilegible equivale a "sin disposición" sin romper la carga.
fn load_layouts(conn: &Connection, path: &Path) -> Result<LayoutLog, StoreError> {
    let convert = |e| StoreError::convert(path, e);
    let mut stmt = conn
        .prepare("SELECT artifact_id, version_id, layout_json FROM design_layouts ORDER BY rowid")
        .map_err(&convert)?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let mut log = LayoutLog::new();
    for (artifact_id, version_id, layout_json) in rows {
        log.rehydrate(artifact_id, version_id, layout_json);
    }
    Ok(log)
}

/// Creación atómica: dominio (con la baseline) y sus metadatos en una sola
/// transacción. O se guarda todo o no se guarda nada.
pub(crate) fn create_baseline(
    conn: &mut Connection,
    path: &Path,
    store: &Store,
    next_id: u64,
    meta: &BaselineMeta,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    save_domain(&tx, path, store, next_id)?;
    tx.execute(
        "INSERT INTO baseline_meta(baseline_id, name, description, scope_module, created_at)
         VALUES (?, ?, ?, ?, ?)",
        rusqlite::params![
            meta.baseline_id,
            meta.name,
            meta.description,
            meta.scope_module,
            meta.created_at,
        ],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

fn opt_u32(value: Option<i64>, id: &str) -> Result<Option<u32>, StoreError> {
    value
        .map(|n| u32::try_from(n).map_err(|_| invalid(format!("uso de tokens inválido en {id}"))))
        .transpose()
}

fn load_ordered(
    conn: &Connection,
    convert: &dyn Fn(rusqlite::Error) -> StoreError,
    table: &str,
    column: &str,
) -> Result<HashMap<String, Vec<String>>, StoreError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT generation_id, {column} FROM {table} ORDER BY generation_id, pos"
        ))
        .map_err(convert)?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(convert)?
        .collect::<Result<_, _>>()
        .map_err(convert)?;
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for (generation, value) in rows {
        map.entry(generation).or_default().push(value);
    }
    Ok(map)
}

fn load_proposal_items(
    conn: &Connection,
    convert: &dyn Fn(rusqlite::Error) -> StoreError,
    table: &str,
) -> Result<HashMap<(String, String), Vec<String>>, StoreError> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT generation_id, temp_id, item FROM {table}
             ORDER BY generation_id, temp_id, pos"
        ))
        .map_err(convert)?;
    let rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(convert)?
        .collect::<Result<_, _>>()
        .map_err(convert)?;
    let mut map: HashMap<(String, String), Vec<String>> = HashMap::new();
    for (generation, temp, item) in rows {
        map.entry((generation, temp)).or_default().push(item);
    }
    Ok(map)
}

/// Aplica el flag leído (0/1); otro valor es manipulación.
fn with_archived_module(mut module: Module, archived: i64) -> Result<Module, StoreError> {
    match archived {
        0 => Ok(module),
        1 => {
            module.set_archived(true);
            Ok(module)
        }
        other => Err(invalid(format!(
            "flag de archivado inválido en {}: {other}",
            module.id().as_str()
        ))),
    }
}

fn with_archived_artifact(mut artifact: Artifact, archived: i64) -> Result<Artifact, StoreError> {
    match archived {
        0 => Ok(artifact),
        1 => {
            artifact.set_archived(true);
            Ok(artifact)
        }
        other => Err(invalid(format!(
            "flag de archivado inválido en {}: {other}",
            artifact.id().as_str()
        ))),
    }
}

fn artifact_kind(kind: ArtifactType) -> &'static str {
    match kind {
        ArtifactType::Requirement => "requirement",
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => "mockup",
    }
}

fn parse_kind(kind: &str) -> Result<ArtifactType, StoreError> {
    match kind {
        "requirement" => Ok(ArtifactType::Requirement),
        "flow" => Ok(ArtifactType::Flow),
        "data_model" => Ok(ArtifactType::DataModel),
        "mockup" => Ok(ArtifactType::Mockup),
        other => Err(invalid(format!("tipo de artefacto desconocido: {other}"))),
    }
}

fn provenance_parts(provenance: &ruth_core::domain::Provenance) -> (&'static str, &str) {
    match provenance {
        ruth_core::domain::Provenance::Human(human) => ("human", human.as_str()),
        ruth_core::domain::Provenance::AiProposal { agent } => ("ai", agent.as_str()),
    }
}

fn parse_provenance(kind: &str, by: &str) -> Result<ruth_core::domain::Provenance, StoreError> {
    use ruth_core::domain::{AgentId, Provenance};
    match kind {
        "human" => Ok(Provenance::Human(
            HumanId::new(by.to_string()).map_err(core)?,
        )),
        "ai" => Ok(Provenance::AiProposal {
            agent: AgentId::new(by.to_string()).map_err(core)?,
        }),
        other => Err(invalid(format!("procedencia desconocida: {other}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_store() -> Store {
        let mut store = Store::new();
        let project = ProjectId::new("proj-1").expect("id");
        let module = ModuleId::new("mod-1").expect("id");
        let artifact = ArtifactId::new("req-1").expect("id");
        let version = VersionId::new("req-1-v1").expect("id");
        let ana = HumanId::new("ana").expect("id");
        store.create_project(project.clone()).expect("proyecto");
        store
            .create_module(&project, module.clone())
            .expect("módulo");
        store
            .create_artifact(
                &project,
                &module,
                artifact.clone(),
                ArtifactType::Requirement,
            )
            .expect("requisito");
        store
            .create_version(
                &project,
                &artifact,
                None,
                version.clone(),
                Content::new("Texto.").expect("contenido"),
                &ruth_core::domain::Author::Human(ana.clone()),
                &[],
            )
            .expect("v1");
        store
            .approve(
                &project,
                &artifact,
                &version,
                &ruth_core::domain::Author::Human(ana),
                Date::new("2026-10-28T12:00:00Z").expect("fecha"),
            )
            .expect("aprobar");
        store
            .create_baseline(
                &project,
                BaselineId::new("base-1").expect("id"),
                &[(artifact, version)],
                Date::new("2026-10-28T12:00:00Z").expect("fecha"),
            )
            .expect("baseline");
        store
    }

    fn counts(conn: &Connection) -> Vec<(String, i64)> {
        [
            "projects",
            "modules",
            "artifacts",
            "baselines",
            "baseline_entries",
            "approvals",
        ]
        .iter()
        .map(|table| {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .expect("contar");
            (table.to_string(), n)
        })
        .collect()
    }

    #[test]
    fn save_domain_rolls_back_on_mid_save_error() {
        // Un fallo SQL a mitad del guardado (tras varios DELETE e INSERT ya
        // ejecutados) revierte la transacción: la instantánea anterior queda
        // intacta. Es la garantía que `save` promete en su contrato.
        let path = std::env::temp_dir().join(format!("ruth-rollback-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let mut conn = crate::schema::open(&path).expect("abrir");
        crate::schema::migrate(&mut conn, &path, true).expect("migrar");
        let store = tiny_store();
        save(&mut conn, &path, &store, 7).expect("guardar");
        let before = counts(&conn);
        assert_eq!(before.iter().map(|(_, n)| n).sum::<i64>(), 6);
        // Sabotaje confirmado con la misma conexión: quitar una tabla que el
        // guardado toca después de varios borrados ya ejecutados. Las FK se
        // desactivan solo para el sabotaje y se reactivan después.
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF; DROP TABLE versions; PRAGMA foreign_keys = ON;",
        )
        .expect("sabotaje");
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .expect("tx");
        let err = save_domain(&tx, &path, &store, 8).expect_err("el guardado falla");
        assert!(matches!(err, StoreError::Sqlite { .. }), "era {err:?}");
        drop(tx);
        assert_eq!(counts(&conn), before, "nada a medias en disco");
        let next: String = conn
            .query_row("SELECT value FROM meta WHERE key = 'next_id'", [], |row| {
                row.get(0)
            })
            .expect("contador");
        assert_eq!(next, "7");
        let _ = std::fs::remove_file(&path);
    }
}
