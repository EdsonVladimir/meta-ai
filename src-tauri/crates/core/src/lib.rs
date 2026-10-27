//! Núcleo de dominio de Ruth IDE: artefactos, versiones, dependencias y
//! aprobaciones.
//!
//! Independiente de Tauri, React, Meta y almacenamiento. No lee reloj,
//! entorno, archivos ni red: identificadores, contenido y fechas llegan como
//! entradas de los casos de uso.
//!
//! Capas:
//! - [`domain`]: tipos, invariantes y operaciones puras.
//! - [`application`]: coordinación de casos de uso sobre un [`Store`](application::Store)
//!   en memoria.
//!
//! ```rust
//! use ruth_core::application::Store;
//! use ruth_core::domain::{ArtifactId, ArtifactType, Author, Content, Date, HumanId, ModuleId, ProjectId, VersionId};
//!
//! let mut store = Store::new();
//! let project = ProjectId::new("proy-ventas")?;
//! let module = ModuleId::new("mod-ventas")?;
//! let req = ArtifactId::new("req-confirmar")?;
//! store.create_project(project.clone())?;
//! store.create_module(&project, module.clone())?;
//! store.create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)?;
//! let v1 = VersionId::new("req-confirmar-v1")?;
//! store.create_version(
//!     &project,
//!     &req,
//!     None,
//!     v1.clone(),
//!     Content::new("Confirmar una venta descuenta stock.")?,
//!     &Author::Human(HumanId::new("ana")?),
//!     &[],
//! )?;
//! let approval = store.approve(
//!     &project,
//!     &req,
//!     &v1,
//!     &Author::Human(HumanId::new("ana")?),
//!     Date::new("2026-10-27")?,
//! )?;
//! assert_eq!(approval.version(), &v1);
//! # Ok::<(), ruth_core::domain::CoreError>(())
//! ```

pub mod application;
pub mod domain;
