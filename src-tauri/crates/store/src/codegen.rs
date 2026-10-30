//! Code-generation log and its proposed files.
//!
//! Each generation keeps identity, project and module, ONE origin
//! (requirement with artifact + exact version, OR mockup screen with
//! mockup + screen + exact version and its cited sources), the model,
//! the template, the usage and the explanation; its scope (root, path
//! and fingerprint at generation time), assumptions, questions and the
//! proposed files with their COMPLETE content and per-file state
//! (pending, accepted with date, or discarded). Accepting writes to
//! disk (see `ruth-api`); only the state is recorded here.
//!
//! Staleness is computed in `ruth-api`, not stored. No keys, headers
//! or raw responses are saved. Scope roots tolerate dangling (removing
//! a folder does not delete historic proposals; accepting shows it
//! as missing instead of breaking).

use std::collections::HashMap;

use rusqlite::{Connection, TransactionBehavior};

use ruth_core::application::Store;
use ruth_core::domain::{ModuleId, ProjectId};

use crate::error::StoreError;

/// Defensive per-proposal file cap in the log (the api validates the
/// real cap; only the absurd is avoided here).
pub const MAX_CODEGEN_FILES: usize = 8;

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

fn core(err: ruth_core::domain::CoreError) -> StoreError {
    StoreError::InvalidData {
        message: err.to_string(),
    }
}

/// Scope file at generation time (read fingerprint).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeScopeEntry {
    pub root_id: String,
    pub rel: String,
    pub fingerprint: String,
}

/// A proposed file state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodeFileState {
    Pending,
    Accepted,
    Discarded,
}

impl CodeFileState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Accepted => "accepted",
            Self::Discarded => "discarded",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "pending" => Some(Self::Pending),
            "accepted" => Some(Self::Accepted),
            "discarded" => Some(Self::Discarded),
            _ => None,
        }
    }
}

/// Proposed file with its full content and its state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredProposalFile {
    pub pos: u32,
    pub root_id: String,
    pub rel: String,
    /// `create` or `modify`.
    pub operation: String,
    /// File fingerprint at generation (`modify`); null on `create`.
    pub expected_fingerprint: Option<String>,
    pub content: String,
    pub state: CodeFileState,
    pub decided_at: Option<String>,
}

/// Source requirement cited by the origin screen, at its exact version.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScreenSourceRef {
    pub artifact_id: String,
    pub version_id: String,
}

/// Registered code generation, linked to its original context.
/// The origin is requirement OR screen, never both nor neither: the
/// absent-origin fields travel empty (migration v14 leaves NULL on
/// older rows and loading reads it as absent).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCodeGeneration {
    pub id: String,
    pub project_id: String,
    pub module_id: String,
    pub requirement_artifact_id: String,
    pub requirement_version_id: String,
    pub screen_artifact_id: String,
    pub screen_id: String,
    pub screen_version_id: String,
    pub screen_sources: Vec<ScreenSourceRef>,
    pub model: String,
    pub template_version: u32,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
    pub explanation: String,
    pub scope: Vec<CodeScopeEntry>,
    pub assumptions: Vec<String>,
    pub questions: Vec<String>,
    pub files: Vec<StoredProposalFile>,
}

impl StoredCodeGeneration {
    /// Screen origin (versus requirement origin).
    pub fn is_screen_sourced(&self) -> bool {
        !self.screen_artifact_id.trim().is_empty()
    }
}

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodeGenLog {
    generations: Vec<StoredCodeGeneration>,
}

impl CodeGenLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records a generation (newly validated or rehydrated). Requires
    /// a unique identity, ONE origin (requirement or screen, neither both
    /// nor neither), at least one proposed file and known operations,
    /// with unique ordered positions.
    pub fn record(&mut self, generation: StoredCodeGeneration) -> Result<(), StoreError> {
        if generation.id.trim().is_empty() {
            return Err(invalid("the code generation has no identity"));
        }
        let has_requirement = !generation.requirement_artifact_id.trim().is_empty();
        let has_screen = generation.is_screen_sourced();
        if has_requirement == has_screen {
            return Err(invalid(format!(
                "ambiguous origin in {}: requirement or screen, neither both nor neither",
                generation.id
            )));
        }
        if has_screen
            && (generation.screen_id.trim().is_empty()
                || generation.screen_version_id.trim().is_empty())
        {
            return Err(invalid(format!(
                "incomplete origin screen in {}",
                generation.id
            )));
        }
        if self.generations.iter().any(|g| g.id == generation.id) {
            return Err(invalid(format!(
                "duplicate code generation: {}",
                generation.id
            )));
        }
        if generation.files.is_empty() || generation.files.len() > MAX_CODEGEN_FILES {
            return Err(invalid("the code proposal brings an invalid file count"));
        }
        let mut last_pos: Option<u32> = None;
        for file in &generation.files {
            if file.operation != "create" && file.operation != "modify" {
                return Err(invalid(format!(
                    "unknown operation in {}: {}",
                    generation.id, file.operation
                )));
            }
            if file.root_id.trim().is_empty() || file.rel.trim().is_empty() {
                return Err(invalid(format!("file without a path in {}", generation.id)));
            }
            match last_pos {
                Some(prev) if file.pos <= prev => {
                    return Err(invalid(format!(
                        "unordered file positions in {}",
                        generation.id
                    )));
                }
                _ => last_pos = Some(file.pos),
            }
        }
        self.generations.push(generation);
        Ok(())
    }

    /// All generations, in registration order. Read-only.
    pub fn all(&self) -> &[StoredCodeGeneration] {
        &self.generations
    }

    pub fn get(&self, id: &str) -> Option<&StoredCodeGeneration> {
        self.generations.iter().find(|g| g.id == id)
    }

    fn get_mut(&mut self, id: &str) -> Result<&mut StoredCodeGeneration, StoreError> {
        self.generations
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| invalid(format!("unknown code generation: {id}")))
    }

    /// A module code generations, in registration order.
    pub fn of_module(&self, module_id: &str) -> Vec<&StoredCodeGeneration> {
        self.generations
            .iter()
            .filter(|g| g.module_id == module_id)
            .collect()
    }

    fn file_mut(
        &mut self,
        generation_id: &str,
        pos: u32,
    ) -> Result<&mut StoredProposalFile, StoreError> {
        self.get_mut(generation_id)?
            .files
            .iter_mut()
            .find(|f| f.pos == pos)
            .ok_or_else(|| invalid(format!("unknown file {pos} in {generation_id}")))
    }

    /// Current state of a proposed file (for idempotency).
    pub fn file_state(&self, generation_id: &str, pos: u32) -> Option<CodeFileState> {
        self.get(generation_id)?
            .files
            .iter()
            .find(|f| f.pos == pos)
            .map(|f| f.state)
    }

    /// Marks a file accepted. Only from pending; if already accepted it
    /// is idempotent (safe retry after writing).
    pub fn mark_file_accepted(
        &mut self,
        generation_id: &str,
        pos: u32,
        decided_at: &str,
    ) -> Result<(), StoreError> {
        let file = self.file_mut(generation_id, pos)?;
        match file.state {
            CodeFileState::Pending => {
                file.state = CodeFileState::Accepted;
                file.decided_at = Some(decided_at.to_string());
                Ok(())
            }
            CodeFileState::Accepted => Ok(()),
            CodeFileState::Discarded => Err(invalid(format!(
                "file {pos} of {generation_id} is discarded and cannot be accepted"
            ))),
        }
    }

    /// Marks a file discarded. Idempotent.
    pub fn mark_file_discarded(
        &mut self,
        generation_id: &str,
        pos: u32,
        decided_at: &str,
    ) -> Result<(), StoreError> {
        let file = self.file_mut(generation_id, pos)?;
        match file.state {
            CodeFileState::Pending | CodeFileState::Discarded => {
                file.state = CodeFileState::Discarded;
                file.decided_at = Some(decided_at.to_string());
                Ok(())
            }
            CodeFileState::Accepted => Err(invalid(format!(
                "file {pos} of {generation_id} was already accepted and cannot be discarded"
            ))),
        }
    }
}

fn opt_u32(value: Option<i64>, id: &str) -> Result<Option<u32>, StoreError> {
    value
        .map(|n| u32::try_from(n).map_err(|_| invalid(format!("invalid usage in {id}"))))
        .transpose()
}

/// Records a validated generation with its pending files, in one
/// transaction. On failure, no partial trace remains.
pub(crate) fn save_code_generation(
    conn: &mut Connection,
    path: &std::path::Path,
    generation: &StoredCodeGeneration,
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let convert = |e| StoreError::convert(path, e);
    tx.execute(
        "INSERT INTO code_generations(id, project_id, module_id, requirement_artifact_id,
         requirement_version_id, screen_artifact_id, screen_id, screen_version_id,
         model, template_version, input_tokens, output_tokens,
         total_tokens, created_at, explanation)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            generation.id,
            generation.project_id,
            generation.module_id,
            generation.requirement_artifact_id,
            generation.requirement_version_id,
            generation.screen_artifact_id,
            generation.screen_id,
            generation.screen_version_id,
            generation.model,
            generation.template_version,
            generation.input_tokens,
            generation.output_tokens,
            generation.total_tokens,
            generation.created_at,
            generation.explanation,
        ],
    )
    .map_err(&convert)?;
    for (pos, source) in generation.screen_sources.iter().enumerate() {
        tx.execute(
            "INSERT INTO code_gen_screen_sources(generation_id, pos, artifact_id, version_id)
             VALUES (?, ?, ?, ?)",
            rusqlite::params![
                generation.id,
                pos as u32,
                source.artifact_id,
                source.version_id,
            ],
        )
        .map_err(&convert)?;
    }
    for (pos, entry) in generation.scope.iter().enumerate() {
        tx.execute(
            "INSERT INTO code_gen_scope(generation_id, pos, root_id, rel, fingerprint)
             VALUES (?, ?, ?, ?, ?)",
            rusqlite::params![
                generation.id,
                pos as u32,
                entry.root_id,
                entry.rel,
                entry.fingerprint,
            ],
        )
        .map_err(&convert)?;
    }
    for (kind, notes) in [
        ("assumption", &generation.assumptions),
        ("question", &generation.questions),
    ] {
        for (pos, note) in notes.iter().enumerate() {
            tx.execute(
                "INSERT INTO code_gen_notes(generation_id, kind, pos, note) VALUES (?, ?, ?, ?)",
                rusqlite::params![generation.id, kind, pos as u32, note],
            )
            .map_err(&convert)?;
        }
    }
    for file in &generation.files {
        if !matches!(file.state, CodeFileState::Pending) {
            return Err(invalid("new files must be pending"));
        }
        tx.execute(
            "INSERT INTO code_proposal_files(generation_id, pos, root_id, rel, operation,
             expected_fingerprint, content, state, decided_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL)",
            rusqlite::params![
                generation.id,
                file.pos,
                file.root_id,
                file.rel,
                file.operation,
                file.expected_fingerprint,
                file.content,
            ],
        )
        .map_err(&convert)?;
    }
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(&convert)?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Marks a pending file accepted. Only pending-to-accepted counts as
/// a change: any other state rolls the transaction back (the caller
/// decides whether it was an idempotent retry).
pub(crate) fn accept_code_file(
    conn: &mut Connection,
    path: &std::path::Path,
    generation_id: &str,
    pos: u32,
    decided_at: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let changed = tx
        .execute(
            "UPDATE code_proposal_files SET state = 'accepted', decided_at = ?
             WHERE generation_id = ? AND pos = ? AND state = 'pending'",
            rusqlite::params![decided_at, generation_id, pos],
        )
        .map_err(|e| StoreError::convert(path, e))?;
    if changed != 1 {
        return Err(invalid(format!(
            "file {pos} of {generation_id} is not pending acceptance"
        )));
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Discards a pending file. Idempotent: discarded stays discarded;
/// accepted or missing rolls back with an honest error.
pub(crate) fn discard_code_file(
    conn: &mut Connection,
    path: &std::path::Path,
    generation_id: &str,
    pos: u32,
    decided_at: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let state: Option<String> = tx
        .query_row(
            "SELECT state FROM code_proposal_files WHERE generation_id = ? AND pos = ?",
            rusqlite::params![generation_id, pos],
            |row| row.get(0),
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                invalid(format!("unknown file {pos} in {generation_id}"))
            }
            other => StoreError::convert(path, other),
        })?;
    match state.as_deref() {
        Some("pending") => {
            tx.execute(
                "UPDATE code_proposal_files SET state = 'discarded', decided_at = ?
                 WHERE generation_id = ? AND pos = ?",
                rusqlite::params![decided_at, generation_id, pos],
            )
            .map_err(|e| StoreError::convert(path, e))?;
        }
        Some("discarded") => {}
        Some("accepted") => {
            return Err(invalid(format!(
                "file {pos} of {generation_id} was already accepted and cannot be discarded"
            )));
        }
        _ => {
            return Err(invalid(format!(
                "invalid state on file {pos} of {generation_id}"
            )));
        }
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

type CodeGenRow = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    i64,
    Option<i64>,
    Option<i64>,
    Option<i64>,
    String,
    String,
);

type ProposalFileRow = (
    String,
    i64,
    String,
    String,
    String,
    Option<String>,
    String,
    String,
    Option<String>,
);

/// Loads verifying project and module against the domain. The origin
/// requirement is NOT required (a draft may have been deleted: the api
/// marks it stale instead of breaking the opening), and scope roots
/// tolerate dangling as in snapshots. With v13 databases
/// (`has_screen_origin` false) the screen columns and table do not
/// exist: everything reads as requirement origin and the migration adds
/// what is missing without touching the data.
pub(crate) fn load_codegen(
    conn: &Connection,
    path: &std::path::Path,
    store: &Store,
    has_screen_origin: bool,
) -> Result<CodeGenLog, StoreError> {
    let convert = |e| StoreError::convert(path, e);
    let select = if has_screen_origin {
        "SELECT id, project_id, module_id, requirement_artifact_id, requirement_version_id,
         screen_artifact_id, screen_id, screen_version_id,
         model, template_version, input_tokens, output_tokens, total_tokens, created_at,
         explanation FROM code_generations ORDER BY id"
    } else {
        "SELECT id, project_id, module_id, requirement_artifact_id, requirement_version_id,
         NULL, NULL, NULL,
         model, template_version, input_tokens, output_tokens, total_tokens, created_at,
         explanation FROM code_generations ORDER BY id"
    };
    let mut stmt = conn.prepare(select).map_err(&convert)?;
    let rows: Vec<CodeGenRow> = stmt
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
                row.get(10)?,
                row.get(11)?,
                row.get(12)?,
                row.get(13)?,
                row.get(14)?,
            ))
        })
        .map_err(&convert)?
        .collect::<Result<_, _>>()
        .map_err(&convert)?;
    let mut screen_sources: HashMap<String, Vec<ScreenSourceRef>> = HashMap::new();
    if has_screen_origin {
        let mut stmt = conn
            .prepare(
                "SELECT generation_id, artifact_id, version_id FROM code_gen_screen_sources
                 ORDER BY generation_id, pos",
            )
            .map_err(&convert)?;
        let entries: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (generation_id, artifact_id, version_id) in entries {
            screen_sources
                .entry(generation_id)
                .or_default()
                .push(ScreenSourceRef {
                    artifact_id,
                    version_id,
                });
        }
    }
    let mut scope: HashMap<String, Vec<CodeScopeEntry>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT generation_id, root_id, rel, fingerprint FROM code_gen_scope
                 ORDER BY generation_id, pos",
            )
            .map_err(&convert)?;
        let entries: Vec<(String, String, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (generation_id, root_id, rel, fingerprint) in entries {
            scope
                .entry(generation_id)
                .or_default()
                .push(CodeScopeEntry {
                    root_id,
                    rel,
                    fingerprint,
                });
        }
    }
    let mut notes: HashMap<(String, String), Vec<String>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT generation_id, kind, note FROM code_gen_notes
                 ORDER BY generation_id, kind, pos",
            )
            .map_err(&convert)?;
        let entries: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (generation_id, kind, note) in entries {
            if kind != "assumption" && kind != "question" {
                return Err(invalid(format!("invalid note in {generation_id}")));
            }
            notes.entry((generation_id, kind)).or_default().push(note);
        }
    }
    let mut by_generation: HashMap<String, Vec<StoredProposalFile>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT generation_id, pos, root_id, rel, operation, expected_fingerprint,
                 content, state, decided_at FROM code_proposal_files
                 ORDER BY generation_id, pos",
            )
            .map_err(&convert)?;
        let file_rows: Vec<ProposalFileRow> = stmt
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
                ))
            })
            .map_err(&convert)?
            .collect::<Result<_, _>>()
            .map_err(&convert)?;
        for (
            generation_id,
            pos,
            root_id,
            rel,
            operation,
            expected_fingerprint,
            content,
            state,
            decided_at,
        ) in file_rows
        {
            let pos = u32::try_from(pos)
                .map_err(|_| invalid(format!("invalid position in {generation_id}")))?;
            let state = CodeFileState::parse(&state)
                .ok_or_else(|| invalid(format!("invalid state in {generation_id} file {pos}")))?;
            by_generation
                .entry(generation_id.clone())
                .or_default()
                .push(StoredProposalFile {
                    pos,
                    root_id,
                    rel,
                    operation,
                    expected_fingerprint,
                    content,
                    state,
                    decided_at,
                });
        }
    }
    let mut log = CodeGenLog::new();
    for (
        id,
        project_id,
        module_id,
        requirement_artifact_id,
        requirement_version_id,
        screen_artifact_id,
        screen_id,
        screen_version_id,
        model,
        template_version,
        input_tokens,
        output_tokens,
        total_tokens,
        created_at,
        explanation,
    ) in rows
    {
        let project = ProjectId::new(project_id.clone()).map_err(core)?;
        let module = ModuleId::new(module_id.clone()).map_err(core)?;
        if store.project(&project).is_none() {
            return Err(invalid(format!(
                "code generation {id} points to a missing project"
            )));
        }
        if store.module(&module).is_none() {
            return Err(invalid(format!(
                "code generation {id} points to a missing module"
            )));
        }
        let files = by_generation
            .remove(&id)
            .ok_or_else(|| invalid(format!("code generation {id} without proposed files")))?;
        log.record(StoredCodeGeneration {
            id: id.clone(),
            project_id,
            module_id,
            requirement_artifact_id,
            requirement_version_id,
            // Pre-v14 rows: NULL = requirement origin.
            screen_artifact_id: screen_artifact_id.unwrap_or_default(),
            screen_id: screen_id.unwrap_or_default(),
            screen_version_id: screen_version_id.unwrap_or_default(),
            screen_sources: screen_sources.remove(&id).unwrap_or_default(),
            model,
            template_version: u32::try_from(template_version)
                .map_err(|_| invalid(format!("invalid template in {id}")))?,
            input_tokens: opt_u32(input_tokens, &id)?,
            output_tokens: opt_u32(output_tokens, &id)?,
            total_tokens: opt_u32(total_tokens, &id)?,
            created_at,
            explanation,
            scope: scope.remove(&id).unwrap_or_default(),
            assumptions: notes
                .remove(&(id.clone(), "assumption".to_string()))
                .unwrap_or_default(),
            questions: notes
                .remove(&(id.clone(), "question".to_string()))
                .unwrap_or_default(),
            files,
        })?;
    }
    if let Some(dangling) = by_generation.keys().next() {
        return Err(invalid(format!("orphan proposed files of {dangling}")));
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn generation(id: &str) -> StoredCodeGeneration {
        StoredCodeGeneration {
            id: id.to_string(),
            project_id: "proy-1".to_string(),
            module_id: "mod-2".to_string(),
            requirement_artifact_id: "req-3".to_string(),
            requirement_version_id: "req-3-v1".to_string(),
            screen_artifact_id: String::new(),
            screen_id: String::new(),
            screen_version_id: String::new(),
            screen_sources: vec![],
            model: "muse-spark-1.3".to_string(),
            template_version: 1,
            input_tokens: Some(10),
            output_tokens: Some(20),
            total_tokens: Some(30),
            created_at: "2026-10-28T12:00:00Z".to_string(),
            explanation: "E".to_string(),
            scope: vec![CodeScopeEntry {
                root_id: "root-1".to_string(),
                rel: "a.ts".to_string(),
                fingerprint: "9:1".to_string(),
            }],
            assumptions: vec![],
            questions: vec!["Q".to_string()],
            files: vec![
                StoredProposalFile {
                    pos: 0,
                    root_id: "root-1".to_string(),
                    rel: "a.ts".to_string(),
                    operation: "modify".to_string(),
                    expected_fingerprint: Some("9:1".to_string()),
                    content: "new".to_string(),
                    state: CodeFileState::Pending,
                    decided_at: None,
                },
                StoredProposalFile {
                    pos: 1,
                    root_id: "root-1".to_string(),
                    rel: "b.ts".to_string(),
                    operation: "create".to_string(),
                    expected_fingerprint: None,
                    content: "new".to_string(),
                    state: CodeFileState::Pending,
                    decided_at: None,
                },
            ],
        }
    }

    #[test]
    fn records_and_filters_by_module() {
        let mut log = CodeGenLog::new();
        log.record(generation("cgen-1")).expect("records");
        assert_eq!(log.of_module("mod-2").len(), 1);
        assert!(log.of_module("mod-9").is_empty());
        assert_eq!(log.get("cgen-1").expect("id").files.len(), 2);
        assert_eq!(log.file_state("cgen-1", 0), Some(CodeFileState::Pending));
        assert_eq!(log.file_state("cgen-1", 9), None);
    }

    #[test]
    fn rejects_duplicates_operations_and_disorder() {
        let mut log = CodeGenLog::new();
        log.record(generation("cgen-1")).expect("records");
        assert!(log.record(generation("cgen-1")).is_err());
        let mut bad = generation("cgen-2");
        bad.files[0].operation = "delete".to_string();
        assert!(log.record(bad).is_err());
        let mut bad = generation("cgen-3");
        bad.files[1].pos = 0;
        assert!(log.record(bad).is_err());
        let mut bad = generation("cgen-4");
        bad.files.clear();
        assert!(log.record(bad).is_err());
    }

    #[test]
    fn origin_is_requirement_or_screen_never_both_nor_neither() {
        let mut log = CodeGenLog::new();
        log.record(generation("cgen-1")).expect("requirement");
        let mut screen = generation("cgen-2");
        screen.requirement_artifact_id.clear();
        screen.requirement_version_id.clear();
        screen.screen_artifact_id = "mock-1".to_string();
        screen.screen_id = "registro".to_string();
        screen.screen_version_id = "mock-1-v2".to_string();
        screen.screen_sources = vec![ScreenSourceRef {
            artifact_id: "req-1".to_string(),
            version_id: "req-1-v1".to_string(),
        }];
        log.record(screen).expect("screen");
        assert!(log.get("cgen-2").expect("id").is_screen_sourced());
        assert!(!log.get("cgen-1").expect("id").is_screen_sourced());
        let mut both = generation("cgen-3");
        both.screen_artifact_id = "mock-1".to_string();
        both.screen_id = "registro".to_string();
        both.screen_version_id = "mock-1-v2".to_string();
        assert!(log.record(both).is_err());
        let mut none = generation("cgen-4");
        none.requirement_artifact_id.clear();
        assert!(log.record(none).is_err());
        let mut incomplete = generation("cgen-5");
        incomplete.requirement_artifact_id.clear();
        incomplete.requirement_version_id.clear();
        incomplete.screen_artifact_id = "mock-1".to_string();
        assert!(log.record(incomplete).is_err());
    }

    #[test]
    fn accept_is_idempotent_and_discard_does_not_revive() {
        let mut log = CodeGenLog::new();
        log.record(generation("cgen-1")).expect("records");
        log.mark_file_accepted("cgen-1", 0, "t").expect("accepts");
        assert_eq!(log.file_state("cgen-1", 0), Some(CodeFileState::Accepted));
        log.mark_file_accepted("cgen-1", 0, "t").expect("retry");
        assert!(log.mark_file_discarded("cgen-1", 0, "t").is_err());
        log.mark_file_discarded("cgen-1", 1, "t").expect("discards");
        log.mark_file_discarded("cgen-1", 1, "t").expect("repeats");
        assert!(log.mark_file_accepted("cgen-1", 1, "t").is_err());
        assert!(log.mark_file_accepted("cgen-9", 0, "t").is_err());
    }
}
