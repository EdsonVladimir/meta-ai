//! Atomic mutations: validate, persist and only then publish.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    transact, ApproveVersionInput, CreateModuleInput, CreateRequirementInput, IdGen,
    SaveVersionInput,
};
use ruth_store::DbActor;

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path =
            std::env::temp_dir().join(format!("ruth-tx-{}-{}-{}.db", name, std::process::id(), n));
        let _ = std::fs::remove_file(&path);
        Self { path }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[test]
fn transact_persists_and_reloads() {
    let tmp = TempDb::new("ok");
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open");
    let mut store = loaded.store;
    let mut ids = IdGen::restore(loaded.next_id);
    let project = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_project(s, i)
    })
    .expect("project");
    let module = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_module(
            s,
            i,
            CreateModuleInput {
                project_id: project.id.clone(),
            },
        )
    })
    .expect("module");
    let created = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_requirement(
            s,
            i,
            CreateRequirementInput {
                project_id: project.id.clone(),
                module_id: module.id.clone(),
                content: "First version.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("requirement");
    transact(&mut store, &mut ids, &db, |s, _| {
        ruth_api::approve_version(
            s,
            ApproveVersionInput {
                project_id: project.id.clone(),
                artifact_id: created.artifact.id.clone(),
                expected_version_id: created.current_version_id.clone(),
                approver: "bruno".to_string(),
            },
            "2026-10-27T10:00:00Z",
        )
    })
    .expect("approve");
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded2.store, store);
    let detail = ruth_api::get_requirement(
        &loaded2.store,
        ruth_api::GetRequirementInput {
            artifact_id: created.artifact.id.clone(),
        },
    )
    .expect("read");
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.approvals.len(), 1);
    db2.close();
}

#[test]
fn transact_rejection_writes_nothing() {
    let tmp = TempDb::new("rejection");
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open");
    let mut store = loaded.store;
    let mut ids = IdGen::restore(loaded.next_id);
    let project = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_project(s, i)
    })
    .expect("project");
    let module = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_module(
            s,
            i,
            CreateModuleInput {
                project_id: project.id.clone(),
            },
        )
    })
    .expect("module");
    let created = transact(&mut store, &mut ids, &db, |s, i| {
        ruth_api::create_requirement(
            s,
            i,
            CreateRequirementInput {
                project_id: project.id.clone(),
                module_id: module.id.clone(),
                content: "Base.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("requirement");
    let before = store.clone();
    let bytes_before = std::fs::read(&tmp.path).expect("read db");
    let err = transact(&mut store, &mut ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            SaveVersionInput {
                project_id: project.id.clone(),
                artifact_id: created.artifact.id.clone(),
                expected_version_id: "stale".to_string(),
                content: "Must not be saved.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect_err("must fail");
    assert_eq!(err.kind, "stale_version");
    assert_eq!(store, before);
    assert_eq!(std::fs::read(&tmp.path).expect("read db"), bytes_before);
    db.close();
}
