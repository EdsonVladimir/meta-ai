//! Propuestas de actualización de diseños sin red: el "generador falso"
//! valida especificaciones a mano con `ruth-meta`; la red solo existe en el
//! comando. Reutiliza el ciclo de registro, aceptación y descarte de diseño.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    AcceptDesignInput, ApproveVersionInput, CreateModuleInput, CreateRequirementInput, IdGen,
    RecordDesignInput, SaveVersionInput, UpdateContextInput, UpdateTarget,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, HumanId, ModuleId, ProjectId, VersionId,
};
use ruth_meta::design::{parse_design_output, DesignKind, ValidatedDesign};
use ruth_store::{DbActor, DesignLog};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-update-{}-{}-{}.db",
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
    log: DesignLog,
    project: ProjectId,
    module: ModuleId,
    req: ArtifactId,
}

fn baby() -> Baby {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ProjectId::new(
        ruth_api::create_project(&mut store, &mut ids)
            .expect("proyecto")
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
        .expect("módulo")
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
        .expect("requisito")
        .artifact
        .id,
    )
    .expect("id");
    Baby {
        store,
        ids,
        log: DesignLog::new(),
        project,
        module,
        req,
    }
}

fn author() -> Author {
    Author::Human(HumanId::new("ana").expect("autora"))
}

fn save_with_sources(
    baby: &mut Baby,
    artifact: &ArtifactId,
    number: u32,
    content: &str,
    sources: &[VersionId],
) -> VersionId {
    let id = IdGen::version(artifact, number);
    let expected = if number == 1 {
        None
    } else {
        Some(IdGen::version(artifact, number - 1))
    };
    baby.store
        .create_version(
            &baby.project,
            artifact,
            expected.as_ref(),
            id.clone(),
            Content::new(content).expect("contenido"),
            &author(),
            sources,
        )
        .expect("versión");
    id
}

fn design(baby: &mut Baby, kind: ArtifactType, content: &str, sources: &[VersionId]) -> ArtifactId {
    let id = match kind {
        ArtifactType::Flow => baby.ids.flow(),
        ArtifactType::DataModel => baby.ids.data_model(),
        ArtifactType::Requirement => baby.ids.requirement(),
        ArtifactType::Mockup => baby.ids.mockup(),
    };
    baby.store
        .create_artifact(&baby.project, &baby.module, id.clone(), kind)
        .expect("artefacto");
    save_with_sources(baby, &id, 1, content, sources);
    id
}

fn approve(baby: &mut Baby, artifact: &ArtifactId, expected: &VersionId) {
    ruth_api::approve_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: artifact.as_str().to_string(),
            expected_version_id: expected.as_str().to_string(),
            approver: "ana".to_string(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("aprobar");
}

fn save_req_version(baby: &mut Baby, expected: &VersionId, content: &str) {
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
    .expect("nueva versión");
}

fn flow_v1(req: &str) -> String {
    serde_json::json!({
        "title": "Flujo de venta",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": [req]},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [{"from": "inicio", "to": "fin"}],
        "explanation": "Flujo mínimo.",
        "questions": []
    })
    .to_string()
}

fn flow_v2(req: &str) -> String {
    serde_json::json!({
        "title": "Flujo de venta con reserva",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": [req]},
            {"id": "reserva", "kind": "step", "label": "Reservar stock", "requirements": [req]},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [
            {"from": "inicio", "to": "reserva"},
            {"from": "reserva", "to": "fin"}
        ],
        "explanation": "Añade la reserva pedida.",
        "questions": []
    })
    .to_string()
}

/// Ventas con flujo pendiente: requisito v2 aprobada, flujo v1 con v1.
fn sales_pending() -> (Baby, ArtifactId, VersionId) {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        &flow_v1(req.as_str()),
        std::slice::from_ref(&req_v1),
    );
    let flow_v1_id = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1_id);
    save_req_version(&mut baby, &req_v1, "Reservar unidades antes de confirmar.");
    let req_v2 = IdGen::version(&baby.req, 2);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v2);
    (baby, flow, flow_v1_id)
}

fn preview_input(baby: &Baby, artifact: &ArtifactId, with_origin: bool) -> UpdateContextInput {
    UpdateContextInput {
        project_id: baby.project.as_str().to_string(),
        artifact_id: artifact.as_str().to_string(),
        origin_artifact_id: with_origin.then(|| baby.req.as_str().to_string()),
        origin_from_version_id: None,
    }
}

/// Generador falso: especificación validada de verdad, sin red.
fn fake_update(req: &str) -> ValidatedDesign {
    parse_design_output(&flow_v2(req), DesignKind::Flow, &[req.to_string()]).expect("válido")
}

fn er_v1(req: &str) -> String {
    serde_json::json!({
        "title": "Ventas",
        "entities": [
            {"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": [req]}
        ],
        "relations": [],
        "explanation": "Mínimo.",
        "questions": []
    })
    .to_string()
}

fn er_v2(req: &str) -> String {
    serde_json::json!({
        "title": "Ventas con reserva",
        "entities": [
            {"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": [req]},
            {"name": "reserva", "attributes": [{"name": "id", "key": true}], "requirements": [req]}
        ],
        "relations": [{"from": "venta", "to": "reserva", "from_card": "1", "to_card": "0..N"}],
        "explanation": "Añade la reserva pedida.",
        "questions": []
    })
    .to_string()
}

/// Ventas con modelo pendiente: requisito v2 aprobada, mer v1 con v1.
fn sales_pending_er() -> (Baby, ArtifactId, VersionId) {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        &er_v1(req.as_str()),
        std::slice::from_ref(&req_v1),
    );
    let mer_v1_id = IdGen::version(&mer, 1);
    approve(&mut baby, &mer.clone(), &mer_v1_id);
    save_req_version(&mut baby, &req_v1, "Reservar unidades antes de confirmar.");
    let req_v2 = IdGen::version(&baby.req, 2);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v2);
    (baby, mer, mer_v1_id)
}

fn record_update(
    baby: &mut Baby,
    db: &DbActor,
    flow: &ArtifactId,
    target_version: &VersionId,
    validated: ValidatedDesign,
) -> ruth_api::DesignGenerationDto {
    let snapshot = ruth_api::snapshot_update_context(&baby.store, preview_input(baby, flow, false))
        .expect("snapshot");
    ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut baby.log,
        db,
        RecordDesignInput {
            project_id: baby.project.as_str().to_string(),
            module_id: baby.module.as_str().to_string(),
            kind: DesignKind::Flow,
            model: "muse-spark-1.3".to_string(),
            context: snapshot.context,
            validated,
            input_tokens: Some(100),
            output_tokens: Some(200),
            total_tokens: Some(300),
            created_at: "2026-10-28T12:00:00Z".to_string(),
            target: Some(UpdateTarget {
                artifact_id: flow.as_str().to_string(),
                version_id: target_version.as_str().to_string(),
            }),
        },
    )
    .expect("registrar")
}

#[test]
fn preview_describes_snapshot_origin_and_paths() {
    let (baby, flow, _) = sales_pending();
    let preview = ruth_api::update_context_preview(&baby.store, preview_input(&baby, &flow, true))
        .expect("vista previa");
    assert!(preview.can_generate);
    assert!(preview.blockers.is_empty());
    assert_eq!(preview.kind, "flow");
    assert_eq!(preview.current_number, 1);
    assert_eq!(preview.sources.len(), 1);
    let source = &preview.sources[0];
    assert_eq!(source.artifact_id, baby.req.as_str());
    assert_eq!(
        source.used_version_id,
        IdGen::version(&baby.req, 1).as_str()
    );
    assert_eq!(
        source.current_version_id,
        IdGen::version(&baby.req, 2).as_str()
    );
    assert!(source.changed);
    assert!(source.current_approved);
    assert!(source.current_valid);
    assert!(source.used_content.contains("descuenta stock"));
    assert!(source.current_content.contains("Reservar"));
    let origin = preview.origin.expect("origen");
    assert_eq!(
        origin.from_version_id,
        IdGen::version(&baby.req, 1).as_str()
    );
    assert_eq!(
        origin.current_version_id,
        IdGen::version(&baby.req, 2).as_str()
    );
    assert_eq!(
        preview.paths,
        vec![vec![
            baby.req.as_str().to_string(),
            flow.as_str().to_string()
        ]]
    );
}

#[test]
fn preview_reports_unreviewed_source_without_blocking() {
    let (mut baby, flow, _) = sales_pending();
    // Tercera versión del requisito, sin revisar.
    let req_v2 = IdGen::version(&baby.req, 2);
    save_req_version(&mut baby, &req_v2, "Tercera redacción sin revisar.");
    let preview = ruth_api::update_context_preview(&baby.store, preview_input(&baby, &flow, false))
        .expect("vista previa");
    // Diseño vivo: la falta de revisión se informa, no bloquea.
    assert!(preview.can_generate);
    assert!(preview.blockers.is_empty());
    let source = preview
        .sources
        .iter()
        .find(|s| s.artifact_id == baby.req.as_str())
        .expect("fuente");
    assert!(!source.current_approved);
    // El snapshot se toma igual: basta con fuentes guardadas y vigentes.
    let snapshot =
        ruth_api::snapshot_update_context(&baby.store, preview_input(&baby, &flow, false))
            .expect("snapshot");
    assert_eq!(
        snapshot.target_version_id,
        IdGen::version(&flow, 1).as_str()
    );
}

#[test]
fn preview_blocks_stale_intermediate_first() {
    let (mut baby, flow, _) = sales_pending();
    // El modelo deriva del flujo: cadena req → flujo → mer.
    let flow_v1_id = IdGen::version(&flow, 1);
    let mer_content = serde_json::json!({
        "title": "Ventas",
        "entities": [
            {"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": [baby.req.as_str()]}
        ],
        "relations": [],
        "explanation": "Mínimo.",
        "questions": []
    })
    .to_string();
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        &mer_content,
        std::slice::from_ref(&flow_v1_id),
    );
    // El flujo avanza manualmente y el requisito vuelve a cambiar: el modelo
    // queda pendiente con su fuente intermedia también desactualizada.
    let req_v2 = IdGen::version(&baby.req, 2);
    let req = baby.req.as_str().to_string();
    save_with_sources(
        &mut baby,
        &flow,
        2,
        &flow_v2(&req),
        std::slice::from_ref(&req_v2),
    );
    save_req_version(&mut baby, &req_v2, "Cuarta redacción.");
    let req_v3 = IdGen::version(&baby.req, 3);
    let req_id = baby.req.clone();
    approve(&mut baby, &req_id, &req_v3);
    let preview = ruth_api::update_context_preview(&baby.store, preview_input(&baby, &mer, false))
        .expect("vista previa");
    assert!(!preview.can_generate);
    assert_eq!(preview.blockers.len(), 1);
    assert_eq!(preview.blockers[0].code, "source_stale");
    assert_eq!(
        preview.blockers[0].artifact_id.as_deref(),
        Some(flow.as_str())
    );
    assert!(preview.blockers[0].message.contains(flow.as_str()));
}

#[test]
fn preview_blocks_up_to_date_target() {
    let (mut baby, flow, _) = sales_pending();
    // El flujo ya se revisó con la fuente actual.
    let req_v2 = IdGen::version(&baby.req, 2);
    let req = baby.req.as_str().to_string();
    save_with_sources(
        &mut baby,
        &flow,
        2,
        &flow_v2(&req),
        std::slice::from_ref(&req_v2),
    );
    let preview = ruth_api::update_context_preview(&baby.store, preview_input(&baby, &flow, false))
        .expect("vista previa");
    assert!(!preview.can_generate);
    assert_eq!(preview.blockers.len(), 1);
    assert_eq!(preview.blockers[0].code, "target_up_to_date");
}

#[test]
fn preview_rejects_non_designs() {
    let (baby, _, _) = sales_pending();
    let err = ruth_api::update_context_preview(&baby.store, preview_input(&baby, &baby.req, false))
        .expect_err("no es diseño");
    assert_eq!(err.kind, "not_a_design");
}

#[test]
fn accept_update_creates_new_version_without_approval() {
    let tmp = TempDb::new("aceptar-update");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    assert_eq!(dto.target_artifact_id.as_deref(), Some(flow.as_str()));
    assert_eq!(dto.target_version_id.as_deref(), Some(flow_v1_id.as_str()));
    assert!(!dto.stale);
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect("aceptar");
    assert_eq!(detail.artifact.id, flow.as_str());
    assert_eq!(detail.versions.len(), 2);
    let current = detail.versions.last().expect("actual");
    assert_eq!(current.sources, vec![IdGen::version(&baby.req, 2).as_str()]);
    assert_eq!(current.provenance.kind, "ai");
    assert!(current.provenance.by.starts_with("ruth-gen/"));
    assert!(current.content.contains("reserva"));
    // Sin aprobación heredada: la v1 sigue aprobada, la v2 no.
    assert_eq!(detail.approvals.len(), 1);
    assert_eq!(detail.approvals[0].version_id, flow_v1_id.as_str());
    assert_eq!(detail.current_version_id, current.id);
    db.close();
}

#[test]
fn accept_er_update_creates_new_version() {
    let tmp = TempDb::new("aceptar-update-er");
    let (mut baby, mer, mer_v1_id) = sales_pending_er();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let snapshot =
        ruth_api::snapshot_update_context(&baby.store, preview_input(&baby, &mer, false))
            .expect("snapshot");
    assert_eq!(snapshot.kind, DesignKind::DataModel);
    let validated = parse_design_output(
        &er_v2(&req),
        DesignKind::DataModel,
        std::slice::from_ref(&req),
    )
    .expect("válido");
    let dto = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        RecordDesignInput {
            project_id: baby.project.as_str().to_string(),
            module_id: baby.module.as_str().to_string(),
            kind: DesignKind::DataModel,
            model: "muse-spark-1.3".to_string(),
            context: snapshot.context,
            validated,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            created_at: "2026-10-28T12:00:00Z".to_string(),
            target: Some(UpdateTarget {
                artifact_id: mer.as_str().to_string(),
                version_id: mer_v1_id.as_str().to_string(),
            }),
        },
    )
    .expect("registrar");
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(mer.as_str().to_string()),
            expected_version_id: Some(mer_v1_id.as_str().to_string()),
        },
    )
    .expect("aceptar");
    assert_eq!(detail.versions.len(), 2);
    let current = detail.versions.last().expect("actual");
    assert_eq!(current.sources, vec![IdGen::version(&baby.req, 2).as_str()]);
    assert_eq!(current.provenance.kind, "ai");
    assert!(detail
        .approvals
        .iter()
        .all(|a| a.version_id == mer_v1_id.as_str()));
    db.close();
}

#[test]
fn accept_update_is_idempotent() {
    let tmp = TempDb::new("update-idempotente");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    let input = AcceptDesignInput {
        generation_id: dto.id.clone(),
        spec: dto.proposal.spec.clone(),
        target_artifact_id: Some(flow.as_str().to_string()),
        expected_version_id: Some(flow_v1_id.as_str().to_string()),
    };
    let first = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        input.clone(),
    )
    .expect("aceptar");
    let second = ruth_api::accept_design(&mut baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("reintento");
    assert_eq!(first, second);
    assert_eq!(baby.store.versions_of(&flow).len(), 2);
    db.close();
}

#[test]
fn accept_update_blocked_when_target_moved() {
    let tmp = TempDb::new("objetivo-movido");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    // El diseño cambia durante la revisión (versión manual).
    let req_v2 = IdGen::version(&baby.req, 2);
    save_with_sources(
        &mut baby,
        &flow,
        2,
        &flow_v2(&req),
        std::slice::from_ref(&req_v2),
    );
    let before_store = baby.store.clone();
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect_err("objetivo movido");
    assert_eq!(err.kind, "update_stale");
    assert_eq!(baby.store, before_store);
    // La propuesta sobrevive como pendiente (desactualizada al consultar).
    assert!(matches!(
        baby.log.design(&dto.id).expect("sigue").proposal.state,
        ruth_store::ProposalState::Pending
    ));
    db.close();
}

#[test]
fn accept_update_blocked_when_source_changed() {
    let tmp = TempDb::new("fuente-cambiada");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    // Una fuente cambia durante la revisión.
    let req_v2 = IdGen::version(&baby.req, 2);
    save_req_version(&mut baby, &req_v2, "Cambio tardío.");
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect_err("fuente cambiada");
    assert_eq!(err.kind, "update_stale");
    db.close();
}

#[test]
fn accept_update_rejects_wrong_target() {
    let tmp = TempDb::new("objetivo-ajeno");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some("flujo-999".to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect_err("objetivo ajeno");
    assert_eq!(err.kind, "update_wrong_target");
    db.close();
}

#[test]
fn discarded_update_cannot_be_accepted() {
    let tmp = TempDb::new("update-descartada");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    ruth_api::discard_design(
        &mut baby.log,
        &db,
        ruth_api::DiscardDesignInput {
            generation_id: dto.id.clone(),
        },
    )
    .expect("descartar");
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect_err("descartada");
    assert_eq!(err.kind, "design_discarded");
    db.close();
}

#[test]
fn update_persistence_failure_changes_nothing() {
    let tmp = TempDb::new("update-fallo-disco");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    db.close();
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "UPDATE design_proposals SET state = 'discarded' WHERE generation_id = ?",
            [&dto.id],
        )
        .expect("forzar");
    }
    let (db2, _) = DbActor::spawn(&tmp.path).expect("reabrir");
    let before_store = baby.store.clone();
    let before_log = baby.log.clone();
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db2,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect_err("el disco manda");
    assert_eq!(err.kind, "storage_error");
    assert_eq!(baby.store, before_store);
    assert_eq!(baby.log, before_log);
    db2.close();
}

#[test]
fn update_roundtrips_across_reopen() {
    let tmp = TempDb::new("update-reabrir");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let req = baby.req.as_str().to_string();
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let back = loaded.designs.design(&dto.id).expect("propuesta");
    assert_eq!(back.target_artifact_id.as_deref(), Some(flow.as_str()));
    assert_eq!(back.target_version_id.as_deref(), Some(flow_v1_id.as_str()));
    assert_eq!(
        back.context_version_ids,
        vec![IdGen::version(&baby.req, 2).as_str()]
    );
    db2.close();
}

#[test]
fn impact_recalc_keeps_other_pending_after_update() {
    let tmp = TempDb::new("recalculo");
    let (mut baby, flow, flow_v1_id) = sales_pending();
    // Segundo diseño pendiente del mismo requisito.
    let req_v1 = IdGen::version(&baby.req, 1);
    let req = baby.req.as_str().to_string();
    let mer_content = serde_json::json!({
        "title": "Ventas",
        "entities": [
            {"name": "venta", "attributes": [{"name": "id", "key": true}], "requirements": [req]}
        ],
        "relations": [],
        "explanation": "Mínimo.",
        "questions": []
    })
    .to_string();
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        &mer_content,
        std::slice::from_ref(&req_v1),
    );
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let dto = record_update(&mut baby, &db, &flow, &flow_v1_id, fake_update(&req));
    ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto.id.clone(),
            spec: dto.proposal.spec.clone(),
            target_artifact_id: Some(flow.as_str().to_string()),
            expected_version_id: Some(flow_v1_id.as_str().to_string()),
        },
    )
    .expect("aceptar");
    let report = ruth_api::impact_report(
        &baby.store,
        ruth_api::ImpactQueryInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: req.clone(),
            from_version_id: None,
        },
    )
    .expect("informe");
    let flow_item = report
        .affected
        .iter()
        .find(|a| a.artifact.id == flow.as_str())
        .expect("flujo");
    assert!(!flow_item.requires_review);
    assert!(flow_item.approved_before);
    assert!(flow_item.approvals.is_empty());
    let mer_item = report
        .affected
        .iter()
        .find(|a| a.artifact.id == mer.as_str())
        .expect("mer");
    assert!(mer_item.requires_review);
    db.close();
}

#[test]
fn design_diff_compares_flows_and_rejects_invalid() {
    let req = "req-3";
    let diff = ruth_api::design_diff(ruth_api::DesignDiffInput {
        kind: "flow".to_string(),
        old_spec: serde_json::from_str(&flow_v1(req)).expect("json"),
        new_spec: serde_json::from_str(&flow_v2(req)).expect("json"),
    })
    .expect("diff");
    assert!(diff.added.iter().any(|i| i.id == "reserva"));
    assert!(diff.modified.iter().any(|i| i.id == "title"));
    assert!(diff.removed.iter().any(|i| i.id == "inicio → fin"));
    let er = ruth_api::design_diff(ruth_api::DesignDiffInput {
        kind: "data_model".to_string(),
        old_spec: serde_json::from_str(&er_v1(req)).expect("json"),
        new_spec: serde_json::from_str(&er_v2(req)).expect("json"),
    })
    .expect("diff ER");
    assert!(er.added.iter().any(|i| i.id == "reserva"));
    assert!(er.added.iter().any(|i| i.id == "venta → reserva"));
    assert!(er.removed.is_empty());
    let err = ruth_api::design_diff(ruth_api::DesignDiffInput {
        kind: "flow".to_string(),
        old_spec: serde_json::from_str(&flow_v1(req)).expect("json"),
        new_spec: serde_json::json!({"title": "Roto"}),
    })
    .expect_err("inválida");
    assert_eq!(err.kind, "generation_invalid");
    let err = ruth_api::design_diff(ruth_api::DesignDiffInput {
        kind: "uml".to_string(),
        old_spec: serde_json::from_str(&flow_v1(req)).expect("json"),
        new_spec: serde_json::from_str(&flow_v2(req)).expect("json"),
    })
    .expect_err("tipo");
    assert_eq!(err.kind, "generation_invalid");
}
