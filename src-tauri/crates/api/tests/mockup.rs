//! Versioned mockups without network: manual creation, review saving,
//! design-generation context and recorded template. Network only exists
//! in the command; here everything is pure domain logic.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    AcceptMockupScreenInput, ApproveVersionInput, CreateMockupInput, CreateModuleInput,
    CreateRequirementInput, DesignContextInput, DiscardMockupScreenInput, GetDesignLayoutInput,
    GetRequirementInput, ListMockupGenerationsInput, RecordDesignInput, RecordMockupInput,
    SaveMockupVersionInput, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, Author, Content, HumanId, ProjectId, VersionId};
use ruth_meta::design::{
    parse_design_output, DESIGN_MOCKUP_TEMPLATE_VERSION, DESIGN_TEMPLATE_VERSION,
};
use ruth_meta::design::{DesignKind, ValidatedDesign};
use ruth_meta::mockup::{parse_mockup_generation_output, MOCKUP_GEN_TEMPLATE_VERSION};
use ruth_store::{DbActor, DesignLog, LayoutLog, MockupLog};

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
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
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
    .expect("detail");
    let current = detail
        .versions
        .iter()
        .find(|v| v.id == detail.current_version_id)
        .expect("current");
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
            .expect("create");
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
            .expect("create");
    assert_eq!(detail.versions[0].sources, vec![mockup_version_id(&req, 1)]);
    db.close();
}

#[test]
fn create_with_layout_persists_it() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("disposicion");
    let mut input = create_input(&baby, blank_spec("Con layout"), vec![]);
    input.layout = Some(serde_json::json!({"t1": {"x": 10.0, "y": 20.0}}));
    let detail = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect("create");
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
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("no-sources");
    let req = baby.req.clone();
    let before = baby
        .store
        .versions_of(&ArtifactId::new(req.clone()).expect("id"))
        .len();
    let input_11 = create_input(&baby, reserva_spec(&req), vec![]);
    let err = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_11)
        .expect_err("no sources");
    assert_eq!(err.kind, "mockup_no_sources");
    // Nothing created: the requirement keeps its versions and there are no mockups.
    assert_eq!(
        baby.store
            .versions_of(&ArtifactId::new(req).expect("id"))
            .len(),
        before
    );
    assert!(baby
        .store
        .artifacts_of(
            &ProjectId::new(baby.project.clone()).expect("project"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("module"),
        )
        .iter()
        .all(|a| a.artifact_type() != ruth_core::domain::ArtifactType::Mockup));
    db.close();
}

#[test]
fn stale_source_blocks_by_name_then_current_succeeds() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("obsoleta");
    let req = baby.req.clone();
    // The requirement advances to v2; declaring v1 must block with its name.
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
        .expect_err("stale");
    assert_eq!(err.kind, "mockup_stale_sources");
    assert!(err.message.contains(&req), "{}", err.message);
    // With the current one it does get created.
    let input_9 = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 2)]);
    let detail =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_9)
            .expect("create with v2");
    assert_eq!(detail.versions[0].sources, vec![mockup_version_id(&req, 2)]);
    db.close();
}

#[test]
fn duplicate_source_artifact_rejected() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("duplicate");
    let req = baby.req.clone();
    let v1 = mockup_version_id(&req, 1);
    let input = create_input(&baby, blank_spec("D"), vec![v1.clone(), v1]);
    let err = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect_err("duplicate");
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
            .expect("create");
    let mockup = created.artifact.id.clone();
    // Review v1 and save v2: review is not inherited.
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
    .expect("review");
    let (expected, sources, mut spec) = current_of(&baby, &mockup);
    spec["title"] = serde_json::json!("Nueva reserva (revisada)");
    let input_7 = save_input(&baby, &mockup, &expected, spec, sources);
    let saved =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_7)
            .expect("save");
    assert_eq!(saved.versions.len(), 2);
    let v2 = saved
        .versions
        .iter()
        .find(|v| v.id == saved.current_version_id)
        .expect("v2");
    assert_eq!(v2.provenance.kind, "human");
    assert!(v2.content.contains("revisada"));
    // v1's review is kept but not inherited: v2 is unreviewed.
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
            .expect("create");
    let mockup = created.artifact.id.clone();
    let (_, sources, mut spec) = current_of(&baby, &mockup);
    spec["title"] = serde_json::json!("Cambiado");
    let input_5 = save_input(&baby, &mockup, "mockup-999-v9", spec, sources);
    let err =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_5)
            .expect_err("conflict");
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
    // The requirement stores plain text: only its current version matters.
    let expected = ruth_api::get_requirement(
        &baby.store,
        GetRequirementInput {
            artifact_id: req.clone(),
        },
    )
    .expect("detail")
    .current_version_id;
    let input_4 = save_input(&baby, &req, &expected, blank_spec("X"), vec![]);
    let err =
        ruth_api::save_mockup_version(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_4)
            .expect_err("not a mockup");
    assert_eq!(err.kind, "not_a_mockup");
    db.close();
}

#[test]
fn approve_revalidates_content() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("revisar");
    let input_3 = create_input(&baby, blank_spec("R"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_3)
            .expect("create");
    let mockup = created.artifact.id.clone();
    // Hand-tampered content (valid as text, invalid as a mockup).
    let project = ProjectId::new(baby.project.clone()).expect("project");
    let artifact = ArtifactId::new(mockup.clone()).expect("artifact");
    let expected = VersionId::new(created.current_version_id.clone()).expect("v1");
    let author = Author::Human(HumanId::new("x".to_string()).expect("author"));
    baby.store
        .create_version(
            &project,
            &artifact,
            Some(&expected),
            VersionId::new(mockup_version_id(&mockup, 2)).expect("v2"),
            Content::new("{}".to_string()).expect("content"),
            &author,
            &[],
        )
        .expect("inject");
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
    .expect_err("invalid");
    assert_eq!(err.kind, "mockup_invalid");
    db.close();
}

#[test]
fn mockup_sources_reports_used_vs_current() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("fuentes");
    let req = baby.req.clone();
    let input = create_input(&baby, reserva_spec(&req), vec![mockup_version_id(&req, 1)]);
    let created = ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input)
        .expect("create");
    let mockup = created.artifact.id.clone();
    let sources = ruth_api::mockup_sources(&baby.store, &baby.project, &mockup).expect("sources");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].artifact_id, req);
    assert!(!sources[0].changed);
    // The requirement advances: the source goes stale with both versions.
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
    let sources = ruth_api::mockup_sources(&baby.store, &baby.project, &mockup).expect("sources");
    assert_eq!(sources.len(), 1);
    assert!(sources[0].changed);
    assert_eq!(sources[0].used_version_id, mockup_version_id(&req, 1));
    assert_eq!(sources[0].current_version_id, mockup_version_id(&req, 2));
    // Over a requirement, honest error.
    let err = ruth_api::mockup_sources(&baby.store, &baby.project, &req).expect_err("not a mockup");
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
        ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput { spec }).expect("valid");
    assert!(dto.canonical.contains("\"kind\":\"mockup\""));
    assert_eq!(dto.title, "Nueva reserva");
    assert_eq!(dto.screens, 1);
    assert_eq!(dto.components, 2);
    let bad = serde_json::json!({"title": "Roto", "screens": []});
    // Empty counts; what does not count is a foreign shape.
    let dto = ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput { spec: bad })
        .expect("blank canvas");
    assert_eq!(dto.screens, 0);
    let err = ruth_api::validate_mockup_stored(ruth_api::ValidateMockupInput {
        spec: serde_json::json!({"title": "Sin pantallas"}),
    })
    .expect_err("no screens");
    assert!(!err.kind.is_empty());
}

#[test]
fn snapshot_accepts_mixed_and_mockup_only() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("context");
    let req = baby.req.clone();
    let input_2 = create_input(&baby, blank_spec("M"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_2)
            .expect("create");
    let mockup = created.artifact.id.clone();
    let mixed = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
        std::slice::from_ref(&mockup),
    )
    .expect("mixed");
    assert_eq!(mixed.requirements.len(), 1);
    assert_eq!(mixed.mockups.len(), 1);
    assert_eq!(mixed.requirements[0].version_id, mockup_version_id(&req, 1));
    assert_eq!(mixed.mockups[0].version_id, mockup_version_id(&mockup, 1));
    // Mockup only, no requirements: allowed (the template asks to flag it).
    let alone = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &[],
        std::slice::from_ref(&mockup),
    )
    .expect("mockup only");
    assert!(alone.requirements.is_empty());
    assert_eq!(alone.mockups.len(), 1);
    // Empty and duplicate are rejected before consuming network.
    let err = ruth_api::snapshot_mockup_context(&baby.store, &baby.project, &baby.module, &[], &[])
        .expect_err("empty");
    assert_eq!(err.kind, "empty_selection");
    let err = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        &[],
        &[mockup.clone(), mockup],
    )
    .expect_err("duplicate");
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
    .expect_err("requirement as mockup");
    assert_eq!(err.kind, "not_a_requirement");
    let _ = layouts;
    db.close();
}

#[test]
fn context_preview_lists_requirements_designs_and_mockups() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("vista");
    let input_1 = create_input(&baby, blank_spec("M"), vec![]);
    ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_1)
        .expect("create");
    // A hand-made flow (the view validates no contents, only lists them).
    let project = ProjectId::new(baby.project.clone()).expect("project");
    let module = ruth_core::domain::ModuleId::new(baby.module.clone()).expect("module");
    let flow = baby.ids.flow();
    baby.store
        .create_artifact(
            &project,
            &module,
            flow.clone(),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flow");
    baby.store
        .create_version(
            &project,
            &flow,
            None,
            ruth_api::IdGen::version(&flow, 1),
            Content::new("{}".to_string()).expect("content"),
            &Author::Human(HumanId::new("ana".to_string()).expect("author")),
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
    .expect("view");
    assert_eq!(preview.requirements.len(), 1);
    assert_eq!(preview.designs.len(), 1);
    assert_eq!(preview.mockups.len(), 1);
    assert!(preview.mockups[0].excerpt.contains("Mockup: M"));
    db.close();
}

/// Fake generator: truly validated flow, no network.
fn fake_flow(req: &str) -> ValidatedDesign {
    let text = serde_json::json!({
        "title": "Flujo de venta",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": [req]},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [{"from": "inicio", "to": "fin"}],
        "explanation": "Minimal flow.",
        "questions": []
    })
    .to_string();
    parse_design_output(&text, DesignKind::Flow, &[req.to_string()]).expect("valid")
}

#[test]
fn record_with_mockup_context_uses_mockup_template() {
    let (_tmp, mut baby, db, mut layouts) = mockup_baby("template");
    let req = baby.req.clone();
    let input_0 = create_input(&baby, blank_spec("M"), vec![]);
    let created =
        ruth_api::create_mockup(&mut baby.store, &mut baby.ids, &mut layouts, &db, input_0)
            .expect("create");
    let mockup = created.artifact.id.clone();
    let mut log = DesignLog::new();
    // From mockup (+ requirement): mockups template.
    let snapshot = ruth_api::snapshot_mockup_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
        std::slice::from_ref(&mockup),
    )
    .expect("context");
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
    .expect("record");
    assert_eq!(dto.template_version, DESIGN_MOCKUP_TEMPLATE_VERSION);
    // Requirements only: classic template (no regression).
    let context = ruth_api::snapshot_design_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&req),
    )
    .expect("req context");
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
    .expect("record");
    assert_eq!(dto.template_version, DESIGN_TEMPLATE_VERSION);
    db.close();
}

// ---------------------------------------------------------------------------
// Screen proposals ("Propose screens"), no network
// ---------------------------------------------------------------------------

fn screens_baby(name: &str) -> (TempDb, Baby, DbActor, MockupLog) {
    let tmp = TempDb::new(name);
    let baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    (tmp, baby, db, MockupLog::new())
}

fn screens_output(req: &str) -> String {
    serde_json::json!({
        "screens": [
            {"temp_id": "p1", "title": "Registro",
             "spec": {"id": "registro", "title": "Registro",
                      "requirements": [req],
                      "components": [
                          {"id": "f_name", "kind": "field", "label": "Name",
                           "field_type": "text", "required": true,
                           "origin": "persisted", "requirements": [req]},
                          {"id": "b_ok", "kind": "button", "label": "Create",
                           "action_kind": "submit"}
                      ]},
             "explanation": "Minimal signup form."},
            {"temp_id": "p2", "title": "List",
             "spec": {"id": "list", "title": "List",
                      "requirements": [req],
                      "components": [
                          {"id": "tb", "kind": "table", "label": "Records",
                           "columns": ["name"], "origin": "persisted",
                           "requirements": [req]}
                      ]},
             "explanation": "Records table."}
        ],
        "questions": ["Is email required?"]
    })
    .to_string()
}

fn record_screens(
    baby: &mut Baby,
    log: &mut MockupLog,
    db: &DbActor,
    selected: &[String],
) -> ruth_api::MockupGenerationDto {
    let context =
        ruth_api::snapshot_screen_context(&baby.store, &baby.project, &baby.module, selected)
            .expect("context");
    let validated = parse_mockup_generation_output(&screens_output(&baby.req), &[baby.req.clone()])
        .expect("valid output");
    ruth_api::record_mockup_generation(
        &baby.store,
        &mut baby.ids,
        log,
        db,
        RecordMockupInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            model: "muse-spark".to_string(),
            context,
            validated,
            input_tokens: Some(100),
            output_tokens: Some(200),
            total_tokens: Some(300),
            created_at: "2026-10-28T12:00:00Z".to_string(),
        },
    )
    .expect("record")
}

#[test]
fn screen_context_accepts_selection_or_whole_module_unapproved() {
    let (_tmp, baby, db, _log) = screens_baby("context");
    // Explicit selection (unapproved: no barrier).
    let one = ruth_api::snapshot_screen_context(
        &baby.store,
        &baby.project,
        &baby.module,
        std::slice::from_ref(&baby.req),
    )
    .expect("selection");
    assert_eq!(one.len(), 1);
    assert_eq!(one[0].version_id, format!("{}-v1", baby.req));
    // Empty = the whole module.
    let all = ruth_api::snapshot_screen_context(&baby.store, &baby.project, &baby.module, &[])
        .expect("module");
    assert_eq!(all.len(), 1);
    db.close();
}

#[test]
fn record_and_list_screens_roundtrip_with_reopen() {
    let (tmp, mut baby, db, mut log) = screens_baby("registro");
    let req = baby.req.clone();
    let dto = record_screens(&mut baby, &mut log, &db, std::slice::from_ref(&req));
    assert_eq!(dto.template_version, MOCKUP_GEN_TEMPLATE_VERSION);
    assert!(!dto.stale);
    assert_eq!(dto.proposals.len(), 2);
    assert_eq!(dto.context_version_ids, vec![format!("{req}-v1")]);
    assert_eq!(dto.questions.len(), 1);
    let listed = ruth_api::list_mockup_generations(
        &baby.store,
        &log,
        ListMockupGenerationsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, dto.id);
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let again = loaded.mockups.generation(&dto.id).expect("generation");
    assert_eq!(again.proposals.len(), 2);
    assert!(again.proposals[0].spec_json.contains("\"kind\":\"mockup\""));
    assert_eq!(again.questions.len(), 1);
    db2.close();
}

#[test]
fn accept_screen_creates_unapproved_mockup_with_exact_sources() {
    let (_tmp, mut baby, db, mut log) = screens_baby("accept");
    let req = baby.req.clone();
    let dto = record_screens(&mut baby, &mut log, &db, std::slice::from_ref(&req));
    let detail = ruth_api::accept_mockup_screen(
        &mut baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        AcceptMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .expect("accept");
    assert_eq!(detail.artifact.kind, "mockup");
    assert!(detail.artifact.id.starts_with("mockup-"));
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.versions[0].provenance.kind, "ai");
    assert!(detail.approvals.is_empty());
    assert_eq!(detail.versions[0].sources, vec![format!("{req}-v1")]);
    assert!(detail.versions[0].content.contains("\"id\":\"registro\""));
    // The other screen stays pending and is incorporated separately.
    let listed = ruth_api::list_mockup_generations(
        &baby.store,
        &log,
        ListMockupGenerationsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("list");
    assert_eq!(listed[0].proposals[0].state, "accepted");
    assert_eq!(listed[0].proposals[1].state, "pending");
    db.close();
}

#[test]
fn accept_screen_is_idempotent_and_discard_is_final() {
    let (_tmp, mut baby, db, mut log) = screens_baby("idempotencia");
    let req = baby.req.clone();
    let dto = record_screens(&mut baby, &mut log, &db, std::slice::from_ref(&req));
    let first = ruth_api::accept_mockup_screen(
        &mut baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        AcceptMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .expect("accept");
    let second = ruth_api::accept_mockup_screen(
        &mut baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        AcceptMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .expect("retry");
    assert_eq!(first.artifact.id, second.artifact.id);
    assert_eq!(second.versions.len(), 1);
    // Discarding the accepted is rejected; discarding the pending is final.
    assert!(ruth_api::discard_mockup_screen(
        &mut log,
        &db,
        DiscardMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .is_err());
    ruth_api::discard_mockup_screen(
        &mut log,
        &db,
        DiscardMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p2".to_string(),
        },
    )
    .expect("discard");
    assert!(ruth_api::accept_mockup_screen(
        &mut baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        AcceptMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p2".to_string(),
        },
    )
    .is_err());
    db.close();
}

#[test]
fn stale_generation_blocks_accept_until_regenerated() {
    let (_tmp, mut baby, db, mut log) = screens_baby("caducidad");
    let req = baby.req.clone();
    let dto = record_screens(&mut baby, &mut log, &db, std::slice::from_ref(&req));
    // The requirement advances: the generation goes stale.
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: req.clone(),
            expected_version_id: format!("{req}-v1"),
            author: "ana".to_string(),
            content: "Confirmar una venta descuenta stock y avisa.".to_string(),
        },
    )
    .expect("v2");
    let listed = ruth_api::list_mockup_generations(
        &baby.store,
        &log,
        ListMockupGenerationsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("list");
    assert!(listed[0].stale);
    let err = ruth_api::accept_mockup_screen(
        &mut baby.store,
        &mut baby.ids,
        &mut log,
        &db,
        AcceptMockupScreenInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .expect_err("blocked as stale");
    assert_eq!(err.kind, "mockup_generation_stale");
    db.close();
}
