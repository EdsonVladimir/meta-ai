//! Mockups versionados sin red: creación manual, guardado de revisiones,
//! contexto para generar diseños y plantilla registrada. La red solo existe
//! en el comando; aquí todo es lógica pura sobre el dominio.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, CreateMockupInput, CreateModuleInput, CreateRequirementInput,
    DesignContextInput, GetDesignLayoutInput, GetRequirementInput, RecordDesignInput,
    SaveMockupVersionInput, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, Author, Content, HumanId, ProjectId, VersionId};
use ruth_meta::design::{
    parse_design_output, DESIGN_MOCKUP_TEMPLATE_VERSION, DESIGN_TEMPLATE_VERSION,
};
use ruth_meta::design::{DesignKind, ValidatedDesign};
use ruth_store::{DbActor, DesignLog, LayoutLog};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-mockup-{}-{}-{}.db",
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
    ids: ruth_api::IdGen,
    project: String,
    module: String,
    req: String,
}

fn baby() -> Baby {
    let mut store = Store::new();
    let mut ids = ruth_api::IdGen::new();
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
        project,
        module,
        req,
    }
}

fn mockup_baby(name: &str) -> (TempDb, Baby, DbActor, LayoutLog) {
    let tmp = TempDb::new(name);
    let baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    (tmp, baby, db, LayoutLog::new())
}

fn blank_spec(title: &str) -> serde_json::Value {
    serde_json::json!({"title": title, "screens": []})
}

fn reserva_spec(req: &str) -> serde_json::Value {
    serde_json::json!({
        "title": "Nueva reserva",
        "screens": [{
            "id": "nueva_reserva",
            "title": "Nueva reserva",
            "requirements": [req],
            "designs": [],
            "components": [
                {"id": "t1", "kind": "text", "text": "Nueva reserva",
                 "requirements": [], "designs": []},
                {"id": "f_cliente", "kind": "field", "label": "Cliente",
                 "field_type": "text", "required": true, "origin": "persisted",
                 "requirements": [req], "designs": []},
                {"id": "f_cantidad", "kind": "field", "label": "Cantidad",
                 "field_type": "number", "required": true, "origin": "temporary",
                 "requirements": [], "designs": []},
                {"id": "b_ok", "kind": "button", "label": "Confirmar",
                 "action": "confirmar_reserva", "requirements": [], "designs": []}
            ]
        }]
    })
}

fn create_input(baby: &Baby, spec: serde_json::Value, sources: Vec<String>) -> CreateMockupInput {
    CreateMockupInput {
        project_id: baby.project.clone(),
        module_id: baby.module.clone(),
        author: "bruno".to_string(),
        spec,
        source_version_ids: sources,
        layout: None,
    }
}

fn current_of(baby: &Baby, artifact: &str) -> (String, Vec<String>, serde_json::Value) {
    let detail = ruth_api::get_requirement(
        &baby.store,
        GetRequirementInput {
            artifact_id: artifact.to_string(),
        },
    )
    .expect("detalle");
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

fn save_input(
    baby: &Baby,
    artifact: &str,
    expected: &str,
    spec: serde_json::Value,
    sources: Vec<String>,
) -> SaveMockupVersionInput {
    SaveMockupVersionInput {
        project_id: baby.project.clone(),
        artifact_id: artifact.to_string(),
        expected_version_id: expected.to_string(),
        author: "bruno".to_string(),
        spec,
        source_version_ids: sources,
        layout: None,
    }
}

fn mockup_version_id(artifact: &str, number: u32) -> String {
    format!("{artifact}-v{number}")
}

#[test]
fn create_blank_canvas_without_sources() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("blanco");
    let input_13 = create_input(&baby, blank_spec("Lienzo"), vec![]);
    let detail =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_13)
            .expect("crear");
    assert!(detail.artifact.id.starts_with("mockup-"));
    assert_eq!(detail.artifact.kind, "mockup");
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.versions[0].provenance.kind, "human");
    assert!(detail.versions[0].sources.is_empty());
    assert!(detail.versions[0].content.contains("\"screens\":[]"));
    db.close();
}

#[test]
fn create_with_sources_pins_exact_versions() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("fuentes");
    let req = baby.req.clone();
    let spec = reserva_spec(&req);
    let input_12 = create_input(&baby, spec, vec![mockup_version_id(&req, 1)]);
    let detail =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_12)
            .expect("crear");
    assert_eq!(detail.versions[0].sources, vec![mockup_version_id(&req, 1)]);
    db.close();
}

#[test]
fn create_with_layout_persists_it() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("disposicion");
    let mut input = create_input(&baby, blank_spec("Con layout"), vec![]);
    input.layout = Some(serde_json::json!({"t1": {"x": 10.0, "y": 20.0}}));
    let detail = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect("crear");
    let dto = ruth_api::design_layout(
        &layouts,
        GetDesignLayoutInput {
            artifact_id: detail.artifact.id.clone(),
            version_id: detail.current_version_id.clone(),
        },
    );
    assert_eq!(
        dto.layout,
        serde_json::from_str(r#"{"t1":{"x":10.0,"y":20.0}}"#).ok()
    );
    db.close();
}

#[test]
fn refs_without_sources_fail_without_creating() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("sin-fuentes");
    let req = baby.req.clone();
    let before = baby
        .store
        .versions_of(&ArtifactId::new(req.clone()).expect("id"))
        .len();
    let input_11 = create_input(&baby, reserva_spec(&req), vec![]);
    let err = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_11)
        .expect_err("sin fuentes");
    assert_eq!(err.kind, "mockup_no_sources");
    // Nada creado: el requisito sigue con sus versiones y no hay mockups.
    assert_eq!(
        baby.store
            .versions_of(&ArtifactId::new(req).expect("id"))
            .len(),
        before
    );
    assert!(baby
        .store
        .artifacts_of(
            &ProjectId::new(baby.project.clone()).expect("proyecto"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("módulo"),
        )
        .iter()
        .all(|a| a.artifact_type() != ruth_core::domain::ArtifactType::Mockup));
    db.close();
}

#[test]
fn stale_source_blocks_by_name_then_current_succeeds() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("obsoleta");
    let req = baby.req.clone();
    // El requisito avanza a v2; declarar v1 debe bloquear con su nombre.
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            SaveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: req.clone(),
                expected_version_id: mockup_version_id(&req, 1),
                content: "Confirmar descuenta; reservar aparta.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("v2");
    let input_10 = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 1)]);
    let err = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_10)
        .expect_err("obsoleta");
    assert_eq!(err.kind, "mockup_stale_sources");
    assert!(err.message.contains(&req), "{}", err.message);
    // Con la actual sí se crea.
    let input_9 = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 2)]);
    let detail =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_9)
            .expect("crear con v2");
    assert_eq!(detail.versions[0].sources, vec![mockup_version_id(&req, 2)]);
    db.close();
}

#[test]
fn duplicate_source_artifact_rejected() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("duplicada");
    let req = baby.req.clone();
    let v1 = mockup_version_id(&req, 1);
    let input = create_input(&baby, blank_spec("D"), vec![v1.clone(), v1]);
    let err = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect_err("duplicada");
    assert_eq!(err.kind, "mockup_duplicate_source");
    db.close();
}

#[test]
fn save_creates_human_version_without_inheriting_approval() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("guardar");
    let req = baby.req.clone();
    let input_8 = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 1)]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_8)
            .expect("crear");
    let mockup = created.artifact.id.clone();
    // Revisar v1 y guardar v2: la revisión no se hereda.
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::approve_mockup_version(
            s,
            ApproveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: mockup.clone(),
                expected_version_id: created.current_version_id.clone(),
                approver: "ana".to_string(),
            },
            "2026-10-28T12:00:00Z",
        )
    })
    .expect("revisar");
    let (expected, sources, mut spec) = current_of(&baby, &mockup);
    spec["title"] = serde_json::json!("Nueva reserva (revisada)");
    let input_7 = save_input(&baby, &mockup, &expected, spec, sources);
    let saved =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_7)
            .expect("guardar");
    assert_eq!(saved.versions.len(), 2);
    let v2 = saved
        .versions
        .iter()
        .find(|v| v.id == saved.current_version_id)
        .expect("v2");
    assert_eq!(v2.provenance.kind, "human");
    assert!(v2.content.contains("revisada"));
    // La revisión de v1 se conserva pero no se hereda: v2 no está revisada.
    assert_eq!(saved.approvals.len(), 1);
    assert_eq!(saved.approvals[0].version_id, saved.versions[0].id);
    assert!(saved.approvals.iter().all(|a| a.version_id != v2.id));
    assert_eq!(saved.versions[0].provenance.kind, "human");
    db.close();
}

#[test]
fn save_conflict_keeps_store_unchanged() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("conflicto");
    let input_6 = create_input(&baby, blank_spec("C"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_6)
            .expect("crear");
    let mockup = created.artifact.id.clone();
    let (_, sources, mut spec) = current_of(&baby, &mockup);
    spec["title"] = serde_json::json!("Cambiado");
    let input_5 = save_input(&baby, &mockup, "mockup-999-v9", spec, sources);
    let err =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_5)
            .expect_err("conflicto");
    assert!(!err.kind.is_empty());
    let (expected, _, spec_now) = current_of(&baby, &mockup);
    assert_eq!(expected, created.current_version_id);
    assert_eq!(spec_now["title"], serde_json::json!("C"));
    db.close();
}

#[test]
fn save_rejects_non_mockup() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("no-mockup");
    let req = baby.req.clone();
    // El requisito guarda texto plano: solo nos interesa su versión actual.
    let expected = ruth_api::get_requirement(
        &baby.store,
        GetRequirementInput {
            artifact_id: req.clone(),
        },
    )
    .expect("detalle")
    .current_version_id;
    let input_4 = save_input(&baby, &req, &expected, blank_spec("X"), vec![]);
    let err =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_4)
            .expect_err("no mockup");
    assert_eq!(err.kind, "not_a_mockup");
    db.close();
}

#[test]
fn approve_revalidates_content() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("revisar");
    let input_3 = create_input(&baby, blank_spec("R"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_3)
            .expect("crear");
    let mockup = created.artifact.id.clone();
    // Contenido manipulado a mano (válido como texto, inválido como mockup).
    let project = ProjectId::new(baby.project.clone()).expect("proyecto");
    let artifact = ArtifactId::new(mockup.clone()).expect("artefacto");
    let expected = VersionId::new(created.current_version_id.clone()).expect("v1");
    let author = Author::Human(HumanId::new("x".to_string()).expect("autor"));
    baby.store
        .create_version(
            &project,
            &artifact,
            Some(&expected),
            VersionId::new(mockup_version_id(&mockup, 2)).expect("v2"),
            Content::new("{}".to_string()).expect("contenido"),
            &author,
            &[],
        )
        .expect("inyectar");
    let err = ruth_api::approve_mockup_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: mockup.clone(),
            expected_version_id: mockup_version_id(&mockup, 2),
            approver: "ana".to_string(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("inválido");
    assert_eq!(err.kind, "mockup_invalid");
    db.close();
}

#[test]
fn mockup_sources_reports_used_vs_current() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("fuentes");
    let req = baby.req.clone();
    let input = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 1)]);
    let created = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect("crear");
    let mockup = created.artifact.id.clone();
    let sources = ruth_api::mockup_sources(&baby.store, &baby.project, &mockup).expect("fuentes");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].artifact_id, req);
    assert!(!sources[0].changed);
    // El requisito avanza: la fuente queda obsoleta con ambas versiones.
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: req.clone(),
            expected_version_id: mockup_version_id(&req, 1),
            content: "Confirmar descuenta; reservar aparta.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let sources = ruth_api::mockup_sources(&baby.store, &baby.project, &mockup).expect("fuentes");
    assert_eq!(sources.len(), 1);
    assert!(sources[0].changed);
    assert_eq!(sources[0].used_version_id, mockup_version_id(&req, 1));
    assert_eq!(sources[0].current_version_id, mockup_version_id(&req, 2));
    // Sobre un requisito, error honesto.
    let err = ruth_api::mockup_sources(&baby.store, &baby.project, &req).expect_err("no mockup");
    assert_eq!(err.kind, "not_a_mockup");
    db.close();
}

#[test]
fn validate_stored_returns_canonical_and_counts() {
    let req = "req-1";
    let spec = serde_json::json!({
        "title": "Nueva reserva",
        "screens": [{
            "id": "nueva_reserva",
            "title": "Nueva reserva",
            "requirements": [req],
            "designs": [],
            "components": [
                {"id": "t1", "kind": "text", "text": "Nueva reserva",
                 "requirements": [], "designs": []},
                {"id": "b_ok", "kind": "button", "label": "Confirmar",
                 "requirements": [], "designs": []}
            ]
        }]
    });
    let dto =
        ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput { spec }).expect("válido");
    assert!(dto.canonical.contains("\"kind\":\"mockup\""));
    assert_eq!(dto.title, "Nueva reserva");
    assert_eq!(dto.screens, 1);
    assert_eq!(dto.components, 2);
    let bad = serde_json::json!({"title": "Roto", "screens": []});
    // Vacío sí vale; lo que no vale es forma ajena.
    let dto = ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput { spec: bad })
        .expect("lienzo en blanco");
    assert_eq!(dto.screens, 0);
    let err = ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput {
        spec: serde_json::json!({"title": "Sin pantallas"}),
    })
    .expect_err("sin pantallas");
    assert!(!err.kind.is_empty());
}

#[test]
fn snapshot_accepts_mixed_and_mockup_only() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("contexto");
    let req = baby.req.clone();
    let input_2 = create_input(&baby, blank_spec("M"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_2)
            .expect("crear");
    let mockup = created.artifact.id.clone();
    let mixed = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
        std::slice::from_ref(&mockup),
    )
    .expect("mixto");
    assert_eq!(mixed.requirements.len(), 1);
    assert_eq!(mixed.mockups.len(), 1);
    assert_eq!(mixed.requirements[0].version_id, mockup_version_id(&req, 1));
    assert_eq!(mixed.mockups[0].version_id, mockup_version_id(&mockup, 1));
    // Solo mockup, sin requisitos: permitido (la plantilla pide señalarlo).
    let alone = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &[],
        std::slice::from_ref(&mockup),
    )
    .expect("solo mockup");
    assert!(alone.requirements.is_empty());
    assert_eq!(alone.mockups.len(), 1);
    // Vacío y duplicado se rechazan antes de consumir red.
    let err = ruth_api::snapshot_mockup_context(&baby.store, &baby.project, &baby.module, &[], &[])
        .expect_err("vacío");
    assert_eq!(err.kind, "empty_selection");
    let err = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &[],
        &[mockup.clone(), mockup],
    )
    .expect_err("duplicado");
    assert_eq!(err.kind, "duplicate_selection");
    db.close();
}

#[test]
fn snapshot_rejects_wrong_kind() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("tipo");
    let req = baby.req.clone();
    let err = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &[],
        std::slice::from_ref(&req),
    )
    .expect_err("requisito como mockup");
    assert_eq!(err.kind, "not_a_requirement");
    let _ = layouts;
    db.close();
}

#[test]
fn context_preview_lists_requirements_designs_and_mockups() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("vista");
    let input_1 = create_input(&baby, blank_spec("M"), vec![]);
    ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_1)
        .expect("crear");
    // Un flujo a mano (la vista no valida contenidos, solo los lista).
    let project = ProjectId::new(baby.project.clone()).expect("proyecto");
    let module = ruth_core::domain::ModuleId::new(baby.module.clone()).expect("módulo");
    let flow = baby.ids.flow();
    baby.store
        .create_artifact(
            &project,
            &module,
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flujo");
    baby.store
        .create_version(
            &project,
            &flow,
            None,
            ruth_api::IdGen::version(&flow, 1),
            Content::new("{}".to_string()).expect("contenido"),
            &Author::Human(HumanId::new("ana".to_string()).expect("autora")),
            &[],
        )
        .expect("v1");
    let preview = ruth_api::mockup_context_preview(
        &baby.store,
        DesignContextInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("vista");
    assert_eq!(preview.requirements.len(), 1);
    assert_eq!(preview.designs.len(), 1);
    assert_eq!(preview.mockups.len(), 1);
    assert!(preview.mockups[0].excerpt.contains("Mockup: M"));
    db.close();
}

/// Generador falso: flujo validado de verdad, sin red.
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

#[test]
fn record_with_mockup_context_uses_mockup_template() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("plantilla");
    let req = baby.req.clone();
    let input_0 = create_input(&baby, blank_spec("M"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_0)
            .expect("crear");
    let mockup = created.artifact.id.clone();
    let mut log = DesignLog::new();
    // Desde mockup (+ requisito): plantilla de mockups.
    let snapshot = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
        std::slice::from_ref(&mockup),
    )
    .expect("contexto");
    let mut context = snapshot.requirements;
    context.extend(snapshot.mockups);
    let dto = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        RecordDesignInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            kind: DesignKind::Flow,
            model: "muse-spark".to_string(),
            context,
            validated: fake_flow(&req),
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            created_at: "2026-10-28T12:00:00Z".to_string(),
            target: None,
        },
    )
    .expect("registrar");
    assert_eq!(dto.template_version, DESIGN_MOCKUP_TEMPLATE_VERSION);
    // Solo requisitos: plantilla clásica (sin regresión).
    let context = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
    )
    .expect("contexto req");
    let dto = ruth_api::record_design_generation(
        &baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        RecordDesignInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            kind: DesignKind::Flow,
            model: "muse-spark".to_string(),
            context,
            validated: fake_flow(&req),
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
            created_at: "2026-10-28T12:00:00Z".to_string(),
            target: None,
        },
    )
    .expect("registrar");
    assert_eq!(dto.template_version, DESIGN_TEMPLATE_VERSION);
    db.close();
}
