//! Adaptador SQLite del núcleo: persistencia local fiable.
//!
//! # Contrato mínimo
//!
//! - La unidad de persistencia es la instantánea completa del `Store` más el
//!   contador de identificadores. Cada mutación valida con el núcleo sobre
//!   una copia, guarda la copia en una transacción y solo entonces la publica
//!   en memoria. Si algo falla, memoria y disco conservan la versión anterior
//!   y nunca se informa éxito antes de confirmar el guardado.
//! - Las identidades, números, fuentes, aprobaciones y fechas se conservan
//!   verbatim: jamás se regeneran al cargar o guardar.
//! - La carga reconstruye con `Store::reconstitute`, que revalida las
//!   invariantes. Datos inválidos, corrupción o esquema futuro se rechazan
//!   sin escribir nada.
//! - Las lecturas usan la memoria (igual al último commit confirmado).
//! - Solo vive aquí el estado del dominio. No se guardan claves de API,
//!   borradores, selecciones de interfaz ni credenciales.
//!
//! Las generaciones asistidas (hito 5) conviven en las mismas tablas de
//! versión 2 con operaciones propias: registrar, aceptar (dominio + estado
//! en una sola transacción) y descartar. `save` no las toca.
//!
//! # Costo y límites
//!
//! Cada mutación reescribe la base entera: costo O(tamaño) por guardado.
//! Es deliberado (simplicidad y atomicidad obvia) y sobra para cientos de
//! versiones; si crece, el siguiente paso es escritura incremental por
//! entidad sin cambiar el contrato.
//!
//! # Concurrencia
//!
//! - Una única conexión SQLite vive en un hilo dedicado ([`DbActor`], `Send`
//!   tras un `Mutex`); todo acceso SQL pasa por él, fuera del hilo de interfaz.
//! - En proceso, un `Mutex` serializa los comandos; en disco, transacciones
//!   `IMMEDIATE` con `busy_timeout=0` fallan rápido ante contención.
//! - Segunda instancia: el actor toma un bloqueo `EXCLUSIVE` persistente al
//!   abrir. Otro proceso que intente abrir falla con [`StoreError::Locked`]
//!   y un mensaje claro. No se soportan dos instancias a la vez.

mod actor;
pub mod design;
mod error;
mod persist;
pub mod proposals;
mod schema;

pub use actor::{DbActor, Loaded};
pub use design::{DesignLog, StoredDesignGeneration, StoredDesignProposal};
pub use error::StoreError;
pub use proposals::{ProposalLog, ProposalState, StoredGeneration, StoredProposal};
pub use schema::SCHEMA_VERSION;
