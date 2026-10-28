//! Persistencia con bases temporales: roundtrip, fallos y segunda instancia.

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
use ruth_store::{BaselineMetaLog, DesignLog, ProposalLog};
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

/// Estado rico: requisito con historial, derivado con fuente exacta,
/// aprobaciones históricas y dos baselines (la primera histórica).
fn build_rich() -> Rich {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("proyecto")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("módulo")
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
    .expect("requisito");
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
    .expect("aprobar v1");
    let flow = "flujo-ventas".to_string();
    let pid = ProjectId::new(project.clone()).expect("id");
    let mid = ModuleId::new(module.clone()).expect("id");
    let fid = ArtifactId::new(flow.clone()).expect("id");
    let ana = Author::Human(HumanId::new("ana").expect("id"));
    let bruno = Author::Human(HumanId::new("bruno").expect("id"));
    store
        .create_artifact(&pid, &mid, fid.clone(), ArtifactType::Flow)
        .expect("flujo");
    let flow_v1 = "flujo-ventas-v1".to_string();
    store
        .create_version(
            &pid,
            &fid,
            None,
            VersionId::new(flow_v1.clone()).expect("id"),
            Content::new("Flujo de confirmación.").expect("contenido"),
            &ana,
            &[VersionId::new(v1.clone()).expect("id")],
        )
        .expect("flujo v1");
    store
        .approve(
            &pid,
            &fid,
            &VersionId::new(flow_v1.clone()).expect("id"),
            &bruno,
            Date::new("2026-10-21T10:00:00Z").expect("fecha"),
        )
        .expect("aprobar flujo v1");
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
            Date::new("2026-10-22T10:00:00Z").expect("fecha"),
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
    .expect("aprobar v2");
    let flow_v2 = "flujo-ventas-v2".to_string();
    store
        .create_version(
            &pid,
            &fid,
            Some(&VersionId::new(flow_v1.clone()).expect("id")),
            VersionId::new(flow_v2.clone()).expect("id"),
            Content::new("Flujo con reservas.").expect("contenido"),
            &ana,
            &[VersionId::new(v2.clone()).expect("id")],
        )
        .expect("flujo v2");
    store
        .approve(
            &pid,
            &fid,
            &VersionId::new(flow_v2.clone()).expect("id"),
            &bruno,
            Date::new("2026-10-24T10:00:00Z").expect("fecha"),
        )
        .expect("aprobar flujo v2");
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
            Date::new("2026-10-25T10:00:00Z").expect("fecha"),
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
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir nueva");
    assert!(loaded.store.projects().is_empty());
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar");
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert_eq!(loaded2.store, rich.store);
    assert_eq!(loaded2.next_id, rich.ids.checkpoint());
    // Identidades intactas, sin regenerar nada.
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
    let tmp = TempDb::new("historial");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let req = ArtifactId::new(rich.req.clone()).expect("id");
    let versions = loaded.store.versions_of(&req);
    assert_eq!(versions.len(), 2);
    assert_eq!(loaded.store.approvals_of(versions[0].id()).len(), 1);
    assert_eq!(loaded.store.approvals_of(versions[1].id()).len(), 1);
    let flow = ArtifactId::new(rich.flow.clone()).expect("id");
    let flow_versions = loaded.store.versions_of(&flow);
    assert_eq!(flow_versions.len(), 2);
    // Dependencia exacta conservada, incluida la desactualizada.
    assert_eq!(
        flow_versions[0].sources(),
        &[VersionId::new(rich.v1.clone()).expect("id")]
    );
    assert_eq!(
        flow_versions[1].sources(),
        &[VersionId::new(rich.v2.clone()).expect("id")]
    );
    // Baselines históricas con pines exactos.
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
    let tmp = TempDb::new("invalido");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute("UPDATE versions SET content = '' WHERE id = ?", [&rich.v2])
        .expect("manipular");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("leer base");
    let err = DbActor::spawn(&tmp.path).expect_err("debe fallar");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("leer base"), bytes_before);
}

#[test]
fn unknown_kind_is_rejected_without_overwrite() {
    let tmp = TempDb::new("tipo");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute(
        "UPDATE artifacts SET kind = 'diagrama' WHERE id = ?",
        [&rich.req],
    )
    .expect("manipular");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("leer base");
    let err = DbActor::spawn(&tmp.path).expect_err("debe fallar");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("leer base"), bytes_before);
}

#[test]
fn future_schema_is_rejected_without_overwrite() {
    let tmp = TempDb::new("futuro");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar");
    db.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    raw.execute_batch("PRAGMA user_version = 999")
        .expect("manipular");
    drop(raw);
    let bytes_before = std::fs::read(&tmp.path).expect("leer base");
    let err = DbActor::spawn(&tmp.path).expect_err("debe fallar");
    assert_eq!(
        err,
        StoreError::FutureSchema {
            found: 999,
            supported: ruth_store::SCHEMA_VERSION
        }
    );
    assert_eq!(std::fs::read(&tmp.path).expect("leer base"), bytes_before);
}

#[test]
fn corrupt_file_is_rejected() {
    let tmp = TempDb::new("corrupta");
    std::fs::write(&tmp.path, b"esto no es sqlite").expect("escribir");
    let bytes_before = std::fs::read(&tmp.path).expect("leer base");
    let err = DbActor::spawn(&tmp.path).expect_err("debe fallar");
    assert!(matches!(err, StoreError::Corrupt { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("leer base"), bytes_before);
}

#[test]
fn open_is_idempotent() {
    let tmp = TempDb::new("idempotente");
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("primera");
    assert!(loaded.store.projects().is_empty());
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("segunda");
    assert!(loaded2.store.projects().is_empty());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn second_instance_is_locked() {
    let tmp = TempDb::new("segunda");
    let (db_a, _) = DbActor::spawn(&tmp.path).expect("primera");
    let err = DbActor::spawn(&tmp.path).expect_err("la segunda falla");
    assert!(matches!(err, StoreError::Locked { .. }), "era {err:?}");
    db_a.close();
    let (db_c, _) = DbActor::spawn(&tmp.path).expect("tras cerrar");
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

/// Proyecto + módulo + requisito mínimos para las pruebas de generaciones.
fn baby() -> (Store, IdGen, String, String, String) {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("proyecto")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("módulo")
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
    .expect("requisito")
    .artifact
    .id;
    (store, ids, project, module, req)
}

fn pending(temp_id: &str) -> StoredProposal {
    StoredProposal {
        temp_id: temp_id.to_string(),
        title: format!("Título {temp_id}"),
        description: format!("Descripción {temp_id}"),
        acceptance: vec![format!("Criterio {temp_id}")],
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
        questions: vec!["¿Caducan las reservas?".to_string()],
        proposals: vec![pending("p1"), pending("p2")],
    }
}

#[test]
fn generations_roundtrip_with_accept_and_discard() {
    let tmp = TempDb::new("generaciones");
    let (mut store, mut ids, project, module, req) = baby();
    let v1 = format!("{req}-v1");
    // El artefacto aceptado debe existir en el dominio.
    let accepted = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Propuesta aceptada.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requisito")
    .artifact
    .id;
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("dominio");
    let generation = baby_generation("gen-1", &project, &module, vec![v1.clone()]);
    db.record_generation(&generation).expect("registrar");
    db.accept_proposal(
        &store,
        ids.checkpoint(),
        "gen-1",
        "p1",
        &accepted,
        "Contenido final.",
    )
    .expect("aceptar");
    db.discard_proposal("gen-1", "p2").expect("descartar");
    db.discard_proposal("gen-1", "p2")
        .expect("descartar es idempotente");
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let again = loaded.proposals.generation("gen-1").expect("generación");
    assert_eq!(again.model, "muse-spark-1.3");
    assert_eq!(again.context_version_ids, vec![v1]);
    assert_eq!(again.template_version, 1);
    assert_eq!(again.total_tokens, Some(300));
    assert_eq!(again.questions, vec!["¿Caducan las reservas?"]);
    assert_eq!(again.proposals.len(), 2);
    assert!(matches!(
        &again.proposals[0].state,
        ProposalState::Accepted { artifact_id, content }
        if artifact_id == &accepted && content == "Contenido final."
    ));
    assert_eq!(again.proposals[0].acceptance, vec!["Criterio p1"]);
    assert_eq!(again.proposals[1].state, ProposalState::Discarded);
    // El dominio convivió intacto.
    assert!(loaded
        .store
        .artifact(&ArtifactId::new(accepted).expect("id"))
        .is_some());
    db2.close();
}

#[test]
fn domain_save_preserves_generations() {
    let tmp = TempDb::new("conviven");
    let (store, ids, project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("dominio");
    db.record_generation(&baby_generation(
        "gen-1",
        &project,
        &module,
        vec![format!("{req}-v1")],
    ))
    .expect("registrar");
    // Otro guardado del dominio (reescritura total) no toca generaciones.
    db.save(&store, ids.checkpoint()).expect("re-guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded.proposals.generation("gen-1").is_some());
    db2.close();
}

#[test]
fn accept_requires_pending_proposal() {
    let tmp = TempDb::new("aceptar-pendiente");
    let (store, ids, project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("dominio");
    db.record_generation(&baby_generation(
        "gen-1",
        &project,
        &module,
        vec![format!("{req}-v1")],
    ))
    .expect("registrar");
    db.accept_proposal(&store, ids.checkpoint(), "gen-1", "p1", &req, "Final.")
        .expect("primera aceptación");
    let err = db
        .accept_proposal(&store, ids.checkpoint(), "gen-1", "p1", &req, "Final.")
        .expect_err("la segunda falla");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    let err = db
        .accept_proposal(&store, ids.checkpoint(), "gen-1", "pX", &req, "Final.")
        .expect_err("desconocida falla");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    db.close();
}

/// Esquema v1 fijado: lo que el hito 4 escribía. La migración debe aceptarlo
/// y conservar sus datos.
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
    let tmp = TempDb::new("migra-v1");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("proyecto");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("módulo");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '3')", [])
            .expect("contador");
        raw.execute("PRAGMA user_version = 1", []).expect("v1");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v1");
    assert_eq!(loaded.next_id, 3);
    assert_eq!(loaded.store.projects().len(), 1);
    assert!(loaded.proposals.generation("gen-1").is_none());
    db.close();
    // Reabrir confirma la migración idempotente a la versión actual.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert_eq!(loaded2.store.projects().len(), 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn generation_with_dangling_refs_is_rejected() {
    let tmp = TempDb::new("colgada");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO generations(id, project_id, module_id, model, description,
             template_version, created_at)
             VALUES ('gen-1', 'proy-X', 'mod-X', 'm', 'd', 1, 't')",
            [],
        )
        .expect("inyectar");
        raw.execute(
            "INSERT INTO proposals(generation_id, temp_id, title, description, state)
             VALUES ('gen-1', 'p1', 't', 'd', 'pending')",
            [],
        )
        .expect("inyectar");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("referencias colgadas");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
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
        questions: vec!["¿Reintentos?".to_string()],
        proposal: StoredDesignProposal {
            title: "Flujo de venta".to_string(),
            spec_json: "{\"title\":\"Flujo de venta\",\"kind\":\"flow\"}".to_string(),
            explanation: "Revisa stock y confirma.".to_string(),
            state: ProposalState::Pending,
        },
        target_artifact_id: None,
        target_version_id: None,
    }
}

#[test]
fn designs_roundtrip_with_atomic_accept() {
    let tmp = TempDb::new("disenos");
    let (mut store, ids, project, module, req) = baby();
    let v1 = format!("{req}-v1");
    // El artefacto aceptado (flujo) existe en el dominio.
    let flow = ruth_core::domain::ArtifactId::new("flujo-9").expect("id");
    store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(module.clone()).expect("id"),
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flujo");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("dominio");
    db.record_design(&baby_design("gen-1", &project, &module, vec![v1.clone()]))
        .expect("registrar");
    db.accept_design(&store, ids.checkpoint(), "gen-1", "flujo-9", "{\"a\":1}")
        .expect("aceptar");
    // Segunda aceptación: la propuesta ya no está pendiente, todo intacto.
    let err = db
        .accept_design(&store, ids.checkpoint(), "gen-1", "flujo-9", "{\"a\":1}")
        .expect_err("repetida falla");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let again = loaded.designs.design("gen-1").expect("diseño");
    assert_eq!(again.kind, "flow");
    assert_eq!(again.context_version_ids, vec![v1]);
    assert_eq!(again.questions, vec!["¿Reintentos?"]);
    assert!(matches!(
        &again.proposal.state,
        ProposalState::Accepted { artifact_id, content }
        if artifact_id == "flujo-9" && content == "{\"a\":1}"
    ));
    db2.close();
}

/// Delta v2 fijado: lo que el hito 5 añadía sobre v1. La migración v2→v3
/// debe aceptarlo y conservar sus datos.
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
    let tmp = TempDb::new("migra-v2");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("proyecto");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("módulo");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind) VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artefacto");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Contenido.', 'human', 'ana')",
            [],
        )
        .expect("versión");
        raw.execute(
            "INSERT INTO generations(id, project_id, module_id, model, description,
             template_version, created_at)
             VALUES ('gen-1', 'proy-1', 'mod-2', 'm', 'd', 1, 't')",
            [],
        )
        .expect("generación");
        raw.execute(
            "INSERT INTO generation_context(generation_id, pos, version_id)
             VALUES ('gen-1', 0, 'req-3-v1')",
            [],
        )
        .expect("contexto");
        raw.execute(
            "INSERT INTO proposals(generation_id, temp_id, title, description, state)
             VALUES ('gen-1', 'p1', 't', 'd', 'pending')",
            [],
        )
        .expect("propuesta");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '4')", [])
            .expect("contador");
        raw.execute("PRAGMA user_version = 2", []).expect("v2");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v2");
    assert_eq!(loaded.next_id, 4);
    // Dominio y generaciones v2 intactos; diseños vacíos.
    assert!(loaded
        .store
        .artifact(&ruth_core::domain::ArtifactId::new("req-3").expect("id"))
        .is_some());
    let gen = loaded.proposals.generation("gen-1").expect("generación");
    assert_eq!(gen.context_version_ids, vec!["req-3-v1"]);
    assert_eq!(gen.proposals.len(), 1);
    assert!(loaded.designs.design("gen-1").is_none());
    db.close();
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2.proposals.generation("gen-1").is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
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
    let tmp = TempDb::new("migra-v3");
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute_batch(V1_DDL).expect("v1");
        raw.execute_batch(V2_DDL).expect("v2");
        raw.execute_batch(V3_DESIGN_DDL).expect("v3");
        raw.execute("INSERT INTO projects(id) VALUES ('proy-1')", [])
            .expect("proyecto");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("módulo");
        raw.execute(
            "INSERT INTO design_generations(id, project_id, module_id, kind, model,
             template_version, created_at)
             VALUES ('gen-1', 'proy-1', 'mod-2', 'flow', 'm', 1, 't')",
            [],
        )
        .expect("generación");
        raw.execute(
            "INSERT INTO design_proposals(generation_id, title, spec_json, explanation, state)
             VALUES ('gen-1', 't', '{}', 'e', 'pending')",
            [],
        )
        .expect("propuesta");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '5')", [])
            .expect("contador");
        raw.execute("PRAGMA user_version = 3", []).expect("v3");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v3");
    let gen = loaded.designs.design("gen-1").expect("diseño");
    assert_eq!(gen.kind, "flow");
    assert_eq!(gen.target_artifact_id, None);
    assert_eq!(gen.target_version_id, None);
    db.close();
    // Reabrir es idempotente y deja el esquema en la versión actual.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2.designs.design("gen-1").is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let columns: Vec<String> = raw
        .prepare("PRAGMA table_info(design_generations)")
        .expect("columnas")
        .query_map([], |row| row.get(1))
        .expect("filas")
        .collect::<Result<_, _>>()
        .expect("nombres");
    assert!(columns.iter().any(|c| c == "target_artifact_id"));
    assert!(columns.iter().any(|c| c == "target_version_id"));
}

#[test]
fn v4_database_migrates_preserving_baselines_without_meta() {
    let tmp = TempDb::new("migra-v4");
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
            .expect("proyecto");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("módulo");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind)
             VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artefacto");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Contenido.', 'human', 'ana')",
            [],
        )
        .expect("versión");
        raw.execute(
            "INSERT INTO approvals(version_id, approved_by, at, pos)
             VALUES ('req-3-v1', 'ana', 't', 0)",
            [],
        )
        .expect("aprobación");
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
        .expect("entrada");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '6')", [])
            .expect("contador");
        raw.execute("PRAGMA user_version = 4", []).expect("v4");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v4");
    let baseline = loaded
        .store
        .baseline(&ruth_core::domain::BaselineId::new("base-1").expect("id"))
        .expect("baseline");
    assert_eq!(baseline.entries().len(), 1);
    assert!(loaded.baseline_meta.get("base-1").is_none());
    db.close();
    // Reabrir es idempotente y deja el esquema en la versión actual.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2
        .store
        .baseline(&ruth_core::domain::BaselineId::new("base-1").expect("id"))
        .is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let tables: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'baseline_meta'",
            [],
            |row| row.get(0),
        )
        .expect("tabla");
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
                ruth_core::domain::HumanId::new("ana").expect("autora"),
            ),
            Date::new("2026-10-28T12:00:00Z").expect("fecha"),
        )
        .expect("aprobar");
    store
        .create_baseline(
            &project_id,
            BaselineId::new("base-1").expect("id"),
            &[(
                ruth_core::domain::ArtifactId::new(req).expect("id"),
                version,
            )],
            Date::new("2026-10-28T12:00:00Z").expect("fecha"),
        )
        .expect("baseline");
    let meta = BaselineMeta {
        baseline_id: "base-1".to_string(),
        name: "Entrega 1".to_string(),
        description: Some("Ventas".to_string()),
        scope_module: Some("mod-2".to_string()),
        created_at: "2026-10-28T12:00:00Z".to_string(),
    };
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.create_baseline(&store, ids.checkpoint(), &meta)
        .expect("crear");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
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
    let tmp = TempDb::new("meta-colgada");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO baseline_meta(baseline_id, name, created_at)
             VALUES ('base-9', 'Rota', 't')",
            [],
        )
        .expect("forzar");
    }
    let err = DbActor::spawn(&tmp.path).expect_err("debe fallar");
    assert!(
        matches!(err, ruth_store::StoreError::InvalidData { .. }),
        "era {err:?}"
    );
}

#[test]
fn design_update_target_roundtrips_across_reopen() {
    let tmp = TempDb::new("diseno-objetivo");
    let (mut store, ids, project, module, req) = baby();
    let flow = ruth_core::domain::ArtifactId::new("flujo-9").expect("id");
    store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(module.clone()).expect("id"),
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flujo");
    store
        .create_version(
            &ruth_core::domain::ProjectId::new(project.clone()).expect("id"),
            &flow,
            None,
            ruth_core::domain::VersionId::new("flujo-9-v1").expect("id"),
            ruth_core::domain::Content::new("{}").expect("contenido"),
            &ruth_core::domain::Author::Human(
                ruth_core::domain::HumanId::new("ana").expect("autora"),
            ),
            &[ruth_core::domain::VersionId::new(format!("{req}-v1")).expect("id")],
        )
        .expect("versión");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("dominio");
    let mut gen = baby_design("gen-1", &project, &module, vec![format!("{req}-v1")]);
    gen.target_artifact_id = Some("flujo-9".to_string());
    gen.target_version_id = Some("flujo-9-v1".to_string());
    db.record_design(&gen).expect("registrar");
    db.close();
    let (_db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let back = loaded.designs.design("gen-1").expect("diseño");
    assert_eq!(back.target_artifact_id.as_deref(), Some("flujo-9"));
    assert_eq!(back.target_version_id.as_deref(), Some("flujo-9-v1"));
}

#[test]
fn design_with_dangling_refs_is_rejected() {
    let tmp = TempDb::new("diseno-colgado");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "INSERT INTO design_generations(id, project_id, module_id, kind, model,
             template_version, created_at)
             VALUES ('gen-1', 'proy-X', 'mod-X', 'flow', 'm', 1, 't')",
            [],
        )
        .expect("inyectar");
        raw.execute(
            "INSERT INTO design_proposals(generation_id, title, spec_json, explanation, state)
             VALUES ('gen-1', 't', '{}', 'e', 'pending')",
            [],
        )
        .expect("inyectar");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("referencias colgadas");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn repeated_saves_keep_baselines_and_meta() {
    use ruth_store::BaselineMeta;

    // Regresión del hito 9: el segundo guardado sobre una base con baselines
    // fallaba con FOREIGN KEY (se vaciaba `projects` antes que `baselines`).
    let tmp = TempDb::new("guardados-baseline");
    let rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("primer guardado");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("segundo guardado con baselines");
    // Los metadatos sobreviven a guardados completos posteriores.
    let meta = BaselineMeta {
        baseline_id: "base-2".to_string(),
        name: "Entrega 2".to_string(),
        description: None,
        scope_module: None,
        created_at: "2026-10-25T10:00:00Z".to_string(),
    };
    db.create_baseline(&rich.store, rich.ids.checkpoint(), &meta)
        .expect("metadatos");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardado tras metadatos");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert_eq!(loaded.store.baselines().len(), 2);
    assert_eq!(
        loaded.baseline_meta.get("base-2").expect("meta").name,
        "Entrega 2"
    );
    db2.close();
}

#[test]
fn v5_database_migrates_preserving_everything_without_layouts() {
    let tmp = TempDb::new("migra-v5");
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
            .expect("proyecto");
        raw.execute(
            "INSERT INTO modules(id, project_id) VALUES ('mod-2', 'proy-1')",
            [],
        )
        .expect("módulo");
        raw.execute(
            "INSERT INTO artifacts(id, project_id, module_id, kind)
             VALUES ('req-3', 'proy-1', 'mod-2', 'requirement')",
            [],
        )
        .expect("artefacto");
        raw.execute(
            "INSERT INTO versions(id, artifact_id, number, content, provenance_kind, provenance_by)
             VALUES ('req-3-v1', 'req-3', 1, 'Contenido.', 'human', 'ana')",
            [],
        )
        .expect("versión");
        raw.execute(
            "INSERT INTO approvals(version_id, approved_by, at, pos)
             VALUES ('req-3-v1', 'ana', 't', 0)",
            [],
        )
        .expect("aprobación");
        raw.execute("INSERT INTO meta(key, value) VALUES ('next_id', '6')", [])
            .expect("contador");
        raw.execute("PRAGMA user_version = 5", []).expect("v5");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v5");
    // Datos intactos y sin disposiciones (trazado automático).
    let version = loaded
        .store
        .version(&ruth_core::domain::VersionId::new("req-3-v1").expect("id"))
        .expect("versión");
    assert_eq!(version.content().as_str(), "Contenido.");
    assert!(loaded.layouts.get("req-3", "req-3-v1").is_none());
    db.close();
    // Reabrir es idempotente y deja el esquema en la versión actual.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2
        .store
        .version(&ruth_core::domain::VersionId::new("req-3-v1").expect("id"))
        .is_some());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let tables: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'design_layouts'",
            [],
            |row| row.get(0),
        )
        .expect("tabla");
    assert_eq!(tables, 1);
}

#[test]
fn v6_database_migrates_with_everything_active() {
    let tmp = TempDb::new("migra-v6");
    let (store, ids, _project, module, req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    // Degradar a v6: quitar las columnas y marcar la versión anterior.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("ALTER TABLE modules DROP COLUMN archived", [])
            .expect("degradar");
        raw.execute("ALTER TABLE artifacts DROP COLUMN archived", [])
            .expect("degradar");
        raw.execute("PRAGMA user_version = 6", []).expect("v6");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v6");
    // Todo activo y datos intactos.
    let module_ref = loaded
        .store
        .module(&ModuleId::new(module).expect("id"))
        .expect("módulo");
    assert!(!module_ref.archived());
    let artifact = loaded
        .store
        .artifact(&ArtifactId::new(req).expect("id"))
        .expect("requisito");
    assert!(!artifact.archived());
    assert!(loaded.store.current_version(artifact.id()).is_some());
    db.close();
    // Reabrir confirma la migración idempotente a v7.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2.store.projects().len() == 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
    let columns: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('artifacts') WHERE name = 'archived'",
            [],
            |row| row.get(0),
        )
        .expect("columna");
    assert_eq!(columns, 1);
}

#[test]
fn archived_flags_roundtrip() {
    let tmp = TempDb::new("archivado");
    let (mut store, mut ids, project, module, req) = baby();
    ruth_api::archive_module(
        &mut store,
        ArchiveModuleInput {
            project_id: project.clone(),
            module_id: module.clone(),
        },
    )
    .expect("archivar módulo");
    // Un segundo requisito archivado individualmente dentro de otro módulo.
    let other = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("módulo")
    .id;
    let detail = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: other.clone(),
            content: "Otro requisito.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requisito");
    ruth_api::archive_requirement(
        &mut store,
        ArchiveRequirementInput {
            project_id: project.clone(),
            artifact_id: detail.artifact.id.clone(),
        },
    )
    .expect("archivar requisito");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let module_ref = loaded
        .store
        .module(&ModuleId::new(module).expect("id"))
        .expect("módulo");
    assert!(module_ref.archived());
    // El contenido conserva su flag individual (activo) aunque su módulo no.
    let inner = loaded
        .store
        .artifact(&ArtifactId::new(req).expect("id"))
        .expect("requisito");
    assert!(!inner.archived());
    assert!(loaded.store.is_effectively_archived(inner.id()));
    let solo = loaded
        .store
        .artifact(&ArtifactId::new(detail.artifact.id).expect("id"))
        .expect("otro");
    assert!(solo.archived());
    let other_ref = loaded
        .store
        .module(&ModuleId::new(other).expect("id"))
        .expect("módulo");
    assert!(!other_ref.archived());
    // Historiales intactos bajo el archivado.
    assert_eq!(loaded.store.versions_of(inner.id()).len(), 1);
    db2.close();
}

#[test]
fn delete_persists_and_keeps_the_rest() {
    let tmp = TempDb::new("borrado");
    let (mut store, ids, project, module, req) = baby();
    let proposals = ProposalLog::new();
    let designs = DesignLog::new();
    let metalog = BaselineMetaLog::new();
    ruth_api::delete_requirement_checked(
        &mut store,
        &proposals,
        &designs,
        DeleteRequirementInput {
            project_id: project.clone(),
            artifact_id: req.clone(),
        },
    )
    .expect("borrar requisito");
    ruth_api::delete_module_checked(
        &mut store,
        &proposals,
        &designs,
        &metalog,
        DeleteModuleInput {
            project_id: project.clone(),
            module_id: module.clone(),
        },
    )
    .expect("borrar módulo");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
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
    let tmp = TempDb::new("flag-malo");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("UPDATE artifacts SET archived = 7", [])
            .expect("inyectar");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("flag inválido");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn v7_database_migrates_with_names_from_ids_and_no_titles() {
    let tmp = TempDb::new("migra-v7");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    // Degradar a v7: quitar columnas/tabla y marcar la versión anterior.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("ALTER TABLE projects DROP COLUMN name", [])
            .expect("degradar");
        raw.execute("ALTER TABLE modules DROP COLUMN name", [])
            .expect("degradar");
        raw.execute("ALTER TABLE artifacts DROP COLUMN title", [])
            .expect("degradar");
        raw.execute("ALTER TABLE baseline_entries DROP COLUMN title", [])
            .expect("degradar");
        raw.execute("DROP TABLE title_history", [])
            .expect("degradar");
        raw.execute("PRAGMA user_version = 7", []).expect("v7");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v7");
    // Nombres = IDs, sin títulos, historial vacío, datos intactos.
    let project = &loaded.store.projects()[0];
    assert_eq!(project.name(), project.id().as_str());
    let module = &loaded.store.modules_of(project.id())[0];
    assert_eq!(module.name(), module.id().as_str());
    let artifact = &loaded.store.artifacts_of(project.id(), module.id())[0];
    assert_eq!(artifact.title(), None);
    assert!(loaded.store.title_changes().is_empty());
    assert!(loaded.store.current_version(artifact.id()).is_some());
    db.close();
    // Reabrir confirma la migración idempotente a v8.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert_eq!(loaded2.store.projects().len(), 1);
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn names_titles_and_history_roundtrip() {
    let tmp = TempDb::new("nombres");
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
        .expect("proyecto");
    store
        .rename_module(
            &project_id,
            &module_id,
            &module,
            ruth_core::domain::Name::new("Mostrador".to_string()).expect("n"),
        )
        .expect("módulo");
    store
        .rename_artifact(
            &project_id,
            &req_id,
            None,
            ruth_core::domain::Name::new("Primer título".to_string()).expect("n"),
            &ruth_core::domain::HumanId::new("ana").expect("id"),
            ruth_core::domain::Date::new("2026-10-28").expect("f"),
        )
        .expect("título");
    store
        .rename_artifact(
            &project_id,
            &req_id,
            Some("Primer título"),
            ruth_core::domain::Name::new("Segundo título".to_string()).expect("n"),
            &ruth_core::domain::HumanId::new("bruno").expect("id"),
            ruth_core::domain::Date::new("2026-10-28").expect("f"),
        )
        .expect("título");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
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
        Some("Segundo título")
    );
    let history: Vec<&str> = loaded
        .store
        .title_history(&req_id)
        .iter()
        .map(|c| c.title())
        .collect();
    assert_eq!(history, vec!["Primer título", "Segundo título"]);
    db2.close();
}

#[test]
fn invalid_name_is_rejected_without_overwrite() {
    let tmp = TempDb::new("nombre-malo");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("UPDATE projects SET name = ''", [])
            .expect("inyectar");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("nombre inválido");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}

#[test]
fn v8_database_migrates_with_empty_deliveries() {
    let tmp = TempDb::new("migra-v8");
    let (store, ids, _project, _module, _req) = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    // Degradar a v8: quitar las tablas de entregas y marcar la versión.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("DROP TABLE work_delivery_entries", [])
            .expect("degradar");
        raw.execute("DROP TABLE work_deliveries", [])
            .expect("degradar");
        raw.execute("PRAGMA user_version = 8", []).expect("v8");
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("abrir v8");
    assert!(loaded.store.deliveries().is_empty());
    assert_eq!(loaded.store.projects().len(), 1);
    db.close();
    // Reabrir confirma la migración idempotente a v9.
    let (db2, loaded2) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert!(loaded2.store.deliveries().is_empty());
    db2.close();
    let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
    let version: i64 = raw
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("versión");
    assert_eq!(version, ruth_store::SCHEMA_VERSION);
}

#[test]
fn delivery_roundtrip_preserves_entries_and_titles() {
    use ruth_core::domain::DeliveryId;
    let tmp = TempDb::new("entrega");
    let (mut store, ids, project, module, req) = baby();
    let project_id = ProjectId::new(project).expect("id");
    let module_id = ModuleId::new(module).expect("id");
    let req_id = ArtifactId::new(req).expect("id");
    let v1 = store.current_version(&req_id).expect("actual").id().clone();
    store
        .rename_artifact(
            &project_id,
            &req_id,
            None,
            ruth_core::domain::Name::new("Confirmar venta".to_string()).expect("nombre"),
            &HumanId::new("ana").expect("id"),
            Date::new("2026-10-28").expect("fecha"),
        )
        .expect("título");
    store
        .create_work_delivery(
            &project_id,
            DeliveryId::new("entrega-1").expect("id"),
            "Trabajo".to_string(),
            Some("para la demo".to_string()),
            Some(module_id.clone()),
            std::slice::from_ref(&(req_id.clone(), v1.clone())),
            Date::new("2026-10-28T12:00:00Z").expect("fecha"),
        )
        .expect("entrega");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let deliveries = loaded.store.deliveries();
    assert_eq!(deliveries.len(), 1);
    let delivery = deliveries[0];
    assert_eq!(delivery.name(), "Trabajo");
    assert_eq!(delivery.description(), Some("para la demo"));
    assert_eq!(delivery.scope_module(), Some(&module_id));
    assert_eq!(delivery.entries(), &[(req_id.clone(), v1)]);
    assert_eq!(delivery.title_of(&req_id), Some(Some("Confirmar venta")));
    db2.close();
}

#[test]
fn dangling_delivery_entry_is_rejected_without_overwrite() {
    let tmp = TempDb::new("entrega-mala");
    let (mut store, ids, project, module, req) = baby();
    let project_id = ProjectId::new(project).expect("id");
    let module_id = ModuleId::new(module).expect("id");
    let req_id = ArtifactId::new(req).expect("id");
    let v1 = store.current_version(&req_id).expect("actual").id().clone();
    store
        .create_work_delivery(
            &project_id,
            ruth_core::domain::DeliveryId::new("entrega-1").expect("id"),
            "Trabajo".to_string(),
            None,
            Some(module_id),
            std::slice::from_ref(&(req_id, v1)),
            Date::new("2026-10-28T12:00:00Z").expect("fecha"),
        )
        .expect("entrega");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&store, ids.checkpoint()).expect("guardar");
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute("PRAGMA foreign_keys = OFF", [])
            .expect("sin fk");
        raw.execute(
            "UPDATE work_delivery_entries SET version_id = 'req-1-v99'",
            [],
        )
        .expect("inyectar");
    }
    let before = std::fs::read(&tmp.path).expect("bytes");
    let err = DbActor::spawn(&tmp.path).expect_err("entrada colgada");
    assert!(matches!(err, StoreError::InvalidData { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("bytes"), before);
}
