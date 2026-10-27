//! Actor SQLite: una única conexión en un hilo dedicado.
//!
//! Todo acceso SQL pasa por aquí, fuera del hilo de interfaz y serializado.
//! La conexión toma un bloqueo persistente al abrir, de modo que una segunda
//! instancia falla con [`StoreError::Locked`] en lugar de corromper nada.
//! Al soltar el actor, el hilo termina solo (el canal se cierra).

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};

use ruth_core::application::Store;

use crate::design::{DesignLog, StoredDesignGeneration};
use crate::error::StoreError;
use crate::proposals::{ProposalLog, StoredGeneration};

/// Estado inicial validado al abrir la base.
#[derive(Debug)]
pub struct Loaded {
    pub store: Store,
    pub next_id: u64,
    pub proposals: ProposalLog,
    pub designs: DesignLog,
}

enum Op {
    Save {
        store: Store,
        next_id: u64,
    },
    RecordGeneration {
        generation: StoredGeneration,
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
}

struct Job {
    op: Op,
    reply: Sender<Result<(), StoreError>>,
}

/// Acceso serializado a la base. `Send`: se comparte entre comandos detrás
/// de un `Mutex`.
#[derive(Debug)]
pub struct DbActor {
    tx: Sender<Job>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl DbActor {
    /// Abre (o crea) la base, migra y carga el estado validado. Falla sin
    /// escribir si hay bloqueo, corrupción, esquema futuro o datos inválidos.
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
            message: "el motor de persistencia no respondió al abrir".to_string(),
        })??;
        Ok((
            Self {
                tx,
                handle: Some(handle),
            },
            loaded,
        ))
    }

    /// Cierre ordenado: suelta la conexión y espera al hilo. Consume el
    /// actor; al salir del proceso también se cierra solo.
    pub fn close(self) {
        let Self { tx, handle } = self;
        drop(tx);
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }

    /// Guarda una instantánea completa de forma atómica.
    pub fn save(&self, store: &Store, next_id: u64) -> Result<(), StoreError> {
        self.run(Op::Save {
            store: store.clone(),
            next_id,
        })
    }

    /// Registra una generación validada con sus propuestas pendientes.
    pub fn record_generation(&self, generation: &StoredGeneration) -> Result<(), StoreError> {
        self.run(Op::RecordGeneration {
            generation: generation.clone(),
        })
    }

    /// Aceptación atómica: dominio y estado de la propuesta en una sola
    /// transacción. Solo marca como aceptada después de persistir.
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

    /// Descarta una propuesta pendiente. Idempotente.
    pub fn discard_proposal(&self, generation_id: &str, temp_id: &str) -> Result<(), StoreError> {
        self.run(Op::DiscardProposal {
            generation_id: generation_id.to_string(),
            temp_id: temp_id.to_string(),
        })
    }

    /// Registra una generación de diseño validada con su propuesta pendiente.
    pub fn record_design(&self, generation: &StoredDesignGeneration) -> Result<(), StoreError> {
        self.run(Op::RecordDesign {
            generation: generation.clone(),
        })
    }

    /// Aceptación atómica de diseño: dominio y estado en una transacción.
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

    /// Descarta una propuesta de diseño pendiente. Idempotente.
    pub fn discard_design(&self, generation_id: &str) -> Result<(), StoreError> {
        self.run(Op::DiscardDesign {
            generation_id: generation_id.to_string(),
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
                message: "el motor de persistencia no está disponible".to_string(),
            })?;
        reply_rx.recv().map_err(|_| StoreError::Sqlite {
            message: "el motor de persistencia no respondió".to_string(),
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
                // Instalación nueva (o archivo vacío): migrar y empezar vacío.
                crate::schema::migrate(&mut conn, &path, true)?;
                Ok((
                    conn,
                    Loaded {
                        store: Store::new(),
                        next_id: 1,
                        proposals: ProposalLog::new(),
                        designs: DesignLog::new(),
                    },
                ))
            } else {
                // Base existente: validar primero, escribir después. Las v1/v2
                // cargan con registros vacíos y migran después sin perder datos.
                let (store, next_id, proposals, designs) = crate::persist::load(&conn, &path)?;
                crate::schema::migrate(&mut conn, &path, false)?;
                Ok((
                    conn,
                    Loaded {
                        store,
                        next_id,
                        proposals,
                        designs,
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
                        Op::RecordGeneration { generation } => {
                            crate::persist::save_generation(&mut conn, &path, &generation)
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
                        Op::RecordDesign { generation } => {
                            crate::persist::save_design_generation(&mut conn, &path, &generation)
                        }
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
