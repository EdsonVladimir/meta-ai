//! Work/draft deliveries: prepare without requiring review, create
//! atomically, list with honest pendings and export identifying
//! staleness. No network: core, API and temp SQLite.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, BaselineEntryInput, CreateModuleInput, CreateRequirementInput,
    DeliveryCreateInput, DeliveryPrepareInput, IdGen, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, Content, HumanId, ModuleId, ProjectId, VersionId};
use ruth_store::DbActor;

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-delivery-{}-{}-{}.db",
            name,
            std::process::id(),
            n
        ));
        let _ = std::fs::remove_file(&path);
        Self { path }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

struct Baby {
    store: Store,
    ids: IdGen,
    project: ProjectId,
    module: ModuleId,
    req: ArtifactId,
}

fn baby() -> Baby {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ProjectId::new(
        ruth_api::create_project(&mut store, &mut ids)
            .expect("project")
            .id,
    )
    .expect("id");
    let module = ModuleId::new(
        ruth_api::create_module(
            &mut store,
            &mut ids,
            CreateModuleInput {
                project_id: project.as_str().to_string(),
            },
        )
        .expect("module")
        .id,
    )
    .expect("id");
    let req = ArtifactId::new(
        ruth_api::create_requirement(
            &mut store,
            &mut ids,
            CreateRequirementInput {
                project_id: project.as_str().to_string(),
                module_id: module.as_str().to_string(),
                content: "Confirmar una venta descuenta stock.".to_string(),
                author: "ana".to_string(),
            },
        )
        .expect("requirement")
        .artifact
        .id,
    )
    .expect("id");
    Baby {
        store,
        ids,
        project,
        module,
        req,
    }
}

fn prepare_input(baby: &Baby) -> DeliveryPrepareInput {
    DeliveryPrepareInput {
        project_id: baby.project.as_str().to_string(),
        scope_module_id: baby.module.as_str().to_string(),
        artifact_ids: vec![baby.req.as_str().to_string()],
    }
}

fn create_input(baby: &Baby, version: &VersionId) -> DeliveryCreateInput {
    DeliveryCreateInput {
        project_id: baby.project.as_str().to_string(),
        name: "Monday work".to_string(),
        description: None,
        scope_module_id: Some(baby.module.as_str().to_string()),
        entries: vec![BaselineEntryInput {
            artifact_id: baby.req.as_str().to_string(),
            version_id: version.as_str().to_string(),
        }],
    }
}

fn current_version(baby: &Baby) -> VersionId {
    baby.store
        .current_version(&baby.req)
        .expect("current")
        .id()
        .clone()
}

#[test]
fn prepare_and_create_without_review() {
    let tmp = TempDb::new("no-review");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    // Unreviewed: preparation counts it, never vetoes it.
    let preview =
        ruth_api::prepare_work_delivery(&baby.store, prepare_input(&baby)).expect("prepare");
    assert!(preview.can_create);
    assert!(preview.blockers.is_empty());
    assert_eq!(preview.unreviewed_count, 1);
    assert_eq!(preview.stale_count, 0);
    assert_eq!(preview.entries.len(), 1);
    let version = current_version(&baby);
    let input = create_input(&baby, &version);
    let dto = ruth_api::create_work_delivery(
        &mut baby.store,
        &mut baby.ids,
        &db,
        input,
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    assert_eq!(dto.name, "Monday work");
    assert_eq!(dto.entries.len(), 1);
    assert_eq!(dto.scope_module_id.as_deref(), Some(baby.module.as_str()));
    // Just created, no advancement and one honest pending.
    let list = ruth_api::list_work_deliveries(&baby.store, baby.project.as_str()).expect("list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].unreviewed_count, 1);
    assert!(!list[0].advanced);
    db.close();
}

#[test]
fn prepare_reports_stale_sources_without_blocking() {
    let tmp = TempDb::new("stale");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    // A flow with v1 as a source; then the requirement advances to v2.
    let req_v1 = current_version(&baby);
    let flow = baby.ids.flow();
    baby.store
        .create_artifact(
            &baby.project,
            &baby.module,
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flow");
    let flow_v1 = IdGen::version(&flow, 1);
    baby.store
        .create_version(
            &baby.project,
            &flow,
            None,
            flow_v1.clone(),
            Content::new("{}".to_string()).expect("content"),
            &ruth_core::domain::Author::Human(HumanId::new("ana").expect("author")),
            std::slice::from_ref(&req_v1),
        )
        .expect("version");
    save_req_version(&mut baby, "Permitir reservas antes de confirmar.");
    // Prepare with requirement v2 + flow v1: the flow flags its
    // stale source, but the delivery is not vetoed.
    let preview = ruth_api::prepare_work_delivery(
        &baby.store,
        DeliveryPrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![baby.req.as_str().to_string(), flow.as_str().to_string()],
        },
    )
    .expect("prepare");
    assert!(preview.can_create);
    assert!(preview.blockers.is_empty());
    assert_eq!(preview.stale_count, 1);
    let flow_entry = preview
        .entries
        .iter()
        .find(|e| e.artifact.id == flow.as_str())
        .expect("flow");
    assert_eq!(flow_entry.stale_sources, vec![req_v1.as_str().to_string()]);
    db.close();
}

fn save_req_version(baby: &mut Baby, content: &str) {
    let expected = current_version(baby);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: expected.as_str().to_string(),
            content: content.to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("save");
}

#[test]
fn create_rejects_changed_since_preview() {
    let tmp = TempDb::new("change");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let v1 = current_version(&baby);
    let input = create_input(&baby, &v1);
    // The project advances before creating: honest conflict, no delivery.
    save_req_version(&mut baby, "Permitir reservas antes de confirmar.");
    let err = ruth_api::create_work_delivery(
        &mut baby.store,
        &mut baby.ids,
        &db,
        input,
        "2026-10-28T12:00:00Z",
    )
    .expect_err("changed");
    assert_eq!(err.kind, "changed_since_preview");
    assert!(
        ruth_api::list_work_deliveries(&baby.store, baby.project.as_str())
            .expect("list")
            .is_empty()
    );
    db.close();
}

#[test]
fn delivery_blocks_delete_and_survives_reopen() {
    let tmp = TempDb::new("reopen");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let v1 = current_version(&baby);
    let input = create_input(&baby, &v1);
    ruth_api::create_work_delivery(
        &mut baby.store,
        &mut baby.ids,
        &db,
        input,
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    // Included in the delivery: deletion blocked with its own code.
    let err = baby
        .store
        .delete_artifact(&baby.project, &baby.req)
        .expect_err("protected");
    assert!(matches!(
        err,
        ruth_core::domain::CoreError::DeleteInDelivery { .. }
    ));
    db.close();
    // Reopening preserves the whole delivery.
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded.store.deliveries().len(), 1);
    let dto = ruth_api::get_work_delivery(
        &loaded.store,
        baby.project.as_str(),
        loaded.store.deliveries()[0].id().as_str(),
    )
    .expect("detail");
    assert_eq!(dto.name, "Monday work");
    assert_eq!(dto.entries.len(), 1);
    db2.close();
}

#[test]
fn delivery_export_identifies_pending_work() {
    let tmp = TempDb::new("export");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let v1 = current_version(&baby);
    let input = create_input(&baby, &v1);
    let dto = ruth_api::create_work_delivery(
        &mut baby.store,
        &mut baby.ids,
        &db,
        input,
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    let files = ruth_api::build_delivery_files(&baby.store, baby.project.as_str(), &dto.id)
        .expect("package");
    let text = |path: &str| {
        let file = files.iter().find(|f| f.path == path).expect(path);
        String::from_utf8(file.bytes.clone()).expect("utf8")
    };
    let readme = text("README.md");
    assert!(readme.contains("Work delivery"), "{readme}");
    assert!(readme.contains("Work status"), "{readme}");
    assert!(
        readme.contains("Not a coherent or verified delivery"),
        "{readme}"
    );
    let manifest: serde_json::Value = serde_json::from_str(&text("manifest.json")).expect("json");
    assert_eq!(manifest["delivery"]["kind"], "work_draft");
    assert_eq!(manifest["counts"]["unreviewed_entries"], 1);
    assert!(manifest.get("baseline").is_none());
    // The preview uses its own identity.
    let preview = ruth_api::export_delivery_preview(&baby.store, baby.project.as_str(), &dto.id)
        .expect("preview");
    assert_eq!(preview.delivery_id, dto.id);
    assert!(!preview.files.is_empty());
    db.close();
}

#[test]
fn approve_still_marks_reviewed() {
    let tmp = TempDb::new("review");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let v1 = current_version(&baby);
    ruth_api::approve_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: v1.as_str().to_string(),
            approver: "bruno".to_string(),
        },
        "2026-10-28",
    )
    .expect("review");
    let preview =
        ruth_api::prepare_work_delivery(&baby.store, prepare_input(&baby)).expect("prepare");
    assert_eq!(preview.unreviewed_count, 0);
    assert!(preview.entries[0].approved_by.is_some());
    db.close();
}
