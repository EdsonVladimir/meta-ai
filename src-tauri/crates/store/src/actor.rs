//! SQLite actor: a single connection on a dedicated thread.
//!
//! All SQL access goes through here, off the UI thread and serialized. The
//! connection takes a persistent lock on open, so a second instance fails
//! with [`StoreError::Locked`] instead of corrupting anything. Dropping the
//! actor ends the thread on its own (the channel closes).

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};

use ruth_core::application::Store;

use crate::baseline_meta::{BaselineMeta, BaselineMetaLog};
use crate::code_links::{CodeLinkLog, StoredCodeLink};
use crate::code_roots::CodeRootLog;
use crate::codegen::{CodeGenLog, StoredCodeGeneration};
use crate::design::{DesignLog, StoredDesignGeneration};
use crate::error::StoreError;
use crate::layout::LayoutLog;
use crate::mockups::{MockupLog, StoredMockupGeneration};
use crate::proposals::{ProposalLog, StoredGeneration};
use crate::recents::{RecentLog, StoredRecent};
use crate::snapshots::{SnapshotLog, StoredSnapshot};

/// Initial state validated on database open.
#[derive(Debug)]
pub struct Loaded {
    pub store: Store,
    pub next_id: u64,
    pub proposals: ProposalLog,
    pub designs: DesignLog,
    pub baseline_meta: BaselineMetaLog,
    pub layouts: LayoutLog,
    pub mockups: MockupLog,
    pub code_roots: CodeRootLog,
    pub code_links: CodeLinkLog,
    pub snapshots: SnapshotLog,
    pub codegen: CodeGenLog,
    pub recents: RecentLog,
}

enum Op {
    Save {
        store: Store,
        next_id: u64,
    },
    RecordGeneration {
        generation: StoredGeneration,
        next_id: u64,
    },
    AcceptProposal {
        store: Store,
        next_id: u64,
        generation_id: String,
        temp_id: String,
        artifact_id: String,
        content: String,
    },
    DiscardProposal {
        generation_id: String,
        temp_id: String,
    },
    RecordDesign {
        generation: StoredDesignGeneration,
        next_id: u64,
    },
    AcceptDesign {
        store: Store,
        next_id: u64,
        generation_id: String,
        artifact_id: String,
        content: String,
    },
    DiscardDesign {
        generation_id: String,
    },
    RecordMockup {
        generation: StoredMockupGeneration,
        next_id: u64,
    },
    AcceptMockup {
        store: Store,
        next_id: u64,
        generation_id: String,
        temp_id: String,
        artifact_id: String,
        content: String,
    },
    DiscardMockup {
        generation_id: String,
        temp_id: String,
    },
    CreateBaseline {
        store: Store,
        next_id: u64,
        meta: BaselineMeta,
    },
    SaveDesignLayout {
        store: Store,
        next_id: u64,
        artifact_id: String,
        version_id: String,
        layout_json: Option<String>,
    },
    UpsertDesignLayout {
        artifact_id: String,
        version_id: String,
        layout_json: Option<String>,
    },
    SaveCodeRoots {
        roots: Vec<ruth_code::CodeRoot>,
        next_id: u64,
    },
    SaveCodeLink {
        link: StoredCodeLink,
        next_id: u64,
    },
    SaveReplication {
        store: Store,
        roots: Vec<ruth_code::CodeRoot>,
        links: Vec<StoredCodeLink>,
        next_id: u64,
    },
    DeleteCodeLink {
        id: String,
    },
    SaveSnapshot {
        snapshot: StoredSnapshot,
        next_id: u64,
    },
    DeleteSnapshot {
        id: String,
    },
    RecordCodeGen {
        generation: StoredCodeGeneration,
        next_id: u64,
    },
    AcceptCodeFile {
        generation_id: String,
        pos: u32,
        decided_at: String,
    },
    DiscardCodeFile {
        generation_id: String,
        pos: u32,
        decided_at: String,
    },
    SaveRecents {
        recents: Vec<StoredRecent>,
        next_id: u64,
    },
}

struct Job {
    op: Op,
    reply: Sender<Result<(), StoreError>>,
}

/// Serialized database access. `Send`: shared between commands behind
/// a `Mutex`.
#[derive(Debug)]
pub struct DbActor {
    tx: Sender<Job>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl DbActor {
    /// Opens (or creates) the database, migrates and loads the validated
    /// state. Fails without writing on lock, corruption, future schema or
    /// invalid data.
    pub fn spawn(path: &Path) -> Result<(Self, Loaded), StoreError> {
        let path = path.to_path_buf();
        let (tx, rx) = mpsc::channel::<Job>();
        let (init_tx, init_rx) = mpsc::channel::<Result<Loaded, StoreError>>();
        let worker_path = path.clone();
        let handle = std::thread::Builder::new()
            .name("ruth-sqlite".to_string())
            .spawn(move || Self::serve(worker_path, rx, init_tx))
            .map_err(|e| StoreError::Io {
                path: path.clone(),
                message: e.to_string(),
            })?;
        let loaded = init_rx.recv().map_err(|_| StoreError::Sqlite {
            message: "the persistence engine did not answer on open".to_string(),
        })??;
        Ok((
            Self {
                tx,
                handle: Some(handle),
            },
            loaded,
        ))
    }

    /// Orderly shutdown: releases the connection and waits for the thread.
    /// Consumes the actor; it also closes on its own at process exit.
    pub fn close(self) {
        let Self { tx, handle } = self;
        drop(tx);
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }

    /// Atomically saves a complete snapshot.
    pub fn save(&self, store: &Store, next_id: u64) -> Result<(), StoreError> {
        self.run(Op::Save {
            store: store.clone(),
            next_id,
        })
    }

    /// Registers a validated generation with its pending proposals.
    pub fn record_generation(
        &self,
        generation: &StoredGeneration,
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::RecordGeneration {
            generation: generation.clone(),
            next_id,
        })
    }

    /// Atomic acceptance: domain and proposal state in a single
    /// transaction. Marks as accepted only after persisting.
    pub fn accept_proposal(
        &self,
        store: &Store,
        next_id: u64,
        generation_id: &str,
        temp_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        self.run(Op::AcceptProposal {
            store: store.clone(),
            next_id,
            generation_id: generation_id.to_string(),
            temp_id: temp_id.to_string(),
            artifact_id: artifact_id.to_string(),
            content: content.to_string(),
        })
    }

    /// Discards a pending proposal. Idempotent.
    pub fn discard_proposal(&self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        self.run(Op::DiscardProposal {
            generation_id: generation_id.to_string(),
            temp_id: temp_id.to_string(),
        })
    }

    /// Registers a validated design generation with its pending proposal.
    pub fn record_design(
        &self,
        generation: &StoredDesignGeneration,
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::RecordDesign {
            generation: generation.clone(),
            next_id,
        })
    }

    /// Atomic design acceptance: domain and state in one transaction.
    pub fn accept_design(
        &self,
        store: &Store,
        next_id: u64,
        generation_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        self.run(Op::AcceptDesign {
            store: store.clone(),
            next_id,
            generation_id: generation_id.to_string(),
            artifact_id: artifact_id.to_string(),
            content: content.to_string(),
        })
    }

    /// Discards a pending design proposal. Idempotent.
    pub fn discard_design(&self, generation_id: &str) -> Result<(), StoreError> {
        self.run(Op::DiscardDesign {
            generation_id: generation_id.to_string(),
        })
    }

    /// Registers a validated screen generation with its proposals.
    pub fn record_mockup(
        &self,
        generation: &StoredMockupGeneration,
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::RecordMockup {
            generation: generation.clone(),
            next_id,
        })
    }

    /// Atomic screen acceptance: domain and state in one transaction.
    pub fn accept_mockup(
        &self,
        store: &Store,
        next_id: u64,
        generation_id: &str,
        temp_id: &str,
        artifact_id: &str,
        content: &str,
    ) -> Result<(), StoreError> {
        self.run(Op::AcceptMockup {
            store: store.clone(),
            next_id,
            generation_id: generation_id.to_string(),
            temp_id: temp_id.to_string(),
            artifact_id: artifact_id.to_string(),
            content: content.to_string(),
        })
    }

    /// Discards a pending screen. Idempotent.
    pub fn discard_mockup(&self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        self.run(Op::DiscardMockup {
            generation_id: generation_id.to_string(),
            temp_id: temp_id.to_string(),
        })
    }

    /// Atomic baseline creation: domain (with the baseline) and metadata
    /// in a single transaction.
    pub fn create_baseline(
        &self,
        store: &Store,
        next_id: u64,
        meta: &BaselineMeta,
    ) -> Result<(), StoreError> {
        self.run(Op::CreateBaseline {
            store: store.clone(),
            next_id,
            meta: meta.clone(),
        })
    }

    /// Atomic manual-review save: domain (with the new version) and
    /// visual layout in a single transaction.
    pub fn save_design_layout(
        &self,
        store: &Store,
        next_id: u64,
        artifact_id: &str,
        version_id: &str,
        layout_json: Option<&str>,
    ) -> Result<(), StoreError> {
        self.run(Op::SaveDesignLayout {
            store: store.clone(),
            next_id,
            artifact_id: artifact_id.to_string(),
            version_id: version_id.to_string(),
            layout_json: layout_json.map(str::to_string),
        })
    }

    /// Saves only a layout, without touching the domain.
    pub fn upsert_design_layout(
        &self,
        artifact_id: &str,
        version_id: &str,
        layout_json: Option<&str>,
    ) -> Result<(), StoreError> {
        self.run(Op::UpsertDesignLayout {
            artifact_id: artifact_id.to_string(),
            version_id: version_id.to_string(),
            layout_json: layout_json.map(str::to_string),
        })
    }

    /// Persists the root set (total rewrite in a transaction)
    /// alongside the identifier counter.
    pub fn save_code_roots(
        &self,
        roots: &[ruth_code::CodeRoot],
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::SaveCodeRoots {
            roots: roots.to_vec(),
            next_id,
        })
    }

    /// Persists a code↔knowledge link (one row, in a transaction).
    pub fn save_code_link(&self, link: &StoredCodeLink, next_id: u64) -> Result<(), StoreError> {
        self.run(Op::SaveCodeLink {
            link: link.clone(),
            next_id,
        })
    }

    /// Deletes a link by id. Touches neither files nor domain.
    pub fn delete_code_link(&self, id: &str) -> Result<(), StoreError> {
        self.run(Op::DeleteCodeLink { id: id.to_string() })
    }

    /// Structure replication in a single transaction: domain, roots and
    /// links. Either everything is saved or nothing is.
    pub fn save_replication(
        &self,
        store: &Store,
        roots: &[ruth_code::CodeRoot],
        links: &[StoredCodeLink],
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::SaveReplication {
            store: store.clone(),
            roots: roots.to_vec(),
            links: links.to_vec(),
            next_id,
        })
    }

    /// Persists a structure snapshot (one row, in a transaction).
    pub fn save_snapshot(&self, snapshot: &StoredSnapshot, next_id: u64) -> Result<(), StoreError> {
        self.run(Op::SaveSnapshot {
            snapshot: snapshot.clone(),
            next_id,
        })
    }

    /// Deletes a snapshot by id. Touches neither files nor domain.
    pub fn delete_snapshot(&self, id: &str) -> Result<(), StoreError> {
        self.run(Op::DeleteSnapshot { id: id.to_string() })
    }

    /// Registers a validated code generation with its pending files.
    pub fn record_codegen(
        &self,
        generation: &StoredCodeGeneration,
        next_id: u64,
    ) -> Result<(), StoreError> {
        self.run(Op::RecordCodeGen {
            generation: generation.clone(),
            next_id,
        })
    }

    /// Marks a proposed file accepted (already written to disk). Only
    /// pending-to-accepted; the api decides the idempotent retry.
    pub fn accept_code_file(
        &self,
        generation_id: &str,
        pos: u32,
        decided_at: &str,
    ) -> Result<(), StoreError> {
        self.run(Op::AcceptCodeFile {
            generation_id: generation_id.to_string(),
            pos,
            decided_at: decided_at.to_string(),
        })
    }

    /// Discards a pending proposed file. Idempotent.
    pub fn discard_code_file(
        &self,
        generation_id: &str,
        pos: u32,
        decided_at: &str,
    ) -> Result<(), StoreError> {
        self.run(Op::DiscardCodeFile {
            generation_id: generation_id.to_string(),
            pos,
            decided_at: decided_at.to_string(),
        })
    }

    /// Rewrites the saved-workspace list (touch and remove share it).
    pub fn save_recents(&self, recents: &[StoredRecent], next_id: u64) -> Result<(), StoreError> {
        self.run(Op::SaveRecents {
            recents: recents.to_vec(),
            next_id,
        })
    }

    fn run(&self, op: Op) -> Result<(), StoreError> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Job {
                op,
                reply: reply_tx,
            })
            .map_err(|_| StoreError::Sqlite {
                message: "the persistence engine is not available".to_string(),
            })?;
        reply_rx.recv().map_err(|_| StoreError::Sqlite {
            message: "the persistence engine did not answer".to_string(),
        })?
    }

    fn serve(path: PathBuf, rx: mpsc::Receiver<Job>, init_tx: Sender<Result<Loaded, StoreError>>) {
        let outcome = (|| -> Result<(rusqlite::Connection, Loaded), StoreError> {
            let mut conn = crate::schema::open(&path)?;
            let found = crate::schema::read_version(&conn, &path)?;
            if found > crate::SCHEMA_VERSION {
                return Err(StoreError::FutureSchema {
                    found,
                    supported: crate::SCHEMA_VERSION,
                });
            }
            if found < 1 {
                // Fresh install (or empty file): migrate and start empty.
                crate::schema::migrate(&mut conn, &path, true)?;
                Ok((
                    conn,
                    Loaded {
                        store: Store::new(),
                        next_id: 1,
                        proposals: ProposalLog::new(),
                        designs: DesignLog::new(),
                        baseline_meta: BaselineMetaLog::new(),
                        layouts: LayoutLog::new(),
                        mockups: MockupLog::new(),
                        code_roots: CodeRootLog::new(),
                        code_links: CodeLinkLog::new(),
                        snapshots: SnapshotLog::new(),
                        codegen: CodeGenLog::new(),
                        recents: RecentLog::new(),
                    },
                ))
            } else {
                // Existing database: validate first, write later. v1/v2 load
                // with empty logs and migrate later without losing data.
                let (
                    store,
                    next_id,
                    proposals,
                    designs,
                    baseline_meta,
                    layouts,
                    mockups,
                    code_roots,
                    code_links,
                    snapshots,
                    codegen,
                    recents,
                ) = crate::persist::load(&conn, &path)?;
                crate::schema::migrate(&mut conn, &path, false)?;
                Ok((
                    conn,
                    Loaded {
                        store,
                        next_id,
                        proposals,
                        designs,
                        baseline_meta,
                        layouts,
                        mockups,
                        code_roots,
                        code_links,
                        snapshots,
                        codegen,
                        recents,
                    },
                ))
            }
        })();
        match outcome {
            Ok((mut conn, loaded)) => {
                if init_tx.send(Ok(loaded)).is_err() {
                    return;
                }
                for job in rx {
                    let result = match job.op {
                        Op::Save { store, next_id } => {
                            crate::persist::save(&mut conn, &path, &store, next_id)
                        }
                        Op::RecordGeneration {
                            generation,
                            next_id,
                        } => {
                            crate::persist::save_generation(&mut conn, &path, &generation, next_id)
                        }
                        Op::AcceptProposal {
                            store,
                            next_id,
                            generation_id,
                            temp_id,
                            artifact_id,
                            content,
                        } => crate::persist::accept_proposal(
                            &mut conn,
                            &path,
                            &store,
                            next_id,
                            &generation_id,
                            &temp_id,
                            &artifact_id,
                            &content,
                        ),
                        Op::DiscardProposal {
                            generation_id,
                            temp_id,
                        } => crate::persist::discard_proposal(
                            &mut conn,
                            &path,
                            &generation_id,
                            &temp_id,
                        ),
                        Op::RecordDesign {
                            generation,
                            next_id,
                        } => crate::persist::save_design_generation(
                            &mut conn,
                            &path,
                            &generation,
                            next_id,
                        ),
                        Op::AcceptDesign {
                            store,
                            next_id,
                            generation_id,
                            artifact_id,
                            content,
                        } => crate::persist::accept_design_proposal(
                            &mut conn,
                            &path,
                            &store,
                            next_id,
                            &generation_id,
                            &artifact_id,
                            &content,
                        ),
                        Op::DiscardDesign { generation_id } => {
                            crate::persist::discard_design_proposal(
                                &mut conn,
                                &path,
                                &generation_id,
                            )
                        }
                        Op::RecordMockup {
                            generation,
                            next_id,
                        } => crate::persist::save_mockup_generation(
                            &mut conn,
                            &path,
                            &generation,
                            next_id,
                        ),
                        Op::AcceptMockup {
                            store,
                            next_id,
                            generation_id,
                            temp_id,
                            artifact_id,
                            content,
                        } => crate::persist::accept_mockup_proposal(
                            &mut conn,
                            &path,
                            &store,
                            next_id,
                            &generation_id,
                            &temp_id,
                            &artifact_id,
                            &content,
                        ),
                        Op::DiscardMockup {
                            generation_id,
                            temp_id,
                        } => crate::persist::discard_mockup_proposal(
                            &mut conn,
                            &path,
                            &generation_id,
                            &temp_id,
                        ),
                        Op::CreateBaseline {
                            store,
                            next_id,
                            meta,
                        } => crate::persist::create_baseline(
                            &mut conn, &path, &store, next_id, &meta,
                        ),
                        Op::SaveDesignLayout {
                            store,
                            next_id,
                            artifact_id,
                            version_id,
                            layout_json,
                        } => crate::persist::save_design_layout(
                            &mut conn,
                            &path,
                            &store,
                            next_id,
                            &artifact_id,
                            &version_id,
                            layout_json.as_deref(),
                        ),
                        Op::UpsertDesignLayout {
                            artifact_id,
                            version_id,
                            layout_json,
                        } => crate::persist::upsert_design_layout(
                            &mut conn,
                            &path,
                            &artifact_id,
                            &version_id,
                            layout_json.as_deref(),
                        ),
                        Op::SaveCodeRoots { roots, next_id } => {
                            crate::code_roots::save_code_roots(&mut conn, &path, &roots, next_id)
                        }
                        Op::SaveCodeLink { link, next_id } => {
                            crate::code_links::save_code_link(&mut conn, &path, &link, next_id)
                        }
                        Op::SaveReplication {
                            store,
                            roots,
                            links,
                            next_id,
                        } => crate::persist::save_replication(
                            &mut conn, &path, &store, &roots, &links, next_id,
                        ),
                        Op::DeleteCodeLink { id } => {
                            crate::code_links::delete_code_link(&mut conn, &path, &id)
                        }
                        Op::SaveSnapshot { snapshot, next_id } => {
                            crate::snapshots::save_snapshot(&mut conn, &path, &snapshot, next_id)
                        }
                        Op::DeleteSnapshot { id } => {
                            crate::snapshots::delete_snapshot(&mut conn, &path, &id)
                        }
                        Op::RecordCodeGen {
                            generation,
                            next_id,
                        } => crate::codegen::save_code_generation(
                            &mut conn,
                            &path,
                            &generation,
                            next_id,
                        ),
                        Op::AcceptCodeFile {
                            generation_id,
                            pos,
                            decided_at,
                        } => crate::codegen::accept_code_file(
                            &mut conn,
                            &path,
                            &generation_id,
                            pos,
                            &decided_at,
                        ),
                        Op::DiscardCodeFile {
                            generation_id,
                            pos,
                            decided_at,
                        } => crate::codegen::discard_code_file(
                            &mut conn,
                            &path,
                            &generation_id,
                            pos,
                            &decided_at,
                        ),
                        Op::SaveRecents { recents, next_id } => {
                            crate::recents::save_recents(&mut conn, &path, &recents, next_id)
                        }
                    };
                    let _ = job.reply.send(result);
                }
            }
            Err(err) => {
                let _ = init_tx.send(Err(err));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ruth_core::domain::{ArtifactId, ArtifactType, ModuleId, ProjectId};

    fn tiny_store() -> Store {
        let mut store = Store::new();
        let project = ProjectId::new("proj-1").expect("id");
        let module = ModuleId::new("mod-1").expect("id");
        store.create_project(project.clone()).expect("project");
        store
            .create_module(&project, module.clone())
            .expect("module");
        store
            .create_artifact(
                &project,
                &module,
                ArtifactId::new("req-1").expect("id"),
                ArtifactType::Requirement,
            )
            .expect("artifact");
        store
    }

    fn tiny_root() -> ruth_code::CodeRoot {
        ruth_code::CodeRoot {
            id: "root-1".to_string(),
            path: "/tmp/fe".to_string(),
            name: "fe".to_string(),
            project_id: Some("proj-1".to_string()),
        }
    }

    fn tiny_link() -> StoredCodeLink {
        StoredCodeLink {
            id: "link-1".to_string(),
            scope: crate::code_links::LinkScope::Module,
            owner_id: "mod-1".to_string(),
            root_id: "root-1".to_string(),
            rel: "src/app".to_string(),
            symbol: None,
            kind: crate::code_links::LinkKind::Manual,
            created_at: "2026-10-28T12:00:00Z".to_string(),
        }
    }

    fn temp_db(tag: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ruth-actor-{}-{}-{}",
            std::process::id(),
            tag,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("reloj")
                .as_nanos()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    /// Operation dispatch persists and reloads: domain, roots and links
    /// survive closing, and deletion is published too.
    #[test]
    fn dispatch_roundtrip_persists_domain_roots_and_links() {
        let path = temp_db("roundtrip");
        let (actor, _) = DbActor::spawn(&path).expect("open");
        actor.save(&tiny_store(), 7).expect("domain");
        actor.save_code_roots(&[tiny_root()], 8).expect("roots");
        actor.save_code_link(&tiny_link(), 9).expect("link");
        actor.close();

        let (actor, loaded) = DbActor::spawn(&path).expect("reopen");
        assert_eq!(loaded.next_id, 9);
        assert!(loaded
            .store
            .project(&ProjectId::new("proj-1").expect("id"))
            .is_some());
        assert_eq!(loaded.code_roots.roots().len(), 1);
        assert_eq!(loaded.code_roots.roots()[0].name, "fe");
        assert_eq!(loaded.code_links.all().len(), 1);

        actor.delete_code_link("link-1").expect("borrar");
        actor.close();
        let (actor, loaded) = DbActor::spawn(&path).expect("reopen");
        assert!(loaded.code_links.all().is_empty());
        // Domain and roots stay intact.
        assert!(loaded
            .store
            .project(&ProjectId::new("proj-1").expect("id"))
            .is_some());
        assert_eq!(loaded.code_roots.roots().len(), 1);
        actor.close();
        let _ = std::fs::remove_file(&path);
    }

    /// Actor-driven replication is atomic: domain + roots + links in one
    /// transaction, visible after reopen.
    #[test]
    fn dispatch_replication_is_atomic() {
        let path = temp_db("replica");
        let (actor, _) = DbActor::spawn(&path).expect("open");
        actor
            .save_replication(&tiny_store(), &[tiny_root()], &[tiny_link()], 11)
            .expect("replication");
        actor.close();
        let (actor, loaded) = DbActor::spawn(&path).expect("reopen");
        assert_eq!(loaded.next_id, 11);
        assert!(loaded
            .store
            .project(&ProjectId::new("proj-1").expect("id"))
            .is_some());
        assert_eq!(loaded.code_roots.roots().len(), 1);
        assert_eq!(loaded.code_links.all().len(), 1);
        actor.close();
        let _ = std::fs::remove_file(&path);
    }
}
