//! Diseños vinculados a requisitos sin red: el "generador falso" valida
//! especificaciones a mano con `ruth-meta`; la red solo existe en el comando.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    AcceptDesignInput, ApproveVersionInput, CreateModuleInput, CreateRequirementInput,
    DesignContextInput, DiscardDesignInput, IdGen, ListDesignsInput, RecordDesignInput,
    ValidateDesignInput,
};
use ruth_core::application::Store;
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
            "ruth-design-{}-{}-{}.db",
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
    project: String,
    module: String,
    req: String,
}

fn baby() -> Baby {
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
    Baby {
        store,
        ids,
        log: DesignLog::new(),
        project,
        module,
        req,
    }
}

fn approve_current(baby: &mut Baby, db: &DbActor, artifact: &str) {
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: artifact.to_string(),
        },
    )
    .expect("detalle");
    ruth_api::transact(&mut baby.store, &mut baby.ids, db, |s, _| {
        ruth_api::approve_version(
            s,
            ApproveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: artifact.to_string(),
                expected_version_id: detail.current_version_id.clone(),
                approver: "ana".to_string(),
            },
            "2026-10-28T12:00:00Z",
        )
    })
    .expect("aprobar");
}

/// Generador falso: especificación validada de verdad, sin red.
fn fake_flow(req: &str) -> ValidatedDesign {
    let text = serde_json::json!({
        "title": "Flujo de venta",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": [req]},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [{"from": "inicio", "to": "fin"}],
        "explanation": "Flujo mínimo.",
        "questions": []
    })
    .to_string();
    parse_design_output(&text, DesignKind::Flow, &[req.to_string()]).expect("válido")
}

fn record_input(baby: &Baby, validated: ValidatedDesign) -> RecordDesignInput {
    let context = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&baby.req),
    )
    .expect("contexto");
    RecordDesignInput {
        project_id: baby.project.clone(),
        module_id: baby.module.clone(),
        kind: DesignKind::Flow,
        model: "muse-spark-1.3".to_string(),
        context,
        validated,
        input_tokens: Some(100),
        output_tokens: Some(200),
        total_tokens: Some(300),
        created_at: "2026-10-28T12:00:00Z".to_string(),
        target: None,
    }
}

fn accept_input(generation_id: &str, spec: serde_json::Value) -> AcceptDesignInput {
    AcceptDesignInput {
        generation_id: generation_id.to_string(),
        spec,
        target_artifact_id: None,
        expected_version_id: None,
    }
}

#[test]
fn record_and_list_roundtrip_with_reopen() {
    let tmp = TempDb::new("registro");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let validated = fake_flow(&baby.req.clone());
    let input = record_input(&baby, validated);
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    assert_eq!(dto.kind, "flow");
    assert!(!dto.stale);
    assert!(dto.proposal.mermaid.starts_with("flowchart TD"));
    assert_eq!(dto.context_version_ids, vec![format!("{}-v1", baby.req)]);
    let listed = ruth_api::list_designs(
        &baby.store,
        &baby.log,
        ListDesignsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("listar");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, dto.id);
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let again = loaded.designs.design(&dto.id).expect("diseño");
    assert_eq!(again.proposal.title, "Flujo de venta");
    assert!(again.proposal.spec_json.contains("\"kind\":\"flow\""));
    db2.close();
}

#[test]
fn accept_creates_flow_with_exact_sources_unapproved() {
    let tmp = TempDb::new("aceptar");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let validated = fake_flow(&req);
    let input = record_input(&baby, validated);
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let spec = dto.proposal.spec.clone();
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, spec),
    )
    .expect("aceptar");
    assert_eq!(detail.artifact.kind, "flow");
    assert!(detail.artifact.id.starts_with("flujo-"));
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.versions[0].provenance.kind, "ai");
    assert!(detail.approvals.is_empty());
    // Dependencias exactas a las versiones utilizadas.
    assert_eq!(detail.versions[0].sources, vec![format!("{req}-v1")]);
    assert!(detail.versions[0].content.contains("\"kind\":\"flow\""));
    db.close();
}

#[test]
fn accept_is_idempotent_without_duplicates() {
    let tmp = TempDb::new("idempotente");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let count_before = baby
        .store
        .artifacts_of(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
        )
        .len();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let first = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect("aceptar");
    let second = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect("reintento");
    assert_eq!(second.artifact.id, first.artifact.id);
    assert_eq!(second.versions.len(), 1);
    let count_after = baby
        .store
        .artifacts_of(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
        )
        .len();
    assert_eq!(count_after, count_before + 1);
    db.close();
}

#[test]
fn accept_versions_chosen_artifact_without_inheriting_approval() {
    let tmp = TempDb::new("versionar");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    // Primera aceptación: crea el flujo; se aprueba su v1.
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let first = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect("aceptar");
    let flow_id = first.artifact.id.clone();
    approve_current(&mut baby, &db, &flow_id);
    // Segunda generación aceptada como v2 del mismo flujo.
    let input_dto2 = record_input(&baby, fake_flow(&req));
    let dto2 = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        input_dto2,
    )
    .expect("registrar");
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: flow_id.clone(),
        },
    )
    .expect("detalle");
    let second = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto2.id.clone(),
            spec: dto2.proposal.spec.clone(),
            target_artifact_id: Some(flow_id.clone()),
            expected_version_id: Some(detail.current_version_id.clone()),
        },
    )
    .expect("versionar");
    assert_eq!(second.artifact.id, flow_id);
    assert_eq!(second.versions.len(), 2);
    // La v2 no hereda la aprobación de la v1.
    let v2 = second.versions.last().expect("v2");
    assert!(second.approvals.iter().all(|a| a.version_id != v2.id));
    assert_eq!(v2.provenance.kind, "ai");
    // Versión esperada obsoleta en una tercera generación: el núcleo
    // rechaza sin mutar nada.
    let input_dto3 = record_input(&baby, fake_flow(&req));
    let dto3 = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        input_dto3,
    )
    .expect("registrar");
    let before = baby.store.clone();
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        AcceptDesignInput {
            generation_id: dto3.id.clone(),
            spec: dto3.proposal.spec.clone(),
            target_artifact_id: Some(flow_id.clone()),
            expected_version_id: Some(detail.current_version_id.clone()),
        },
    )
    .expect_err("obsoleta");
    assert_eq!(err.kind, "stale_version");
    assert_eq!(baby.store, before);
    db.close();
}

#[test]
fn stale_generation_blocks_accept_but_survives() {
    let tmp = TempDb::new("caducidad");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    // Cambia una fuente: nueva versión del requisito.
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: req.clone(),
        },
    )
    .expect("detalle");
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            ruth_api::SaveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: req.clone(),
                expected_version_id: detail.current_version_id.clone(),
                content: "Confirmar descuenta stock; reservas antes.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("nueva versión");
    let listed = ruth_api::list_designs(
        &baby.store,
        &baby.log,
        ListDesignsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("listar");
    assert!(listed[0].stale);
    assert_eq!(listed[0].context_version_ids, dto.context_version_ids);
    let before = baby.store.clone();
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect_err("bloqueada");
    assert_eq!(err.kind, "design_stale");
    assert_eq!(baby.store, before);
    db.close();
}

#[test]
fn source_change_after_accept_requires_review() {
    let tmp = TempDb::new("revision");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect("aceptar");
    // Cambia la fuente tras aceptar: aprobar el derivado desactualizado
    // ya no basta; el núcleo exige versión revisada.
    let req_detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: req.clone(),
        },
    )
    .expect("detalle");
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            ruth_api::SaveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: req.clone(),
                expected_version_id: req_detail.current_version_id.clone(),
                content: "Confirmar descuenta stock; reservas antes.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("nueva versión");
    let err = ruth_api::approve_design_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: detail.artifact.id.clone(),
            expected_version_id: detail.current_version_id.clone(),
            approver: "ana".to_string(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("no vigente");
    assert_eq!(err.kind, "version_not_valid");
    db.close();
}

#[test]
fn approve_design_requires_design_and_valid_content() {
    let tmp = TempDb::new("aprobar");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect("aceptar");
    // Camino feliz: contenido válido, vigente y actual.
    let approved = ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::approve_design_version(
            s,
            ApproveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: detail.artifact.id.clone(),
                expected_version_id: detail.current_version_id.clone(),
                approver: "ana".to_string(),
            },
            "2026-10-28T12:00:00Z",
        )
    })
    .expect("aprobar");
    assert_eq!(approved.approvals.len(), 1);
    // Un requisito no se aprueba por este comando.
    let req_detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: req.clone(),
        },
    )
    .expect("detalle");
    let err = ruth_api::approve_design_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: req.clone(),
            expected_version_id: req_detail.current_version_id.clone(),
            approver: "ana".to_string(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("no es diseño");
    assert_eq!(err.kind, "not_a_design");
    db.close();
}

#[test]
fn approve_design_rejects_invalid_content() {
    let tmp = TempDb::new("contenido-invalido");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    // Flujo con contenido basura creado a mano (simula corrupción).
    let project = ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id");
    let module = ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id");
    let flow = baby.ids.flow();
    baby.store
        .create_artifact(
            &project,
            &module,
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flujo");
    let version = ruth_api::IdGen::version(&flow, 1);
    baby.store
        .create_version(
            &project,
            &flow,
            None,
            version.clone(),
            ruth_core::domain::Content::new("no es JSON".to_string()).expect("contenido"),
            &ruth_core::domain::Author::Human(
                ruth_core::domain::HumanId::new("ana").expect("autora"),
            ),
            &[],
        )
        .expect("versión");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let err = ruth_api::approve_design_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: flow.as_str().to_string(),
            expected_version_id: version.as_str().to_string(),
            approver: "ana".to_string(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("contenido inválido");
    assert_eq!(err.kind, "design_invalid");
    db.close();
}

#[test]
fn discard_blocks_accept_and_validate_checks_scope() {
    let tmp = TempDb::new("descarte");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    // Validar contra la generación: referencia ajena rechazada.
    let mut foreign = dto.proposal.spec.clone();
    foreign["nodes"][0]["requirements"] = serde_json::json!(["req-999"]);
    let err = ruth_api::validate_design(
        &baby.store,
        &baby.log,
        ValidateDesignInput {
            kind: "flow".to_string(),
            spec: foreign,
            generation_id: Some(dto.id.clone()),
        },
    )
    .expect_err("fuera del conjunto");
    assert_eq!(err.kind, "generation_invalid");
    // Sin generación: estructural (historial), con Mermaid derivado.
    let ok = ruth_api::validate_design(
        &baby.store,
        &baby.log,
        ValidateDesignInput {
            kind: "flow".to_string(),
            spec: dto.proposal.spec.clone(),
            generation_id: None,
        },
    )
    .expect("estructural");
    assert!(ok.mermaid.starts_with("flowchart TD"));
    assert!(ok.canonical.contains("\"kind\":\"flow\""));
    // Descartar bloquea aceptar.
    ruth_api::discard_design(
        &mut baby.log,
        &db,
        DiscardDesignInput {
            generation_id: dto.id.clone(),
        },
    )
    .expect("descartar");
    let err = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect_err("descartada");
    assert_eq!(err.kind, "design_discarded");
    db.close();
}

#[test]
fn persistence_failure_accepts_nothing_partially() {
    let tmp = TempDb::new("fallo-disco");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let input = record_input(&baby, fake_flow(&req));
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
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
        accept_input(&dto.id, dto.proposal.spec.clone()),
    )
    .expect_err("el disco manda");
    assert_eq!(err.kind, "storage_error");
    assert_eq!(baby.store, before_store);
    assert_eq!(baby.log, before_log);
    db2.close();
}

#[test]
fn selection_accepts_saved_requirements_without_review() {
    let baby = baby();
    // Vacía: error antes de consumir red.
    let err = ruth_api::snapshot_design_context(&baby.store, &baby.project, &baby.module, &[])
        .expect_err("vacía");
    assert_eq!(err.kind, "empty_selection");
    // Sin revisar: permitido desde el diseño vivo (versión guardada basta).
    let context = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&baby.req),
    )
    .expect("sin revisar");
    assert_eq!(context.len(), 1);
    assert_eq!(context[0].artifact_id, baby.req);
    // Inexistente: sigue bloqueando (estructural).
    let err = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &["req-999".to_string()],
    )
    .expect_err("inexistente");
    assert_eq!(err.kind, "artifact_not_found");
    // La vista previa informa la revisión como dato, no como veto.
    let preview = ruth_api::design_context_preview(
        &baby.store,
        DesignContextInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("vista previa");
    assert_eq!(preview.len(), 1);
    assert!(!preview[0].approved);
}

// ---------------------------------------------------------------------------
// Revisión manual desde el editor visual (hito 10): procedencia humana, sin
// heredar aprobación, con disposición en la misma transacción. Sin red.
// ---------------------------------------------------------------------------

use ruth_api::{GetDesignLayoutInput, SaveDesignVersionInput};
use ruth_store::LayoutLog;

fn fake_er(req: &str) -> ValidatedDesign {
    let text = serde_json::json!({
        "title": "Modelo de venta",
        "entities": [
            {"name": "Venta", "attributes": [{"name": "id", "key": true}], "requirements": [req]},
            {"name": "DetalleVenta", "attributes": [{"name": "id", "key": true}], "requirements": []}
        ],
        "relations": [{"from": "Venta", "to": "DetalleVenta", "from_card": "1", "to_card": "0..N"}],
        "explanation": "Modelo mínimo.",
        "questions": []
    })
    .to_string();
    parse_design_output(&text, DesignKind::DataModel, &[req.to_string()]).expect("válido")
}

/// Base con un flujo aceptado (v1, IA, sin aprobar) y su requisito aprobado.
fn flow_baby(name: &str) -> (TempDb, Baby, DbActor, String) {
    let tmp = TempDb::new(name);
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let validated = fake_flow(&req);
    let input = record_input(&baby, validated);
    let dto =
        ruth_api::record_design_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
            .expect("registrar");
    let spec = dto.proposal.spec.clone();
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, spec),
    )
    .expect("aceptar");
    let design = detail.artifact.id.clone();
    (tmp, baby, db, design)
}

fn save_input(
    project: &str,
    design: &str,
    expected: &str,
    spec: serde_json::Value,
    sources: Vec<String>,
    layout: Option<serde_json::Value>,
) -> SaveDesignVersionInput {
    SaveDesignVersionInput {
        project_id: project.to_string(),
        artifact_id: design.to_string(),
        expected_version_id: expected.to_string(),
        author: "bruno".to_string(),
        spec,
        source_version_ids: sources,
        layout,
    }
}

fn current_of(detail: &ruth_api::RequirementDetail) -> (String, Vec<String>, serde_json::Value) {
    let current = detail
        .versions
        .iter()
        .find(|v| v.id == detail.current_version_id)
        .expect("actual");
    (
        current.id.clone(),
        current.sources.clone(),
        serde_json::from_str(&current.content).expect("json"),
    )
}

#[test]
fn manual_save_creates_human_version_with_layout() {
    let (_tmp, mut baby, db, design) = flow_baby("manual");
    let mut layouts = LayoutLog::new();
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    let (expected, sources, mut spec) = current_of(&detail);
    spec["title"] = serde_json::json!("Flujo de venta (revisado)");
    let layout =
        serde_json::json!({ "inicio": { "x": 40.0, "y": 80.0 }, "fin": { "x": 40.0, "y": 320.0 } });
    let saved = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            &expected,
            spec,
            sources,
            Some(layout),
        ),
    )
    .expect("guardar");
    assert_eq!(saved.versions.len(), 2);
    let v2 = saved
        .versions
        .iter()
        .find(|v| v.id == saved.current_version_id)
        .expect("v2");
    assert_eq!(v2.provenance.kind, "human");
    assert_eq!(v2.provenance.by, "bruno");
    assert!(v2.content.contains("Flujo de venta (revisado)"));
    // Sin aprobación heredada y v1 intacta.
    assert!(saved.approvals.is_empty());
    assert_eq!(saved.versions[0].provenance.kind, "ai");
    assert_eq!(v2.sources, vec![format!("{}-v1", baby.req)]);
    // Disposición guardada con la versión nueva.
    let dto = ruth_api::design_layout(
        &layouts,
        GetDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: v2.id.clone(),
        },
    );
    assert_eq!(
        dto.layout,
        serde_json::from_str(r#"{"fin":{"x":40.0,"y":320.0},"inicio":{"x":40.0,"y":80.0}}"#).ok()
    );
    db.close();
}

#[test]
fn manual_save_blocks_stale_sources_by_name_then_accepts_current() {
    let (_tmp, mut baby, db, design) = flow_baby("manual-stale");
    let mut layouts = LayoutLog::new();
    // El requisito avanza: la fijación v1 del diseño queda obsoleta.
    let req_detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: baby.req.clone(),
        },
    )
    .expect("requisito");
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            ruth_api::SaveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: baby.req.clone(),
                expected_version_id: req_detail.current_version_id.clone(),
                content: "Confirmar una venta descuenta stock; reservas antes.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("req v2");
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    let (expected, sources, spec) = current_of(&detail);
    assert_eq!(sources, vec![format!("{}-v1", baby.req)]);
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            &expected,
            spec.clone(),
            sources,
            None,
        ),
    )
    .expect_err("obsoleta");
    assert_eq!(err.kind, "design_stale_sources");
    assert!(err.message.contains(&baby.req), "nombra la fuente");
    // Nada a medias: sigue en v1.
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    assert_eq!(detail.versions.len(), 1);
    // Adoptar explícitamente la actual desbloquea.
    let saved = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            &expected,
            spec,
            vec![format!("{}-v2", baby.req)],
            None,
        ),
    )
    .expect("guardar con actual");
    let v2 = saved
        .versions
        .iter()
        .find(|v| v.id == saved.current_version_id)
        .expect("v2");
    assert_eq!(v2.sources, vec![format!("{}-v2", baby.req)]);
    db.close();
}

#[test]
fn manual_save_rejects_conflict_spec_and_targets_without_partials() {
    let (_tmp, mut baby, db, design) = flow_baby("manual-conflicto");
    let mut layouts = LayoutLog::new();
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    let (expected, sources, spec) = current_of(&detail);
    // Versión esperada obsoleta.
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            "flujo-1-v999",
            spec.clone(),
            sources.clone(),
            None,
        ),
    )
    .expect_err("conflicto");
    assert_eq!(err.kind, "stale_version");
    // Especificación inválida (nodo duplicado).
    let mut bad = spec.clone();
    bad["nodes"]
        .as_array_mut()
        .expect("nodos")
        .push(serde_json::json!({"id": "inicio", "kind": "step", "label": "Duplicado", "requirements": []}));
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            &expected,
            bad,
            sources.clone(),
            None,
        ),
    )
    .expect_err("duplicado");
    assert!(err.message.contains("duplicado"));
    // Requisito como objetivo.
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &baby.req.clone(),
            &expected,
            spec.clone(),
            sources.clone(),
            None,
        ),
    )
    .expect_err("requisito");
    assert_eq!(err.kind, "not_a_design");
    // Sin fuentes.
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(&baby.project, &design, &expected, spec, vec![], None),
    )
    .expect_err("sin fuentes");
    assert_eq!(err.kind, "design_no_sources");
    // Fuente inexistente.
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    let (expected, _, spec) = current_of(&detail);
    let err = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(
            &baby.project,
            &design,
            &expected,
            spec,
            vec!["req-999-v1".to_string()],
            None,
        ),
    )
    .expect_err("inexistente");
    assert_eq!(err.kind, "design_source_missing");
    // Todo rechazado sin mutar: v1 intacta y sin disposición.
    assert_eq!(detail.versions.len(), 1);
    let dto = ruth_api::design_layout(
        &layouts,
        GetDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: detail.current_version_id.clone(),
        },
    );
    assert_eq!(dto.layout, None);
    db.close();
}

#[test]
fn manual_save_data_model_and_approvals_stack() {
    let tmp = TempDb::new("manual-er");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let approved_req = baby.req.clone();
    approve_current(&mut baby, &db, &approved_req);
    let req = baby.req.clone();
    let validated = fake_er(&req);
    let context = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&baby.req),
    )
    .expect("contexto");
    let dto = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        RecordDesignInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            kind: DesignKind::DataModel,
            model: "muse-spark-1.3".to_string(),
            context,
            validated,
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            created_at: "2026-10-28T12:00:00Z".to_string(),
            target: None,
        },
    )
    .expect("registrar");
    let spec = dto.proposal.spec.clone();
    let detail = ruth_api::accept_design(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, spec),
    )
    .expect("aceptar");
    let design = detail.artifact.id.clone();
    assert_eq!(detail.artifact.kind, "data_model");
    // Aprobar v1 y revisar a mano: v2 nace sin aprobación y v1 la conserva.
    approve_current(&mut baby, &db, &design);
    let mut layouts = LayoutLog::new();
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    assert_eq!(detail.approvals.len(), 1);
    let (expected, sources, mut spec) = current_of(&detail);
    spec["entities"]
        .as_array_mut()
        .expect("entidades")
        .push(serde_json::json!({
            "name": "Reserva",
            "attributes": [{"name": "id", "key": true}],
            "requirements": []
        }));
    let saved = ruth_api::save_design_version(
        &mut baby.store,
        &mut baby.ids,
        &mut layouts,
        &db,
        save_input(&baby.project, &design, &expected, spec, sources, None),
    )
    .expect("guardar");
    assert_eq!(saved.versions.len(), 2);
    assert_eq!(saved.approvals.len(), 1);
    assert_eq!(saved.approvals[0].version_id, detail.current_version_id);
    let v2 = saved
        .versions
        .iter()
        .find(|v| v.id == saved.current_version_id)
        .expect("v2");
    assert_eq!(v2.provenance.kind, "human");
    assert!(v2.content.contains("Reserva"));
    db.close();
}

#[test]
fn manual_save_persists_layout_across_reopen() {
    let tmp = TempDb::new("manual-reabrir");
    let design: String;
    let v2_id: String;
    {
        let mut baby = baby();
        let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
        db.save(&baby.store, baby.ids.checkpoint())
            .expect("dominio");
        let approved_req = baby.req.clone();
        approve_current(&mut baby, &db, &approved_req);
        let req = baby.req.clone();
        let validated = fake_flow(&req);
        let input = record_input(&baby, validated);
        let dto = ruth_api::record_design_generation(
            &baby.store,
            &mut baby.ids,
            &mut baby.log,
            &db,
            input,
        )
        .expect("registrar");
        let spec = dto.proposal.spec.clone();
        let detail = ruth_api::accept_design(
            &mut baby.store,
            &mut baby.ids,
            &mut baby.log,
            &db,
            accept_input(&dto.id, spec),
        )
        .expect("aceptar");
        design = detail.artifact.id.clone();
        let (expected, sources, spec) = current_of(&detail);
        let mut layouts = LayoutLog::new();
        let saved = ruth_api::save_design_version(
            &mut baby.store,
            &mut baby.ids,
            &mut layouts,
            &db,
            save_input(
                &baby.project,
                &design,
                &expected,
                spec,
                sources,
                Some(serde_json::json!({ "inicio": { "x": 1.0, "y": 2.0 } })),
            ),
        )
        .expect("guardar");
        v2_id = saved.current_version_id.clone();
        db.close();
    }
    let (db, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let dto = ruth_api::design_layout(
        &loaded.layouts,
        GetDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: v2_id.clone(),
        },
    );
    assert_eq!(
        dto.layout,
        serde_json::from_str(r#"{"inicio":{"x":1.0,"y":2.0}}"#).ok()
    );
    // La v1 no tiene disposición: trazado automático.
    let dto = ruth_api::design_layout(
        &loaded.layouts,
        GetDesignLayoutInput {
            artifact_id: design,
            version_id: "v1-inexistente".to_string(),
        },
    );
    assert_eq!(dto.layout, None);
    db.close();
}

#[test]
fn sanitize_layout_keeps_valid_sorted_and_rejects_non_objects() {
    let clean = ruth_api::sanitize_layout(&serde_json::json!({
        "b": { "x": 10.0, "y": 20.0 },
        "a": { "x": 0.0, "y": 0.0 },
        "mala": { "x": "no", "y": 1.0 },
        "": { "x": 1.0, "y": 1.0 },
    }))
    .expect("higieniza");
    assert_eq!(
        clean.as_deref(),
        Some(r#"{"a":{"x":0.0,"y":0.0},"b":{"x":10.0,"y":20.0}}"#)
    );
    assert_eq!(
        ruth_api::sanitize_layout(&serde_json::json!({})).expect("vacía"),
        None
    );
    let err = ruth_api::sanitize_layout(&serde_json::json!([1])).expect_err("no objeto");
    assert_eq!(err.kind, "design_layout_invalid");
}

#[test]
fn sanitize_layout_keeps_optional_size_and_drops_invalid() {
    let clean = ruth_api::sanitize_layout(&serde_json::json!({
        "b": { "x": 10.0, "y": 20.0 },
        "a": { "x": 0.0, "y": 0.0, "w": 120.0, "h": 40.0 },
    }))
    .expect("higieniza");
    assert_eq!(
        clean.as_deref(),
        Some(r#"{"a":{"h":40.0,"w":120.0,"x":0.0,"y":0.0},"b":{"x":10.0,"y":20.0}}"#)
    );
    // Tamaño inválido (negativo, cero): se conserva la posición sin tamaño.
    let clean = ruth_api::sanitize_layout(&serde_json::json!({
        "a": { "x": 0.0, "y": 0.0, "w": -5.0, "h": 0.0 },
    }))
    .expect("higieniza");
    assert_eq!(clean.as_deref(), Some(r#"{"a":{"x":0.0,"y":0.0}}"#));
}

#[test]
fn design_layout_tolerates_unreadable_rows() {
    let mut layouts = LayoutLog::new();
    layouts.rehydrate(
        "flujo-1".to_string(),
        "flujo-1-v1".to_string(),
        "rota{".to_string(),
    );
    let dto = ruth_api::design_layout(
        &layouts,
        GetDesignLayoutInput {
            artifact_id: "flujo-1".to_string(),
            version_id: "flujo-1-v1".to_string(),
        },
    );
    assert_eq!(dto.layout, None);
}

#[test]
fn layout_only_save_roundtrips_without_new_version() {
    let (_tmp, mut baby, db, design) = flow_baby("solo-disposicion");
    let mut layouts = LayoutLog::new();
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    ruth_api::save_design_layout_only(
        &baby.store,
        &mut layouts,
        &db,
        ruth_api::SaveDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: detail.current_version_id.clone(),
            layout: serde_json::json!({ "inicio": { "x": 9.0, "y": 9.0 } }),
        },
    )
    .expect("guardar disposición");
    // Sin versión nueva y disposición legible.
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: design.clone(),
        },
    )
    .expect("detalle");
    assert_eq!(detail.versions.len(), 1);
    let dto = ruth_api::design_layout(
        &layouts,
        GetDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: detail.current_version_id.clone(),
        },
    );
    assert_eq!(
        dto.layout,
        serde_json::from_str(r#"{"inicio":{"x":9.0,"y":9.0}}"#).ok()
    );
    // Versión ajena: error sin escribir.
    let err = ruth_api::save_design_layout_only(
        &baby.store,
        &mut layouts,
        &db,
        ruth_api::SaveDesignLayoutInput {
            artifact_id: design.clone(),
            version_id: "req-999-v1".to_string(),
            layout: serde_json::json!({ "a": { "x": 1.0, "y": 1.0 } }),
        },
    )
    .expect_err("ajena");
    assert_eq!(err.kind, "version_not_found");
    db.close();
}
