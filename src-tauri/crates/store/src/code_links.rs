//! Links between code and knowledge (modules and artifacts).
//!
//! Pure persistence data, no domain rules: each link joins an
//! owner (module or artifact) with a folder/file of an authorized
//! root, and optionally with a detected symbol (with source evidence:
//! range and hash of the analyzed content).
//!
//! Kinds:
//! - `manual`: the person created it explicitly (module ↔ path).
//! - `detected`: created from an analyzer symbol, with enough identity
//!   and evidence (artifact ↔ symbol).
//! - `inferred`: reserved for future proposals; nothing creates it yet.
//!
//! Correspondence is never deduced from name matches: every link is
//! born from an explicit action. One file may link to several owners.
//! Linking modifies no code and creates no core dependencies. No
//! contents or secrets are stored: only paths, symbols, ranges and
//! hashes.

use rusqlite::{Connection, Transaction, TransactionBehavior};
use std::path::Path;

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ModuleId};

use crate::code_roots::CodeRootLog;
use crate::error::StoreError;

/// Link owner: module (paths) or artifact (symbols).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkScope {
    Module,
    Artifact,
}

impl LinkScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            LinkScope::Module => "module",
            LinkScope::Artifact => "artifact",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "module" => Some(LinkScope::Module),
            "artifact" => Some(LinkScope::Artifact),
            _ => None,
        }
    }
}

/// Link origin. `Inferred` exists in the model but nothing creates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Manual,
    Detected,
    Inferred,
}

impl LinkKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            LinkKind::Manual => "manual",
            LinkKind::Detected => "detected",
            LinkKind::Inferred => "inferred",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "manual" => Some(LinkKind::Manual),
            "detected" => Some(LinkKind::Detected),
            "inferred" => Some(LinkKind::Inferred),
            _ => None,
        }
    }
}

/// Detected symbol with source evidence (1-based range + FNV hash).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SymbolRef {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub start_line: i64,
    pub start_col: i64,
    pub end_line: i64,
    pub end_col: i64,
    pub hash: String,
}

/// Stored link, mirror of a `code_links` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCodeLink {
    pub id: String,
    pub scope: LinkScope,
    pub owner_id: String,
    pub root_id: String,
    pub rel: String,
    pub symbol: Option<SymbolRef>,
    pub kind: LinkKind,
    pub created_at: String,
}

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodeLinkLog {
    links: Vec<StoredCodeLink>,
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

/// Syntactically confinable relative path? (No disk: existence and real
/// confinement are checked at the `ruth-code` boundary.)
pub fn rel_is_plausible(rel: &str) -> bool {
    if rel.is_empty() || rel.len() > 1024 {
        return false;
    }
    if rel.starts_with('/') || rel.starts_with('\\') {
        return false;
    }
    !rel.split('/')
        .any(|part| part == ".." || part.contains('\\'))
}

impl CodeLinkLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn all(&self) -> &[StoredCodeLink] {
        &self.links
    }

    pub fn get(&self, id: &str) -> Option<&StoredCodeLink> {
        self.links.iter().find(|link| link.id == id)
    }

    /// An owner links, ordered by id.
    pub fn by_owner(&self, scope: LinkScope, owner_id: &str) -> Vec<&StoredCodeLink> {
        let mut out: Vec<&StoredCodeLink> = self
            .links
            .iter()
            .filter(|link| link.scope == scope && link.owner_id == owner_id)
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Links using a root, ordered by id.
    pub fn by_root(&self, root_id: &str) -> Vec<&StoredCodeLink> {
        let mut out: Vec<&StoredCodeLink> = self
            .links
            .iter()
            .filter(|link| link.root_id == root_id)
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Records a validated link. Requires a unique identity, coherent
    /// shapes (module without symbol, artifact with symbol) and uniqueness
    /// by (owner, root, path, symbol).
    pub fn record(&mut self, link: StoredCodeLink) -> Result<(), StoreError> {
        if link.id.trim().is_empty() {
            return Err(invalid("the link has no identity"));
        }
        if self.get(&link.id).is_some() {
            return Err(invalid(format!("duplicate link: {}", link.id)));
        }
        if link.owner_id.trim().is_empty() {
            return Err(invalid("the link has no owner"));
        }
        if link.root_id.trim().is_empty() {
            return Err(invalid("the link has no root"));
        }
        if !rel_is_plausible(&link.rel) {
            return Err(invalid(format!("invalid path on the link: {}", link.rel)));
        }
        match (link.scope, &link.symbol) {
            (LinkScope::Module, None) => {}
            (LinkScope::Artifact, Some(symbol)) => {
                if symbol.id.trim().is_empty() || symbol.hash.trim().is_empty() {
                    return Err(invalid("the linked symbol has no identity or evidence"));
                }
            }
            (LinkScope::Module, Some(_)) => {
                return Err(invalid("a module link carries no symbol"));
            }
            (LinkScope::Artifact, None) => {
                return Err(invalid("an artifact link requires a symbol with evidence"));
            }
        }
        let duplicate = self.links.iter().any(|other| {
            other.scope == link.scope
                && other.owner_id == link.owner_id
                && other.root_id == link.root_id
                && other.rel == link.rel
                && other.symbol.as_ref().map(|s| &s.id) == link.symbol.as_ref().map(|s| &s.id)
        });
        if duplicate {
            return Err(invalid("that link already exists"));
        }
        self.links.push(link);
        Ok(())
    }

    /// Deletes a link by id. Removing it touches neither files nor domain.
    pub fn remove(&mut self, id: &str) -> Result<StoredCodeLink, StoreError> {
        let pos = self
            .links
            .iter()
            .position(|link| link.id == id)
            .ok_or_else(|| invalid(format!("missing link: {id}")))?;
        Ok(self.links.remove(pos))
    }
}

pub(crate) fn save_code_link(
    conn: &mut Connection,
    path: &Path,
    link: &StoredCodeLink,
    next_id: u64,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    insert_code_link(&tx, path, link)?;
    tx.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('next_id', ?)",
        [next_id.to_string()],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Inserts a link inside an already open transaction.
/// Shared by `save_code_link` and by atomic replication.
pub(crate) fn insert_code_link(
    tx: &Transaction,
    path: &Path,
    link: &StoredCodeLink,
) -> Result<(), StoreError> {
    let symbol = link.symbol.as_ref();
    tx.execute(
        "INSERT INTO code_links(id, scope, owner_id, root_id, rel,
         symbol_id, symbol_name, symbol_kind,
         range_start_line, range_start_col, range_end_line, range_end_col,
         evidence_hash, kind, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            link.id,
            link.scope.as_str(),
            link.owner_id,
            link.root_id,
            link.rel,
            symbol.map(|s| s.id.as_str()),
            symbol.map(|s| s.name.as_str()),
            symbol.map(|s| s.kind.as_str()),
            symbol.map(|s| s.start_line),
            symbol.map(|s| s.start_col),
            symbol.map(|s| s.end_line),
            symbol.map(|s| s.end_col),
            symbol.map(|s| s.hash.as_str()),
            link.kind.as_str(),
            link.created_at,
        ],
    )
    .map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

pub(crate) fn delete_code_link(
    conn: &mut Connection,
    path: &Path,
    id: &str,
) -> Result<(), StoreError> {
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| StoreError::convert(path, e))?;
    let removed = tx
        .execute("DELETE FROM code_links WHERE id = ?", [id])
        .map_err(|e| StoreError::convert(path, e))?;
    if removed == 0 {
        return Err(invalid(format!("missing link: {id}")));
    }
    tx.commit().map_err(|e| StoreError::convert(path, e))?;
    Ok(())
}

/// Loads verifying owner and root: a dangling link is a tampered
/// database (the app blocks deleting modules, artifacts and roots with
/// links). The path itself may miss on disk: that is normal lifecycle
/// and shows as missing, without breaking the load.
pub(crate) fn load_code_links(
    conn: &Connection,
    path: &Path,
    store: &Store,
    roots: &CodeRootLog,
) -> Result<CodeLinkLog, StoreError> {
    let mut stmt = conn
        .prepare(
            "SELECT id, scope, owner_id, root_id, rel,
             symbol_id, symbol_name, symbol_kind,
             range_start_line, range_start_col, range_end_line, range_end_col,
             evidence_hash, kind, created_at
             FROM code_links ORDER BY id",
        )
        .map_err(|e| StoreError::convert(path, e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
                row.get::<_, Option<i64>>(9)?,
                row.get::<_, Option<i64>>(10)?,
                row.get::<_, Option<i64>>(11)?,
                row.get::<_, Option<String>>(12)?,
                row.get::<_, String>(13)?,
                row.get::<_, String>(14)?,
            ))
        })
        .map_err(|e| StoreError::convert(path, e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| StoreError::convert(path, e))?;
    let mut log = CodeLinkLog::new();
    for (
        id,
        scope_raw,
        owner_id,
        root_id,
        rel,
        symbol_id,
        symbol_name,
        symbol_kind,
        start_line,
        start_col,
        end_line,
        end_col,
        evidence_hash,
        kind_raw,
        created_at,
    ) in rows
    {
        let scope = LinkScope::parse(&scope_raw).ok_or_else(|| invalid("invalid link scope"))?;
        let kind = LinkKind::parse(&kind_raw).ok_or_else(|| invalid("invalid link kind"))?;
        let symbol = match (symbol_id, symbol_name, symbol_kind, evidence_hash) {
            (Some(sid), name, skind, hash) => Some(SymbolRef {
                id: sid,
                name: name.unwrap_or_default(),
                kind: skind.unwrap_or_default(),
                start_line: start_line.unwrap_or(0),
                start_col: start_col.unwrap_or(0),
                end_line: end_line.unwrap_or(0),
                end_col: end_col.unwrap_or(0),
                hash: hash.unwrap_or_default(),
            }),
            (None, _, _, _) => None,
        };
        // Owner and root must exist; the on-disk path need not.
        match scope {
            LinkScope::Module => {
                let module =
                    ModuleId::new(&owner_id).map_err(|_| invalid("invalid module on link"))?;
                if store.module(&module).is_none() {
                    return Err(invalid(format!("link {id} points to a missing module")));
                }
            }
            LinkScope::Artifact => {
                let artifact =
                    ArtifactId::new(&owner_id).map_err(|_| invalid("invalid artifact on link"))?;
                if store.artifact(&artifact).is_none() {
                    return Err(invalid(format!("link {id} points to a missing artifact")));
                }
            }
        }
        if !roots.roots().iter().any(|root| root.id == root_id) {
            return Err(invalid(format!("link {id} points to a missing root")));
        }
        log.record(StoredCodeLink {
            id,
            scope,
            owner_id,
            root_id,
            rel,
            symbol,
            kind,
            created_at,
        })?;
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module_link(id: &str) -> StoredCodeLink {
        StoredCodeLink {
            id: id.to_string(),
            scope: LinkScope::Module,
            owner_id: "mod-2".to_string(),
            root_id: "root-1".to_string(),
            rel: "src/api".to_string(),
            symbol: None,
            kind: LinkKind::Manual,
            created_at: "2026-10-28T00:00:00Z".to_string(),
        }
    }

    fn symbol_link(id: &str) -> StoredCodeLink {
        StoredCodeLink {
            id: id.to_string(),
            scope: LinkScope::Artifact,
            owner_id: "req-3".to_string(),
            root_id: "root-1".to_string(),
            rel: "src/api.ts".to_string(),
            symbol: Some(SymbolRef {
                id: "s1".to_string(),
                name: "Api".to_string(),
                kind: "class".to_string(),
                start_line: 1,
                start_col: 1,
                end_line: 9,
                end_col: 2,
                hash: "abc123".to_string(),
            }),
            kind: LinkKind::Detected,
            created_at: "2026-10-28T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn records_and_fetches_by_owner_and_root() {
        let mut log = CodeLinkLog::new();
        log.record(module_link("link-1")).expect("module");
        log.record(symbol_link("link-2")).expect("symbol");
        assert_eq!(log.by_owner(LinkScope::Module, "mod-2").len(), 1);
        assert_eq!(log.by_owner(LinkScope::Artifact, "req-3").len(), 1);
        assert_eq!(log.by_root("root-1").len(), 2);
        assert!(log.by_root("root-9").is_empty());
        let removed = log.remove("link-1").expect("remove");
        assert_eq!(removed.owner_id, "mod-2");
        assert!(log.remove("link-1").is_err());
    }

    #[test]
    fn rejects_duplicates_and_incoherent_shapes() {
        let mut log = CodeLinkLog::new();
        log.record(module_link("link-1")).expect("first");
        assert!(log.record(module_link("link-1")).is_err(), "duplicate id");
        let mut dupe = module_link("link-2");
        dupe.owner_id = "mod-2".to_string();
        assert!(log.record(dupe).is_err(), "same target");
        let mut with_symbol = module_link("link-3");
        with_symbol.symbol = symbol_link("x").symbol;
        assert!(log.record(with_symbol).is_err(), "module with symbol");
        let mut no_symbol = symbol_link("link-4");
        no_symbol.symbol = None;
        assert!(log.record(no_symbol).is_err(), "artifact without symbol");
        let mut bad_rel = module_link("link-5");
        bad_rel.rel = "../outside".to_string();
        assert!(log.record(bad_rel).is_err(), "escape");
        // The same file may still link to another owner.
        let mut other = module_link("link-6");
        other.owner_id = "mod-9".to_string();
        assert!(log.record(other).is_ok());
    }
}
