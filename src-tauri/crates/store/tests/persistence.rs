//! Persistence with temp databases: roundtrip, failures and second instance.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, ArchiveModuleInput, ArchiveRequirementInput, CreateModuleInput,
    CreateRequirementInput, DeleteModuleInput, DeleteRequirementInput, IdGen, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, BaselineId, Content, Date, HumanId, ModuleId, ProjectId,
    VersionId,
};
use ruth_store::{BaselineMetaLog, CodeLinkLog, DesignLog, ProposalLog};
use ruth_store::{
    DbActor, ProposalState, StoreError, StoredDesignGeneration, StoredDesignProposal,
    StoredGeneration, StoredProposal,
};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path =
            std::env::temp_dir().join(format!("ruth-{}-{}-{}.db", name, std::process::id(), n));
        let _ = std::fs::remove_file(&path);
        Self { path }
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
        let _ = std::fs::remove_file(self.path.with_extension("db-journal"));
    }
}

struct Rich {
    store: Store,
    ids: IdGen,
    req: String,
    v1: String,
    v2: String,
    flow: String,
    flow_v1: String,
    flow_v2: String,
}

/// Rich state: requirement with history, derived artifact with exact
/// source, historic approvals and two baselines (the first historic).
fn build_rich() -> Rich {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("project")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let req = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Confirmar una venta descuenta stock.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement");
    let req_id = req.artifact.id.clone();
    let v1 = req.current_version_id.clone();
    ruth_api::approve_version(
        &mut store,
        ApproveVersionInput {
            project_id: project.clone(),
            artifact_id: req_id.clone(),
            expected_version_id: v1.clone(),
            approver: "bruno".to_string(),
        },
        "2026-10-20T10:00:00Z",
    )
    .expect("approve v1");
    let flow = "flujo-ventas".to_string();
    let pid = ProjectId::new(project.clone()).expect("id");
    let mid = ModuleId::new(module.clone()).expect("id");
    let fid = ArtifactId::new(flow.clone()).expect("id");
    let ana = Author::Human(HumanId::new("ana").expect("id"));
    let bruno = Author::Human(HumanId::new("bruno").expect("id"));
    store
        .create_artifact(&pid, &mid, fid.clone(), ArtifactType::Flow)
        .expect("flow");
    let flow_v1 = "flujo-ventas-v1".to_string();
    store
        .create_version(
            &pid,
            &fid,
            None,
            VersionId::new(flow_v1.clone()).expect("id"),
            Content::new("Confirmation flow.").expect("content"),
            &ana,
            &[VersionId::new(v1.clone()).expect("id")],
        )
        .expect("flow v1");
    store
        .approve(
            &pid,
            &fid,
            &VersionId::new(flow_v1.clone()).expect("id"),
            &bruno,
            Date::new("2026-10-21T10:00:00Z").expect("date"),
        )
        .expect("approve flow v1");
    store
        .create_baseline(
            &pid,
            BaselineId::new("base-1").expect("id"),
            &[
                (
                    ArtifactId::new(req_id.clone()).expect("id"),
                    VersionId::new(v1.clone()).expect("id"),
                ),
                (fid.clone(), VersionId::new(flow_v1.clone()).expect("id")),
            ],
            Date::new("2026-10-22T10:00:00Z").expect("date"),
        )
        .expect("base-1");
    let saved = ruth_api::save_version(
        &mut store,
        SaveVersionInput {
            project_id: project.clone(),
            artifact_id: req_id.clone(),
            expected_version_id: v1.clone(),
            content: "Permitir reservas antes de confirmar.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let v2 = saved.current_version_id.clone();
    ruth_api::approve_version(
        &mut store,
        ApproveVersionInput {
            project_id: project.clone(),
            artifact_id: req_id.clone(),
            expected_version_id: v2.clone(),
            approver: "bruno".to_string(),
        },
        "2026-10-23T10:00:00Z",
    )
    .expect("approve v2");
    let flow_v2 = "flujo-ventas-v2".to_string();
    store
        .create_version(
            &pid,
            &fid,
            Some(&VersionId::new(flow_v1.clone()).expect("id")),
            VersionId::new(flow_v2.clone()).expect("id"),
            Content::new("Flujo con reservas.").expect("content"),
            &ana,
            &[VersionId::new(v2.clone()).expect("id")],
        )
        .expect("flow v2");
    store
        .approve(
            &pid,
            &fid,
            &VersionId::new(flow_v2.clone()).expect("id"),
            &bruno,
            Date::new("2026-10-24T10:00:00Z").expect("date"),
        )
        .expect("approve flow v2");
    store
        .create_baseline(
            &pid,
            BaselineId::new("base-2").expect("id"),
            &[
                (
                    ArtifactId::new(req_id.clone()).expect("id"),
                    VersionId::new(v2.clone()).expect("id"),
                ),
                (fid.clone(), VersionId::new(flow_v2.clone()).expect("id")),
            ],
            Date::new("2026-10-25T10:00:00Z").expect("date"),
        )
        .expect("base-2");
    Rich {
        store,
        ids,
        req: req_id,
        v1,
        v2,
        flow,
        flow_v1,
        flow_v2,
    }
}

#[test]
fn roundtrip_preserves_everything_verbatim() {
    let tmp = TempDb::new("roundtrip");
    let rich = build_rich();
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open new");
    assert!(loaded.store.projects().is_empty());
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded2.store, rich.store);
    assert_eq!(loaded2.next_id, rich.ids.checkpoint());
    // Identities intact, nothing regenerated.
    let texts: Vec<&str> = loaded2
        .store
        .versions_of(&ArtifactId::new(rich.req.clone()).expect("id"))
        .iter()
        .map(|v| v.content().as_str())
        .collect();
    assert_eq!(
        texts,
        vec![
            "Confirmar una venta descuenta stock.",
            "Permitir reservas antes de confirmar."
        ]
    );
    assert_eq!(loaded2.store.baselines().len(), 2);
    db2.close();
}

#[test]
fn history_approvals_deps_and_baselines_survive() {
    let tmp = TempDb::new("history");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let req = ArtifactId::new(rich.req.clone()).expect("id");
    let versions = loaded.store.versions_of(&req);
    assert_eq!(versions.len(), 2);
    assert_eq!(loaded.store.approvals_of(versions[0].id()).len(), 1);
    assert_eq!(loaded.store.approvals_of(versions[1].id()).len(), 1);
    let flow = ArtifactId::new(rich.flow.clone()).expect("id");
    let flow_versions = loaded.store.versions_of(&flow);
    assert_eq!(flow_versions.len(), 2);
    // Exact dependency preserved, including the stale one.
    assert_eq!(
        flow_versions[0].sources(),
        &[VersionId::new(rich.v1.clone()).expect("id")]
    );
    assert_eq!(
        flow_versions[1].sources(),
        &[VersionId::new(rich.v2.clone()).expect("id")]
    );
    // Historic baselines with exact pins.
    let base_1 = loaded
        .store
        .baseline(&BaselineId::new("base-1").expect("id"))
        .expect("base-1");
    let pins_1: Vec<&str> = base_1.entries().iter().map(|(_, v)| v.as_str()).collect();
    assert!(pins_1.contains(&rich.v1.as_str()));
    assert!(pins_1.contains(&rich.flow_v1.as_str()));
    let base_2 = loaded
        .store
        .baseline(&BaselineId::new("base-2").expect("id"))
        .expect("base-2");
    let pins_2: Vec<&str> = base_2.entries().iter().map(|(_, v)| v.as_str()).collect();
    assert!(pins_2.contains(&rich.v2.as_str()));
    assert!(pins_2.contains(&rich.flow_v2.as_str()));
    db2.close();
}

#[test]
fn invalid_content_is_rejected_without_overwrite() {
    let tmp = TempDb::new("invalid");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute("UPDATE versions SET content = '' WHERE id = ?", [&rich.v2])
        .expect("tamper");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("read db");
    let err = DbActor::spawn(&tmp.path).expect_err("must fail");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("read db"), bytes_before);
}

#[test]
fn unknown_kind_is_rejected_without_overwrite() {
    let tmp = TempDb::new("kind");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute(
        "UPDATE artifacts SET kind = 'diagram' WHERE id = ?",
        [&rich.req],
    )
    .expect("tamper");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("read db");
    let err = DbActor::spawn(&tmp.path).expect_err("must fail");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("read db"), bytes_before);
}

#[test]
fn future_schema_is_rejected_without_overwrite() {
    let tmp = TempDb::new("future");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute_batch("PRAGMA user_version = 999")
        .expect("tamper");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("read db");
    let err = DbActor::spawn(&tmp.path).expect_err("must fail");
    assert_eq!(
        err,
        StoreError::FutureSchema {
            found: 999,
            supported: ruth_store::SCHEMA_VERSION
        }
    );
    assert_eq!(std::fs::read(&tmp.path).expect("read db"), bytes_before);
}

#[test]
fn corrupt_file_is_rejected() {
    let tmp = TempDb::new("corrupt");
    std::fs::write(&tmp.path, b"this is not sqlite").expect("write");
    let bytes_before = std::fs::read(&tmp.path).expect("read db");
    let err = DbActor::spawn(&tmp.path).expect_err("must fail");
    assert!(matches!(err, StoreError::Corrupt { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("read db"), bytes_before);
}

#[test]
fn open_is_idempotent() {
    let tmp = TempDb::new("idempotent");
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("first");
    assert!(loaded.store.projects().is_empty());
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("second");
    assert!(loaded2.store.projects().is_empty());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn second_instance_is_locked() {
    let tmp = TempDb::new("second");
    let (db_a, _) = DbActor::spawn(&tmp.path).expect("first");
    let err = DbActor::spawn(&tmp.path).expect_err("the second one fails");
    assert!(matches!(err, StoreError::Locked { .. }), "was {err:?}");
    db_a.close();
    let (db_c, _) = DbActor::spawn(&tmp.path).expect("after close");
    db_c.close();
}

#[test]
fn actor_is_send_and_store_is_sync() {
    fn assert_send<T: Send>() {}
    fn assert_sync<T: Sync>() {}
    assert_send::<DbActor>();
    assert_send::<Store>();
    assert_sync::<Store>();
}

/// Minimal project + module + requirement for the generation tests.
fn baby() -> (Store, IdGen, String, String, String) {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("project")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let req = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Confirmar una venta descuenta stock.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement")
    .artifact
    .id;
    (store, ids, project, module, req)
}

fn pending(temp_id: &str) -> StoredProposal {
    StoredProposal {
        temp_id: temp_id.to_string(),
        title: format!("Title {temp_id}"),
        description: format!("Description {temp_id}"),
        acceptance: vec![format!("Criterion {temp_id}")],
        assumptions: vec![],
        state: ProposalState::Pending,
    }
}

fn baby_generation(
    id: &str,
    project: &str,
    module: &str,
    context: Vec<String>,
) -> StoredGeneration {
    StoredGeneration {
        id: id.to_string(),
        project_id: project.to_string(),
        module_id: module.to_string(),
        model: "muse-spark-1.3".to_string(),
        description: "Ventas con control de stock.".to_string(),
        context_version_ids: context,
        template_version: 1,
        input_tokens: Some(100),
        output_tokens: Some(200),
        total_tokens: Some(300),
        created_at: "2026-10-27T12:00:00Z".to_string(),
        questions: vec!["Do reservations expire?".to_string()],
        proposals: vec![pending("p1"), pending("p2")],
    }
}

#[test]
fn generations_roundtrip_with_accept_and_discard() {
    let tmp = TempDb::new("generations");
    let (mut store, mut ids, project, module, req) = baby();
    let v1 = format!("{req}-v1");
    // The accepted artifact must exist in the domain.
    let accepted = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Accepted proposal.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement")
    .artifact
    .id;
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("domain");
    let generation = baby_generation("gen-1", &project, &module, vec![v1.clone()]);
    db.record_generation(&generation, 99).expect("record");
    db.accept_proposal(
        &store,
        ids.checkpoint(),
        "gen-1",
        "p1",
        &accepted,
        "Final content.",
    )
    .expect("accept");
    db.discard_proposal("gen-1", "p2").expect("discard");
    db.discard_proposal("gen-1", "p2")
        .expect("discard is idempotent");
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let again = loaded.proposals.generation("gen-1").expect("generation");
    assert_eq!(again.model, "muse-spark-1.3");
    assert_eq!(again.context_version_ids, vec![v1]);
    assert_eq!(again.template_version, 1);
    assert_eq!(again.total_tokens, Some(300));
    assert_eq!(again.questions, vec!["Do reservations expire?"]);
    assert_eq!(again.proposals.len(), 2);
    assert!(matches!(
        &again.proposals[0].state,
        ProposalState::Accepted { artifact_id, content }
        if artifact_id == &accepted && content == "Final content."
    ));
    assert_eq!(again.proposals[0].acceptance, vec!["Criterion p1"]);
    assert_eq!(again.proposals[1].state, ProposalState::Discarded);
    // The domain coexisted intact.
    assert!(loaded
        .store
        .artifact(&ArtifactId::new(accepted).expect("id"))
        .is_some());
    db2.close();
}

#[test]
fn domain_save_preserves_generations() {
    let tmp = TempDb::new("coexist");
    let (store, ids, project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("domain");
    db.record_generation(
        &baby_generation("gen-1", &project, &module, vec![format!("{req}-v1")]),
        ids.checkpoint(),
    )
    .expect("record");
    // Another domain save (total rewrite) does not touch generations.
    db.save(&store, ids.checkpoint()).expect("re-save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded.proposals.generation("gen-1").is_some());
    db2.close();
}

#[test]
fn accept_requires_pending_proposal() {
    let tmp = TempDb::new("accept-pending");
    let (store, ids, project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("domain");
    db.record_generation(
        &baby_generation("gen-1", &project, &module, vec![format!("{req}-v1")]),
        ids.checkpoint(),
    )
    .expect("record");
    db.accept_proposal(&store, ids.checkpoint(), "gen-1", "p1", &req, "Final.")
        .expect("first acceptance");
    let err = db
        .accept_proposal(&store, ids.checkpoint(), "gen-1", "p1", &req, "Final.")
        .expect_err("the second one fails");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    let err = db
        .accept_proposal(&store, ids.checkpoint(), "gen-1", "pX", &req, "Final.")
        .expect_err("unknown one fails");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    db.close();
}

/// Pinned v1 schema: what milestone 4 used to write. The migration must
/// accept it and preserve its data.
const V1_DDL: &str = "
CREATE TABLE projects(id TEXT PRIMARY KEY);
CREATE TABLE modules(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id));
CREATE TABLE artifacts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    module_id TEXT NOT NULL REFERENCES modules(id), kind TEXT NOT NULL);
CREATE TABLE versions(id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    number INTEGER NOT NULL, content TEXT NOT NULL,
    provenance_kind TEXT NOT NULL, provenance_by TEXT NOT NULL);
CREATE TABLE version_sources(version_id TEXT NOT NULL REFERENCES versions(id),
    pos INTEGER NOT NULL, source_id TEXT NOT NULL REFERENCES versions(id),
    PRIMARY KEY(version_id, pos));
CREATE TABLE approvals(version_id TEXT NOT NULL REFERENCES versions(id),
    approved_by TEXT NOT NULL, at TEXT NOT NULL, pos INTEGER NOT NULL,
    PRIMARY KEY(version_id, approved_by));
CREATE TABLE baselines(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
    at TEXT NOT NULL);
CREATE TABLE baseline_entries(baseline_id TEXT NOT NULL REFERENCES baselines(id),
    artifact_id TEXT NOT NULL REFERENCES artifacts(id),
    version_id TEXT NOT NULL REFERENCES versions(id),
    PRIMARY KEY(baseline_id, artifact_id));
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
";

#[test]
fn v1_database_migrates_preserving_data() {
    let tmp = TempDb::new("migrate-v1");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("project");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("module");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '3')", [])
            .expect("counter");
        raw.execute("PRAGMA user_version = 1", []).expect("v1");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v1");
    assert_eq!(loaded.next_id, 3);
    assert_eq!(loaded.store.projects().len(), 1);
    assert!(loaded.proposals.generation("gen-1").is_none());
    db.close();
    // Reopening confirms the idempotent migration to the current version.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded2.store.projects().len(), 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn generation_with_dangling_refs_is_rejected() {
    let tmp = TempDb::new("dangling");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO generations(id, project_id, module_id, model, description,
             template_version, created_at)
             VALUES ('gen-1', 'proy-X', 'mod-X', 'm', 'd', 1, 't')",
            [],
        )
        .expect("inject");
        raw.execute(
            "INSERT INTO proposals(generation_id, temp_id, title, description, state)
             VALUES ('gen-1', 'p1', 't', 'd', 'pending')",
            [],
        )
        .expect("inject");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("dangling references");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

fn baby_design(
    id: &str,
    project: &str,
    module: &str,
    context: Vec<String>,
) -> StoredDesignGeneration {
    StoredDesignGeneration {
        id: id.to_string(),
        project_id: project.to_string(),
        module_id: module.to_string(),
        kind: "flow".to_string(),
        model: "muse-spark-1.3".to_string(),
        context_version_ids: context,
        template_version: 1,
        input_tokens: Some(100),
        output_tokens: Some(200),
        total_tokens: Some(300),
        created_at: "2026-10-28T12:00:00Z".to_string(),
        questions: vec!["Any retries?".to_string()],
        proposal: StoredDesignProposal {
            title: "Flujo de venta".to_string(),
            spec_json: "{\"title\":\"Flujo de venta\",\"kind\":\"flow\"}".to_string(),
            explanation: "Check stock and confirm.".to_string(),
            state: ProposalState::Pending,
        },
        target_artifact_id: None,
        target_version_id: None,
    }
}

#[test]
fn designs_roundtrip_with_atomic_accept() {
    let tmp = TempDb::new("designs");
    let (mut store, ids, project, module, req) = baby();
    let v1 = format!("{req}-v1");
    // The accepted artifact (flow) exists in the domain.
    let flow = ruth_core::domain::ArtifactId::new("flujo-9").expect("id");
    store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(module.clone()).expect("id"),
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flow");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("domain");
    db.record_design(
        &baby_design("gen-1", &project, &module, vec![v1.clone()]),
        ids.checkpoint(),
    )
    .expect("record");
    db.accept_design(&store, ids.checkpoint(), "gen-1", "flujo-9", "{\"a\":1}")
        .expect("accept");
    // Second acceptance: the proposal is no longer pending, all intact.
    let err = db
        .accept_design(&store, ids.checkpoint(), "gen-1", "flujo-9", "{\"a\":1}")
        .expect_err("repeat fails");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let again = loaded.designs.design("gen-1").expect("design");
    assert_eq!(again.kind, "flow");
    assert_eq!(again.context_version_ids, vec![v1]);
    assert_eq!(again.questions, vec!["Any retries?"]);
    assert!(matches!(
        &again.proposal.state,
        ProposalState::Accepted { artifact_id, content }
        if artifact_id == "flujo-9" && content == "{\"a\":1}"
    ));
    db2.close();
}

/// Pinned v2 delta: what milestone 5 added over v1. The v2→v3 migration
/// must accept it and preserve its data.
const V2_DDL: &str = "
CREATE TABLE generations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    module_id TEXT NOT NULL, model TEXT NOT NULL, description TEXT NOT NULL,
    template_version INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    total_tokens INTEGER, created_at TEXT NOT NULL);
CREATE TABLE generation_context(generation_id TEXT NOT NULL REFERENCES generations(id),
    pos INTEGER NOT NULL, version_id TEXT NOT NULL, PRIMARY KEY(generation_id, pos));
CREATE TABLE generation_questions(generation_id TEXT NOT NULL REFERENCES generations(id),
    pos INTEGER NOT NULL, question TEXT NOT NULL, PRIMARY KEY(generation_id, pos));
CREATE TABLE proposals(generation_id TEXT NOT NULL REFERENCES generations(id),
    temp_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
    state TEXT NOT NULL, artifact_id TEXT, accepted_content TEXT,
    PRIMARY KEY(generation_id, temp_id));
CREATE TABLE proposal_acceptance(generation_id TEXT NOT NULL, temp_id TEXT NOT NULL,
    pos INTEGER NOT NULL, item TEXT NOT NULL, PRIMARY KEY(generation_id, temp_id, pos),
    FOREIGN KEY(generation_id, temp_id) REFERENCES proposals(generation_id, temp_id));
CREATE TABLE proposal_assumptions(generation_id TEXT NOT NULL, temp_id TEXT NOT NULL,
    pos INTEGER NOT NULL, item TEXT NOT NULL, PRIMARY KEY(generation_id, temp_id, pos),
    FOREIGN KEY(generation_id, temp_id) REFERENCES proposals(generation_id, temp_id));
";

#[test]
fn v2_database_migrates_preserving_data() {
    let tmp = TempDb::new("migrate-v2");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("project");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("module");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind) VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artifact");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Content.', 'human', 'ana')",
            [],
        )
        .expect("version");
        raw.execute(
            "INSERT INTO generations(id, project_id, module_id, model, description,
             template_version, created_at)
             VALUES ('gen-1', 'proy-1', 'mod-2', 'm', 'd', 1, 't')",
            [],
        )
        .expect("generation");
        raw.execute(
            "INSERT INTO generation_context(generation_id, pos, version_id)
             VALUES ('gen-1', 0, 'req-3-v1')",
            [],
        )
        .expect("context");
        raw.execute(
            "INSERT INTO proposals(generation_id, temp_id, title, description, state)
             VALUES ('gen-1', 'p1', 't', 'd', 'pending')",
            [],
        )
        .expect("proposal");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '4')", [])
            .expect("counter");
        raw.execute("PRAGMA user_version = 2", []).expect("v2");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v2");
    assert_eq!(loaded.next_id, 4);
    // Domain and v2 generations intact; designs empty.
    assert!(loaded
        .store
        .artifact(&ruth_core::domain::ArtifactId::new("req-3").expect("id"))
        .is_some());
    let gen = loaded.proposals.generation("gen-1").expect("generation");
    assert_eq!(gen.context_version_ids, vec!["req-3-v1"]);
    assert_eq!(gen.proposals.len(), 1);
    assert!(loaded.designs.design("gen-1").is_none());
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2.proposals.generation("gen-1").is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

const V3_DESIGN_DDL: &str = "
CREATE TABLE design_generations(id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    module_id TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,
    template_version INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    total_tokens INTEGER, created_at TEXT NOT NULL);
CREATE TABLE design_context(generation_id TEXT NOT NULL REFERENCES design_generations(id),
    pos INTEGER NOT NULL, version_id TEXT NOT NULL, PRIMARY KEY(generation_id, pos));
CREATE TABLE design_questions(generation_id TEXT NOT NULL REFERENCES design_generations(id),
    pos INTEGER NOT NULL, question TEXT NOT NULL, PRIMARY KEY(generation_id, pos));
CREATE TABLE design_proposals(generation_id TEXT PRIMARY KEY REFERENCES design_generations(id),
    title TEXT NOT NULL, spec_json TEXT NOT NULL, explanation TEXT NOT NULL,
    state TEXT NOT NULL, artifact_id TEXT, accepted_content TEXT);
";

#[test]
fn v3_database_migrates_preserving_designs_without_target() {
    let tmp = TempDb::new("migrate-v3");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute_batch(V3_DESIGN_DDL).expect("v3");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("project");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("module");
        raw.execute(
            "INSERT INTO design_generations(id, project_id, module_id, kind, model,
             template_version, created_at)
             VALUES ('gen-1', 'proy-1', 'mod-2', 'flow', 'm', 1, 't')",
            [],
        )
        .expect("generation");
        raw.execute(
            "INSERT INTO design_proposals(generation_id, title, spec_json, explanation, state)
             VALUES ('gen-1', 't', '{}', 'e', 'pending')",
            [],
        )
        .expect("proposal");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '5')", [])
            .expect("counter");
        raw.execute("PRAGMA user_version = 3", []).expect("v3");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v3");
    let gen = loaded.designs.design("gen-1").expect("design");
    assert_eq!(gen.kind, "flow");
    assert_eq!(gen.target_artifact_id, None);
    assert_eq!(gen.target_version_id, None);
    db.close();
    // Reopening is idempotent and leaves the schema at the current version.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2.designs.design("gen-1").is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let columns: Vec<String> = raw
        .prepare("PRAGMA table_info(design_generations)")
        .expect("columns")
        .query_map([], |row| row.get(1))
        .expect("rows")
        .collect::<Result<_, _>>()
        .expect("names");
    assert!(columns.iter().any(|c| c == "target_artifact_id"));
    assert!(columns.iter().any(|c| c == "target_version_id"));
}

#[test]
fn v4_database_migrates_preserving_baselines_without_meta() {
    let tmp = TempDb::new("migrate-v4");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute_batch(V3_DESIGN_DDL).expect("v3");
        raw.execute_batch(
            "ALTER TABLE design_generations ADD COLUMN target_artifact_id TEXT;
             ALTER TABLE design_generations ADD COLUMN target_version_id TEXT;",
        )
        .expect("v4");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("project");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("module");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind)
             VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artifact");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Content.', 'human', 'ana')",
            [],
        )
        .expect("version");
        raw.execute(
            "INSERT INTO approvals(version_id, approved_by, at, pos)
             VALUES ('req-3-v1', 'ana', 't', 0)",
            [],
        )
        .expect("approval");
        raw.execute(
            "INSERT INTO baselines(id, project_id, at) VALUES ('base-1', 'proy-1', 't')",
            [],
        )
        .expect("baseline");
        raw.execute(
            "INSERT INTO baseline_entries(baseline_id, artifact_id, version_id)
             VALUES ('base-1', 'req-3', 'req-3-v1')",
            [],
        )
        .expect("entry");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '6')", [])
            .expect("counter");
        raw.execute("PRAGMA user_version = 4", []).expect("v4");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v4");
    let baseline = loaded
        .store
        .baseline(&ruth_core::domain::BaselineId::new("base-1").expect("id"))
        .expect("baseline");
    assert_eq!(baseline.entries().len(), 1);
    assert!(loaded.baseline_meta.get("base-1").is_none());
    db.close();
    // Reopening is idempotent and leaves the schema at the current version.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2
        .store
        .baseline(&ruth_core::domain::BaselineId::new("base-1").expect("id"))
        .is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let tables: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'baseline_meta'",
            [],
            |row| row.get(0),
        )
        .expect("table");
    assert_eq!(tables, 1);
}

#[test]
fn baseline_meta_roundtrips_across_reopen() {
    use ruth_core::domain::{BaselineId, Date, ProjectId, VersionId};
    use ruth_store::BaselineMeta;

    let tmp = TempDb::new("baseline-meta");
    let (mut store, ids, project, _module, req) = baby();
    let project_id = ProjectId::new(project.clone()).expect("id");
    let version = VersionId::new(format!("{req}-v1")).expect("id");
    store
        .approve(
            &project_id,
            &ruth_core::domain::ArtifactId::new(req.clone()).expect("id"),
            &version,
            &ruth_core::domain::Author::Human(
                ruth_core::domain::HumanId::new("ana").expect("author"),
            ),
            Date::new("2026-10-28T12:00:00Z").expect("date"),
        )
        .expect("approve");
    store
        .create_baseline(
            &project_id,
            BaselineId::new("base-1").expect("id"),
            &[(
                ruth_core::domain::ArtifactId::new(req).expect("id"),
                version,
            )],
            Date::new("2026-10-28T12:00:00Z").expect("date"),
        )
        .expect("baseline");
    let meta = BaselineMeta {
        baseline_id: "base-1".to_string(),
        name: "Entrega 1".to_string(),
        description: Some("Ventas".to_string()),
        scope_module: Some("mod-2".to_string()),
        created_at: "2026-10-28T12:00:00Z".to_string(),
    };
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.create_baseline(&store, ids.checkpoint(), &meta)
        .expect("create");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let back = loaded.baseline_meta.get("base-1").expect("meta");
    assert_eq!(back.name, "Entrega 1");
    assert_eq!(back.description.as_deref(), Some("Ventas"));
    assert_eq!(back.scope_module.as_deref(), Some("mod-2"));
    assert!(loaded
        .store
        .baseline(&BaselineId::new("base-1").expect("id"))
        .is_some());
    db2.close();
}

#[test]
fn baseline_meta_with_dangling_refs_is_rejected() {
    let tmp = TempDb::new("meta-dangling");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO baseline_meta(baseline_id, name, created_at)
             VALUES ('base-9', 'Broken', 't')",
            [],
        )
        .expect("force");
    }
    let err = DbActor::spawn(&tmp.path).expect_err("must fail");
    assert!(
        matches!(err, ruth_store::StoreError::InvalidData { .. }),
        "was {err:?}"
    );
}

#[test]
fn design_update_target_roundtrips_across_reopen() {
    let tmp = TempDb::new("design-target");
    let (mut store, ids, project, module, req) = baby();
    let flow = ruth_core::domain::ArtifactId::new("flujo-9").expect("id");
    store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(module.clone()).expect("id"),
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flow");
    store
        .create_version(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &flow,
            None,
            ruth_core::domain::VersionId::new("flujo-9-v1").expect("id"),
            ruth_core::domain::Content::new("{}").expect("content"),
            &ruth_core::domain::Author::Human(
                ruth_core::domain::HumanId::new("ana").expect("author"),
            ),
            &[ruth_core::domain::VersionId::new(format!("{req}-v1")).expect("id")],
        )
        .expect("version");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("domain");
    let mut gen = baby_design("gen-1", &project, &module, vec![format!("{req}-v1")]);
    gen.target_artifact_id = Some("flujo-9".to_string());
    gen.target_version_id = Some("flujo-9-v1".to_string());
    db.record_design(&gen, ids.checkpoint()).expect("record");
    db.close();
    let (_db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let back = loaded.designs.design("gen-1").expect("design");
    assert_eq!(back.target_artifact_id.as_deref(), Some("flujo-9"));
    assert_eq!(back.target_version_id.as_deref(), Some("flujo-9-v1"));
}

#[test]
fn design_with_dangling_refs_is_rejected() {
    let tmp = TempDb::new("design-dangling");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO design_generations(id, project_id, module_id, kind, model,
             template_version, created_at)
             VALUES ('gen-1', 'proy-X', 'mod-X', 'flow', 'm', 1, 't')",
            [],
        )
        .expect("inject");
        raw.execute(
            "INSERT INTO design_proposals(generation_id, title, spec_json, explanation, state)
             VALUES ('gen-1', 't', '{}', 'e', 'pending')",
            [],
        )
        .expect("inject");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("dangling references");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn repeated_saves_keep_baselines_and_meta() {
    use ruth_store::BaselineMeta;

    // Milestone 9 regression: the second save over a database with
    // baselines used to fail with FOREIGN KEY (`projects` was emptied
    // before `baselines`).
    let tmp = TempDb::new("baseline-saves");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("first save");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("second save with baselines");
    // Metadata survives later full saves.
    let meta = BaselineMeta {
        baseline_id: "base-2".to_string(),
        name: "Entrega 2".to_string(),
        description: None,
        scope_module: None,
        created_at: "2026-10-25T10:00:00Z".to_string(),
    };
    db.create_baseline(&rich.store, rich.ids.checkpoint(), &meta)
        .expect("metadata");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("save after metadata");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded.store.baselines().len(), 2);
    assert_eq!(
        loaded.baseline_meta.get("base-2").expect("meta").name,
        "Entrega 2"
    );
    db2.close();
}

#[test]
fn v5_database_migrates_preserving_everything_without_layouts() {
    let tmp = TempDb::new("migrate-v5");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute_batch(V3_DESIGN_DDL).expect("v3");
        raw.execute_batch(
            "ALTER TABLE design_generations ADD COLUMN target_artifact_id TEXT;
             ALTER TABLE design_generations ADD COLUMN target_version_id TEXT;",
        )
        .expect("v4");
        raw.execute_batch(
            "CREATE TABLE baseline_meta(
                baseline_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                scope_module TEXT,
                created_at TEXT NOT NULL
            );",
        )
        .expect("v5");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("project");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("module");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind)
             VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artifact");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Content.', 'human', 'ana')",
            [],
        )
        .expect("version");
        raw.execute(
            "INSERT INTO approvals(version_id, approved_by, at, pos)
             VALUES ('req-3-v1', 'ana', 't', 0)",
            [],
        )
        .expect("approval");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '6')", [])
            .expect("counter");
        raw.execute("PRAGMA user_version = 5", []).expect("v5");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v5");
    // Data intact and without layouts (automatic placement).
    let version = loaded
        .store
        .version(&ruth_core::domain::VersionId::new("req-3-v1").expect("id"))
        .expect("version");
    assert_eq!(version.content().as_str(), "Content.");
    assert!(loaded.layouts.get("req-3", "req-3-v1").is_none());
    db.close();
    // Reopening is idempotent and leaves the schema at the current version.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2
        .store
        .version(&ruth_core::domain::VersionId::new("req-3-v1").expect("id"))
        .is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let tables: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'design_layouts'",
            [],
            |row| row.get(0),
        )
        .expect("table");
    assert_eq!(tables, 1);
}

#[test]
fn v6_database_migrates_with_everything_active() {
    let tmp = TempDb::new("migrate-v6");
    let (store, ids, _project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    // Downgrade to v6: drop the columns and mark the previous version.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("ALTER TABLE modules DROP COLUMN archived", [])
            .expect("downgrade");
        raw.execute("ALTER TABLE artifacts DROP COLUMN archived", [])
            .expect("downgrade");
        raw.execute("PRAGMA user_version = 6", []).expect("v6");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v6");
    // All active and data intact.
    let module_ref = loaded
        .store
        .module(&ModuleId::new(module).expect("id"))
        .expect("module");
    assert!(!module_ref.archived());
    let artifact = loaded
        .store
        .artifact(&ArtifactId::new(req).expect("id"))
        .expect("requirement");
    assert!(!artifact.archived());
    assert!(loaded.store.current_version(artifact.id()).is_some());
    db.close();
    // Reopening confirms the idempotent migration to v7.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2.store.projects().len() == 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let columns: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('artifacts') WHERE name = 'archived'",
            [],
            |row| row.get(0),
        )
        .expect("column");
    assert_eq!(columns, 1);
}

#[test]
fn archived_flags_roundtrip() {
    let tmp = TempDb::new("archived");
    let (mut store, mut ids, project, module, req) = baby();
    ruth_api::archive_module(
        &mut store,
        ArchiveModuleInput {
            project_id: project.clone(),
            module_id: module.clone(),
        },
    )
    .expect("archive module");
    // A second requirement archived individually inside another module.
    let other = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let detail = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: other.clone(),
            content: "Another requirement.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement");
    ruth_api::archive_requirement(
        &mut store,
        ArchiveRequirementInput {
            project_id: project.clone(),
            artifact_id: detail.artifact.id.clone(),
        },
    )
    .expect("archive requirement");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let module_ref = loaded
        .store
        .module(&ModuleId::new(module).expect("id"))
        .expect("module");
    assert!(module_ref.archived());
    // The content keeps its individual flag (active) even if its module does not.
    let inner = loaded
        .store
        .artifact(&ArtifactId::new(req).expect("id"))
        .expect("requirement");
    assert!(!inner.archived());
    assert!(loaded.store.is_effectively_archived(inner.id()));
    let solo = loaded
        .store
        .artifact(&ArtifactId::new(detail.artifact.id).expect("id"))
        .expect("other");
    assert!(solo.archived());
    let other_ref = loaded
        .store
        .module(&ModuleId::new(other).expect("id"))
        .expect("module");
    assert!(!other_ref.archived());
    // Histories intact under archiving.
    assert_eq!(loaded.store.versions_of(inner.id()).len(), 1);
    db2.close();
}

#[test]
fn delete_persists_and_keeps_the_rest() {
    let tmp = TempDb::new("deleted");
    let (mut store, ids, project, module, req) = baby();
    let proposals = ProposalLog::new();
    let designs = DesignLog::new();
    let metalog = BaselineMetaLog::new();
    let links = CodeLinkLog::new();
    ruth_api::delete_requirement_checked(
        &mut store,
        &proposals,
        &designs,
        &links,
        DeleteRequirementInput {
            project_id: project.clone(),
            artifact_id: req.clone(),
        },
    )
    .expect("delete requirement");
    ruth_api::delete_module_checked(
        &mut store,
        &proposals,
        &designs,
        &metalog,
        &links,
        DeleteModuleInput {
            project_id: project.clone(),
            module_id: module.clone(),
        },
    )
    .expect("delete module");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded
        .store
        .artifact(&ArtifactId::new(req).expect("id"))
        .is_none());
    assert!(loaded
        .store
        .module(&ModuleId::new(module).expect("id"))
        .is_none());
    assert_eq!(loaded.store.projects().len(), 1);
    db2.close();
}

#[test]
fn invalid_archived_flag_is_rejected_without_overwrite() {
    let tmp = TempDb::new("bad-flag");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("UPDATE artifacts SET archived = 7", [])
            .expect("inject");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("invalid flag");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn v7_database_migrates_with_names_from_ids_and_no_titles() {
    let tmp = TempDb::new("migrate-v7");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    // Downgrade to v7: drop columns/table and mark the previous version.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("ALTER TABLE projects DROP COLUMN name", [])
            .expect("downgrade");
        raw.execute("ALTER TABLE modules DROP COLUMN name", [])
            .expect("downgrade");
        raw.execute("ALTER TABLE artifacts DROP COLUMN title", [])
            .expect("downgrade");
        raw.execute("ALTER TABLE baseline_entries DROP COLUMN title", [])
            .expect("downgrade");
        raw.execute("DROP TABLE title_history", [])
            .expect("downgrade");
        raw.execute("PRAGMA user_version = 7", []).expect("v7");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v7");
    // Names = IDs, no titles, empty history, data intact.
    let project = &loaded.store.projects()[0];
    assert_eq!(project.name(), project.id().as_str());
    let module = &loaded.store.modules_of(project.id())[0];
    assert_eq!(module.name(), module.id().as_str());
    let artifact = &loaded.store.artifacts_of(project.id(), module.id())[0];
    assert_eq!(artifact.title(), None);
    assert!(loaded.store.title_changes().is_empty());
    assert!(loaded.store.current_version(artifact.id()).is_some());
    db.close();
    // Reopening confirms the idempotent migration to v8.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded2.store.projects().len(), 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn names_titles_and_history_roundtrip() {
    let tmp = TempDb::new("names");
    let (mut store, ids, project, module, req) = baby();
    let project_id = ruth_core::domain::ProjectId::new(project.clone()).expect("id");
    let module_id = ruth_core::domain::ModuleId::new(module.clone()).expect("id");
    let req_id = ruth_core::domain::ArtifactId::new(req.clone()).expect("id");
    store
        .rename_project(
            &project_id,
            &project,
            ruth_core::domain::Name::new("Ventas 2026".to_string()).expect("n"),
        )
        .expect("project");
    store
        .rename_module(
            &project_id,
            &module_id,
            &module,
            ruth_core::domain::Name::new("Mostrador".to_string()).expect("n"),
        )
        .expect("module");
    store
        .rename_artifact(
            &project_id,
            &req_id,
            None,
            ruth_core::domain::Name::new("First title".to_string()).expect("n"),
            &ruth_core::domain::HumanId::new("ana").expect("id"),
            ruth_core::domain::Date::new("2026-10-28").expect("f"),
        )
        .expect("title");
    store
        .rename_artifact(
            &project_id,
            &req_id,
            Some("First title"),
            ruth_core::domain::Name::new("Second title".to_string()).expect("n"),
            &ruth_core::domain::HumanId::new("bruno").expect("id"),
            ruth_core::domain::Date::new("2026-10-28").expect("f"),
        )
        .expect("title");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(
        loaded.store.project(&project_id).expect("p").name(),
        "Ventas 2026"
    );
    assert_eq!(
        loaded.store.module(&module_id).expect("m").name(),
        "Mostrador"
    );
    assert_eq!(
        loaded.store.artifact(&req_id).expect("a").title(),
        Some("Second title")
    );
    let history: Vec<&str> = loaded
        .store
        .title_history(&req_id)
        .iter()
        .map(|c| c.title())
        .collect();
    assert_eq!(history, vec!["First title", "Second title"]);
    db2.close();
}

#[test]
fn invalid_name_is_rejected_without_overwrite() {
    let tmp = TempDb::new("bad-name");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("UPDATE projects SET name = ''", [])
            .expect("inject");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("invalid name");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn v8_database_migrates_with_empty_deliveries() {
    let tmp = TempDb::new("migrate-v8");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    // Downgrade to v8: drop the delivery tables and mark the version.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("DROP TABLE work_delivery_entries", [])
            .expect("downgrade");
        raw.execute("DROP TABLE work_deliveries", [])
            .expect("downgrade");
        raw.execute("PRAGMA user_version = 8", []).expect("v8");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v8");
    assert!(loaded.store.deliveries().is_empty());
    assert_eq!(loaded.store.projects().len(), 1);
    db.close();
    // Reopening confirms the idempotent migration to v9.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded2.store.deliveries().is_empty());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn delivery_roundtrip_preserves_entries_and_titles() {
    use ruth_core::domain::DeliveryId;
    let tmp = TempDb::new("delivery");
    let (mut store, ids, project, module, req) = baby();
    let project_id = ProjectId::new(project).expect("id");
    let module_id = ModuleId::new(module).expect("id");
    let req_id = ArtifactId::new(req).expect("id");
    let v1 = store
        .current_version(&req_id)
        .expect("current")
        .id()
        .clone();
    store
        .rename_artifact(
            &project_id,
            &req_id,
            None,
            ruth_core::domain::Name::new("Confirmar venta".to_string()).expect("name"),
            &HumanId::new("ana").expect("id"),
            Date::new("2026-10-28").expect("date"),
        )
        .expect("title");
    store
        .create_work_delivery(
            &project_id,
            DeliveryId::new("entrega-1").expect("id"),
            "Trabajo".to_string(),
            Some("for the demo".to_string()),
            Some(module_id.clone()),
            std::slice::from_ref(&(req_id.clone(), v1.clone())),
            Date::new("2026-10-28T12:00:00Z").expect("date"),
        )
        .expect("delivery");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let deliveries = loaded.store.deliveries();
    assert_eq!(deliveries.len(), 1);
    let delivery = deliveries[0];
    assert_eq!(delivery.name(), "Trabajo");
    assert_eq!(delivery.description(), Some("for the demo"));
    assert_eq!(delivery.scope_module(), Some(&module_id));
    assert_eq!(delivery.entries(), &[(req_id.clone(), v1)]);
    assert_eq!(delivery.title_of(&req_id), Some(Some("Confirmar venta")));
    db2.close();
}

#[test]
fn dangling_delivery_entry_is_rejected_without_overwrite() {
    let tmp = TempDb::new("bad-delivery");
    let (mut store, ids, project, module, req) = baby();
    let project_id = ProjectId::new(project).expect("id");
    let module_id = ModuleId::new(module).expect("id");
    let req_id = ArtifactId::new(req).expect("id");
    let v1 = store
        .current_version(&req_id)
        .expect("current")
        .id()
        .clone();
    store
        .create_work_delivery(
            &project_id,
            ruth_core::domain::DeliveryId::new("entrega-1").expect("id"),
            "Trabajo".to_string(),
            None,
            Some(module_id),
            std::slice::from_ref(&(req_id, v1)),
            Date::new("2026-10-28T12:00:00Z").expect("date"),
        )
        .expect("delivery");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, ids.checkpoint()).expect("save");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("PRAGMA foreign_keys = OFF", []).expect("no fk");
        raw.execute(
            "UPDATE work_delivery_entries SET version_id = 'req-1-v99'",
            [],
        )
        .expect("inject");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("dangling entry");
    assert!(matches!(err, StoreError::InvalidData { .. }), "was {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn v9_database_migrates_to_v10_preserving_data() {
    use ruth_store::MockupLog;
    let tmp = TempDb::new("migrate-v9");
    // Database with data on the current schema.
    let mut store = Store::new();
    let project = ProjectId::new("proy-1".to_string()).expect("project");
    store.create_project(project.clone()).expect("create");
    let module = ModuleId::new("mod-2".to_string()).expect("module");
    store
        .create_module(&project, module.clone())
        .expect("create");
    {
        let (db, _) = DbActor::spawn(&tmp.path).expect("open");
        db.save(&store, 3).expect("save");
        db.close();
    }
    // Simulate a v9 database: no screen tables and version 9.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(
            "DROP TABLE mockup_proposals;
             DROP TABLE mockup_questions;
             DROP TABLE mockup_context;
             DROP TABLE mockup_generations;",
        )
        .expect("trim to v9");
        raw.execute("PRAGMA user_version = 9", []).expect("v9");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open v9");
    assert_eq!(loaded.store.projects().len(), 1);
    assert_eq!(loaded.next_id, 3);
    assert_eq!(loaded.mockups, MockupLog::new());
    db.close();
    // Reopening confirms the idempotent migration to the current version.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded2.store.projects().len(), 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let tables: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
             WHERE name IN ('mockup_generations', 'mockup_proposals')",
            [],
            |row| row.get(0),
        )
        .expect("tables");
    assert_eq!(tables, 2);
}

#[test]
fn mockup_proposals_roundtrip_and_reject_dangling_accepts() {
    use ruth_store::{StoredMockupGeneration, StoredMockupProposal};
    let tmp = TempDb::new("screens");
    let mut store = Store::new();
    let project = ProjectId::new("proy-1".to_string()).expect("project");
    store.create_project(project.clone()).expect("create");
    let module = ModuleId::new("mod-2".to_string()).expect("module");
    store
        .create_module(&project, module.clone())
        .expect("create");
    let generation = StoredMockupGeneration {
        id: "gen-1".to_string(),
        project_id: "proy-1".to_string(),
        module_id: "mod-2".to_string(),
        model: "m".to_string(),
        context_version_ids: vec![],
        template_version: 1,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "t".to_string(),
        questions: vec!["q".to_string()],
        proposals: vec![StoredMockupProposal {
            temp_id: "p1".to_string(),
            title: "T".to_string(),
            spec_json: "{}".to_string(),
            explanation: "E".to_string(),
            state: ProposalState::Pending,
        }],
    };
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&store, 3).expect("domain");
    db.record_mockup(&generation, 99).expect("record");
    db.discard_mockup("gen-1", "p1").expect("discard");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let back = loaded.mockups.generation("gen-1").expect("generation");
    assert_eq!(back.questions, vec!["q".to_string()]);
    assert!(matches!(back.proposals[0].state, ProposalState::Discarded));
    db2.close();
    // Accepting a missing artifact is rejected on load.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "UPDATE mockup_proposals SET state = 'accepted', artifact_id = 'mockup-9',
             accepted_content = '{}' WHERE generation_id = 'gen-1' AND temp_id = 'p1'",
            [],
        )
        .expect("inject");
    }
    let err = DbActor::spawn(&tmp.path).expect_err("dangling reference");
    assert!(matches!(err, StoreError::InvalidData { .. }));
}

#[test]
fn code_roots_roundtrip_verbatim_including_missing() {
    let tmp = TempDb::new("roots");
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("open");
    assert!(loaded.code_roots.roots().is_empty());
    let roots = vec![
        ruth_code::CodeRoot {
            id: "root-1".to_string(),
            path: "/tmp/ruth-real".to_string(),
            name: "real".to_string(),
            project_id: None,
        },
        ruth_code::CodeRoot {
            id: "root-2".to_string(),
            path: "/does/not/exist".to_string(),
            name: "old".to_string(),
            project_id: None,
        },
    ];
    db.save_code_roots(&roots, 7).expect("save");
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reopen");
    // Verbatim order and content, including the disk-missing root.
    assert_eq!(loaded2.code_roots.roots(), &roots);
    // The counter travels with the roots: no ID reuse after reopen.
    assert_eq!(loaded2.next_id, 7);
    db2.close();
}

#[test]
fn v10_database_migrates_adding_code_roots() {
    let tmp = TempDb::new("migrate-v10");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    db.close();
    // Simulate a v10 database: no roots table and previous version.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch("DROP TABLE code_roots; PRAGMA user_version = 10;")
            .expect("downgrade to v10");
    }
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("open v10");
    assert_eq!(loaded.store, rich.store);
    assert!(loaded.code_roots.roots().is_empty());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let table: String = raw
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'code_roots'",
            [],
            |row| row.get(0),
        )
        .expect("table created");
    assert_eq!(table, "code_roots");
}

#[test]
fn v11_database_migrates_preserving_roots_and_adding_links() {
    let tmp = TempDb::new("migrate-v11");
    let rich = build_rich();
    let project = "proy-1".to_string();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("save");
    // v11-style root (no project): inserted with the current shape and
    // the database downgraded by dropping the column.
    db.save_code_roots(
        &[ruth_code::CodeRoot {
            id: "root-1".to_string(),
            path: "/tmp/ruth-v11".to_string(),
            name: "v11".to_string(),
            project_id: None,
        }],
        rich.ids.checkpoint(),
    )
    .expect("root");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(
            "DROP TABLE code_links; DROP TABLE structure_snapshots;
             DROP TABLE code_proposal_files; DROP TABLE code_gen_notes;
             DROP TABLE code_gen_scope; DROP TABLE code_gen_screen_sources;
             DROP TABLE code_generations;
             ALTER TABLE code_roots DROP COLUMN project_id;
             PRAGMA user_version = 11;",
        )
        .expect("downgrade to v11");
    }
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("open v11");
    // Domain intact, root preserved as loose and new logs empty.
    assert!(loaded
        .store
        .project(&ProjectId::new(project).expect("id"))
        .is_some());
    assert_eq!(loaded.code_roots.roots().len(), 1);
    assert_eq!(loaded.code_roots.roots()[0].id, "root-1");
    assert_eq!(loaded.code_roots.roots()[0].project_id, None);
    assert!(loaded.code_links.all().is_empty());
    assert!(loaded.snapshots.all().is_empty());
    assert!(loaded.codegen.all().is_empty());
    db2.close();
    // Idempotency: reopening neither duplicates nor loses.
    let (db3, loaded3) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded3.code_roots.roots().len(), 1);
    db3.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn links_and_snapshots_roundtrip_and_reject_dangling() {
    let tmp = TempDb::new("links");
    let rich = build_rich();
    let repo = tmp.path.with_extension("repo");
    let _ = std::fs::remove_dir_all(&repo);
    std::fs::create_dir_all(repo.join("src")).expect("repo");
    std::fs::write(repo.join("src").join("a.ts"), "const a = 1;\n").expect("fixture");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("domain");
    let roots = vec![ruth_code::CodeRoot {
        id: "root-1".to_string(),
        path: repo.display().to_string(),
        name: "repo".to_string(),
        project_id: Some("proy-1".to_string()),
    }];
    db.save_code_roots(&roots, rich.ids.checkpoint())
        .expect("roots");
    let mut log = ruth_store::CodeLinkLog::new();
    log.record(ruth_store::StoredCodeLink {
        id: "link-1".to_string(),
        scope: ruth_store::LinkScope::Module,
        owner_id: "mod-2".to_string(),
        root_id: "root-1".to_string(),
        rel: "src".to_string(),
        symbol: None,
        kind: ruth_store::LinkKind::Manual,
        created_at: "t".to_string(),
    })
    .expect("link");
    db.save_code_link(&log.all()[0], rich.ids.checkpoint())
        .expect("save link");
    let mut snaps = ruth_store::SnapshotLog::new();
    snaps
        .record(ruth_store::StoredSnapshot {
            id: "snap-1".to_string(),
            project_id: Some("proy-1".to_string()),
            name: "Analysis 1".to_string(),
            created_at: "t".to_string(),
            files_json: r#"[{"rootId":"root-1","rel":"src/a.ts","hash":"ab12","bytes":14}]"#
                .to_string(),
            result_json: r#"{"files":[],"symbols":[],"relations":[]}"#.to_string(),
        })
        .expect("snapshot");
    db.save_snapshot(&snaps.all()[0], rich.ids.checkpoint())
        .expect("save snapshot");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    assert_eq!(loaded.code_links.all().len(), 1);
    assert_eq!(loaded.snapshots.all().len(), 1);
    assert_eq!(
        loaded.code_roots.roots()[0].project_id.as_deref(),
        Some("proy-1")
    );
    db2.delete_code_link("link-1").expect("remove link");
    db2.delete_snapshot("snap-1").expect("remove snapshot");
    // Removing twice fails without breaking anything.
    assert!(db2.delete_code_link("link-1").is_err());
    db2.close();
    let (db3, loaded3) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded3.code_links.all().is_empty());
    assert!(loaded3.snapshots.all().is_empty());
    db3.close();
    // Dangling link (missing owner) = tampered database.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO code_links(id, scope, owner_id, root_id, rel, kind, created_at)
             VALUES ('link-9', 'module', 'mod-999', 'root-1', 'src', 'manual', 't')",
            [],
        )
        .expect("tamper");
    }
    let err = DbActor::spawn(&tmp.path).expect_err("dangling");
    assert!(matches!(err, StoreError::InvalidData { .. }));
    let _ = std::fs::remove_dir_all(&repo);
}

#[test]
fn codegen_roundtrip_accept_discard_reopen() {
    let tmp = TempDb::new("codegen");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("domain");
    let generation = ruth_store::StoredCodeGeneration {
        id: "cgen-1".to_string(),
        project_id: "proy-1".to_string(),
        module_id: "mod-2".to_string(),
        requirement_artifact_id: "req-3".to_string(),
        requirement_version_id: "req-3-v1".to_string(),
        screen_artifact_id: String::new(),
        screen_id: String::new(),
        screen_version_id: String::new(),
        screen_sources: vec![],
        model: "m".to_string(),
        template_version: 1,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "t".to_string(),
        explanation: "E".to_string(),
        scope: vec![ruth_store::CodeScopeEntry {
            root_id: "root-1".to_string(),
            rel: "a.ts".to_string(),
            fingerprint: "9:aa".to_string(),
        }],
        assumptions: vec![],
        questions: vec!["Q".to_string()],
        files: vec![
            ruth_store::StoredProposalFile {
                pos: 0,
                root_id: "root-1".to_string(),
                rel: "a.ts".to_string(),
                operation: "modify".to_string(),
                expected_fingerprint: Some("9:aa".to_string()),
                content: "new".to_string(),
                state: ruth_store::CodeFileState::Pending,
                decided_at: None,
            },
            ruth_store::StoredProposalFile {
                pos: 1,
                root_id: "root-1".to_string(),
                rel: "b.ts".to_string(),
                operation: "create".to_string(),
                expected_fingerprint: None,
                content: "new".to_string(),
                state: ruth_store::CodeFileState::Pending,
                decided_at: None,
            },
        ],
    };
    db.record_codegen(&generation, rich.ids.checkpoint())
        .expect("record");
    // Recording twice fails (primary key).
    assert!(db
        .record_codegen(&generation, rich.ids.checkpoint())
        .is_err());
    // Second generation with screen origin and two exact sources.
    let screen_gen = ruth_store::StoredCodeGeneration {
        id: "cgen-2".to_string(),
        project_id: "proy-1".to_string(),
        module_id: "mod-2".to_string(),
        requirement_artifact_id: String::new(),
        requirement_version_id: String::new(),
        screen_artifact_id: "mock-1".to_string(),
        screen_id: "registro".to_string(),
        screen_version_id: "mock-1-v2".to_string(),
        screen_sources: vec![
            ruth_store::ScreenSourceRef {
                artifact_id: "req-1".to_string(),
                version_id: "req-1-v3".to_string(),
            },
            ruth_store::ScreenSourceRef {
                artifact_id: "req-2".to_string(),
                version_id: "req-2-v1".to_string(),
            },
        ],
        model: "m".to_string(),
        template_version: 2,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "t".to_string(),
        explanation: "E".to_string(),
        scope: vec![],
        assumptions: vec![],
        questions: vec![],
        files: vec![ruth_store::StoredProposalFile {
            pos: 0,
            root_id: "root-1".to_string(),
            rel: "a.ts".to_string(),
            operation: "modify".to_string(),
            expected_fingerprint: Some("9:aa".to_string()),
            content: "new".to_string(),
            state: ruth_store::CodeFileState::Pending,
            decided_at: None,
        }],
    };
    db.record_codegen(&screen_gen, rich.ids.checkpoint())
        .expect("record screen");
    db.accept_code_file("cgen-1", 0, "t1").expect("accept");
    // Accepting a discarded one fails in SQL; the idempotent retry is
    // decided by the api by querying state, not by this UPDATE.
    db.discard_code_file("cgen-1", 1, "t2").expect("discard");
    assert!(db.accept_code_file("cgen-1", 1, "t3").is_err());
    db.discard_code_file("cgen-1", 1, "t4").expect("idempotent");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let back = loaded.codegen.get("cgen-1").expect("exists");
    assert_eq!(back.files[0].state, ruth_store::CodeFileState::Accepted);
    assert_eq!(back.files[0].decided_at.as_deref(), Some("t1"));
    assert_eq!(back.files[1].state, ruth_store::CodeFileState::Discarded);
    assert_eq!(back.scope.len(), 1);
    assert_eq!(back.questions, vec!["Q".to_string()]);
    assert!(back.assumptions.is_empty());
    assert!(!back.is_screen_sourced());
    let screen_back = loaded.codegen.get("cgen-2").expect("screen");
    assert!(screen_back.is_screen_sourced());
    assert_eq!(screen_back.screen_artifact_id, "mock-1");
    assert_eq!(screen_back.screen_id, "registro");
    assert_eq!(screen_back.screen_version_id, "mock-1-v2");
    assert_eq!(screen_back.template_version, 2);
    assert_eq!(
        screen_back.screen_sources,
        vec![
            ruth_store::ScreenSourceRef {
                artifact_id: "req-1".to_string(),
                version_id: "req-1-v3".to_string(),
            },
            ruth_store::ScreenSourceRef {
                artifact_id: "req-2".to_string(),
                version_id: "req-2-v1".to_string(),
            },
        ]
    );
    db2.close();
}

#[test]
fn codegen_v13_migrates_screen_origin_empty() {
    let tmp = TempDb::new("codegen-v13");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&rich.store, rich.ids.checkpoint()).expect("domain");
    let generation = ruth_store::StoredCodeGeneration {
        id: "cgen-1".to_string(),
        project_id: "proy-1".to_string(),
        module_id: "mod-2".to_string(),
        requirement_artifact_id: "req-3".to_string(),
        requirement_version_id: "req-3-v1".to_string(),
        screen_artifact_id: String::new(),
        screen_id: String::new(),
        screen_version_id: String::new(),
        screen_sources: vec![],
        model: "m".to_string(),
        template_version: 1,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "t".to_string(),
        explanation: "E".to_string(),
        scope: vec![],
        assumptions: vec![],
        questions: vec![],
        files: vec![ruth_store::StoredProposalFile {
            pos: 0,
            root_id: "root-1".to_string(),
            rel: "a.ts".to_string(),
            operation: "create".to_string(),
            expected_fingerprint: None,
            content: "new".to_string(),
            state: ruth_store::CodeFileState::Pending,
            decided_at: None,
        }],
    };
    db.record_codegen(&generation, rich.ids.checkpoint())
        .expect("record");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(
            "DROP TABLE code_gen_screen_sources;
             ALTER TABLE code_generations DROP COLUMN screen_artifact_id;
             ALTER TABLE code_generations DROP COLUMN screen_id;
             ALTER TABLE code_generations DROP COLUMN screen_version_id;
             PRAGMA user_version = 13;",
        )
        .expect("downgrade to v13");
    }
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("open v13");
    let back = loaded.codegen.get("cgen-1").expect("exists");
    assert!(!back.is_screen_sourced());
    assert!(back.screen_sources.is_empty());
    assert_eq!(back.requirement_artifact_id, "req-3");
    assert_eq!(back.files.len(), 1);
    db2.close();
    // Idempotency: reopening preserves and seals the current version.
    let (db3, loaded3) = DbActor::spawn(&tmp.path).expect("reopen");
    assert!(loaded3.codegen.get("cgen-1").is_some());
    db3.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("version");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}
