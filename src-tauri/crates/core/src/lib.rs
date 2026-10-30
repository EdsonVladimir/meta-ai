//! Ruth IDE domain core: artifacts, versions, dependencies and
//! approvals.
//!
//! Independent of Tauri, React, Meta and storage. It reads no clock,
//! environment, files or network: identifiers, content and dates arrive
//! as use-case inputs.
//!
//! Layers:
//! - [`domain`]: types, invariants and pure operations.
//! - [`application`]: use-case coordination over an in-memory
//!   [`Store`](application::Store).
//!
//! ```rust
//! use ruth_core::application::Store;
//! use ruth_core::domain::{ArtifactId, ArtifactType, Author, Content, Date, HumanId, ModuleId, ProjectId, VersionId};
//!
//! let mut store = Store::new();
//! let project = ProjectId::new("proj-sales")?;
//! let module = ModuleId::new("mod-sales")?;
//! let req = ArtifactId::new("req-confirm")?;
//! store.create_project(project.clone())?;
//! store.create_module(&project, module.clone())?;
//! store.create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)?;
//! let v1 = VersionId::new("req-confirm-v1")?;
//! store.create_version(
//!     &project,
//!     &req,
//!     None,
//!     v1.clone(),
//!     Content::new("Confirming a sale discounts stock.")?,
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
