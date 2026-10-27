//! Persistencia con bases temporales: roundtrip, fallos y segunda instancia.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, CreateModuleInput, CreateRequirementInput, IdGen, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, BaselineId, Content, Date, HumanId, ModuleId, ProjectId,
    VersionId,
};
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
    project: String,
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
        project,
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
fn stale_save_keeps_previous_snapshot() {
    // La memoria y el disco conservan lo anterior si el guardado falla.
    let tmp = TempDb::new("fallo");
    let mut rich = build_rich();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&rich.store, rich.ids.checkpoint())
        .expect("guardar v1");
    let bytes_before = std::fs::read(&tmp.path).expect("leer base");
    drop_permissions(&tmp);
    let v3 = ruth_api::save_version(
        &mut rich.store,
        SaveVersionInput {
            project_id: rich.project.clone(),
            artifact_id: rich.req.clone(),
            expected_version_id: rich.v2.clone(),
            content: "Cambio que no se persistirá.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("el núcleo valida en memoria");
    assert_eq!(v3.versions.len(), 3);
    let err = db
        .save(&rich.store, rich.ids.checkpoint())
        .expect_err("el disco falla");
    assert!(matches!(err, StoreError::Sqlite { .. }), "era {err:?}");
    assert_eq!(std::fs::read(&tmp.path).expect("leer base"), bytes_before);
    restore_permissions(&tmp);
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    assert_eq!(
        loaded
            .store
            .versions_of(&ArtifactId::new(rich.req.clone()).expect("id"))
            .len(),
        2
    );
    db2.close();
}

#[cfg(unix)]
fn drop_permissions(tmp: &TempDb) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&tmp.path, std::fs::Permissions::from_mode(0o444)).expect("chmod");
}

#[cfg(not(unix))]
fn drop_permissions(_tmp: &TempDb) {
    panic!("esta prueba necesita permisos POSIX");
}

#[cfg(unix)]
fn restore_permissions(tmp: &TempDb) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&tmp.path, std::fs::Permissions::from_mode(0o644)).expect("chmod");
}

#[cfg(not(unix))]
fn restore_permissions(_tmp: &TempDb) {
    panic!("esta prueba necesita permisos POSIX");
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
