//! Code generations without network or database: versioned context,
//! recording, computed staleness and acceptance validation.

use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{AcceptCheck, IdGen, RecordCodeGenInput, ScopeFileInput};
use ruth_code::{CodeRoot, CodeWorkspace};
use ruth_core::application::Store;
use ruth_meta::code::{
    CodeOperation, ValidatedCode, ValidatedCodeFile, MOCKUP_CODE_TEMPLATE_VERSION,
};
use ruth_store::{CodeFileState, CodeGenLog};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn scratch(name: &str) -> std::path::PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir =
        std::env::temp_dir().join(format!("ruth-codegen-{}-{}-{n}", std::process::id(), name));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("scratch");
    std::fs::write(dir.join("src").join("a.ts"), "const a = 1;\n").expect("fixture");
    dir
}

struct Baby {
    store: Store,
    ids: IdGen,
    roots: CodeWorkspace,
    project: String,
    module: String,
    req: String,
    dir: std::path::PathBuf,
}

fn baby() -> Baby {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("project")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        ruth_api::CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let req = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        ruth_api::CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Descontar stock al confirmar.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement")
    .artifact
    .id;
    let dir = scratch("baby");
    let roots = CodeWorkspace::from_roots(vec![CodeRoot {
        id: "root-1".to_string(),
        path: dir.display().to_string(),
        name: "baby".to_string(),
        project_id: Some(project.clone()),
    }]);
    Baby {
        store,
        ids,
        roots,
        project,
        module,
        req,
        dir,
    }
}

fn scope_one() -> Vec<ScopeFileInput> {
    vec![ScopeFileInput {
        root_id: "root-1".to_string(),
        rel: "src/a.ts".to_string(),
    }]
}

fn proposal(files: Vec<ValidatedCodeFile>) -> ValidatedCode {
    ValidatedCode {
        files,
        explanation: "E".to_string(),
        assumptions: vec![],
        questions: vec![],
    }
}

fn modify(rel: &str, content: &str) -> ValidatedCodeFile {
    ValidatedCodeFile {
        root_id: "root-1".to_string(),
        rel: rel.to_string(),
        operation: CodeOperation::Modify,
        content: content.to_string(),
    }
}

fn create(rel: &str, content: &str) -> ValidatedCodeFile {
    ValidatedCodeFile {
        root_id: "root-1".to_string(),
        rel: rel.to_string(),
        operation: CodeOperation::Create,
        content: content.to_string(),
    }
}

#[test]
fn context_freezes_requirement_and_read_scope() {
    let baby = baby();
    let context = ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &scope_one(),
    )
    .expect("context");
    assert_eq!(context.artifact_id, baby.req);
    assert!(context.version_id.contains(&baby.req));
    assert_eq!(context.files.len(), 1);
    assert_eq!(context.files[0].content, "const a = 1;\n");
    assert!(!context.files[0].fingerprint.is_empty());
    // Empty or repeated scope: error before consuming network.
    assert!(ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &[],
    )
    .is_err());
    let dup = vec![scope_one()[0].clone(), scope_one()[0].clone()];
    assert!(ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &dup,
    )
    .is_err());
    // Illegible file or foreign root: honest error.
    let missing = vec![ScopeFileInput {
        root_id: "root-1".to_string(),
        rel: "src/nope.ts".to_string(),
    }];
    assert!(ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &missing,
    )
    .is_err());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn registro_exige_raices_autorizadas_y_huellas() {
    let mut baby = baby();
    let context = ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &scope_one(),
    )
    .expect("context");
    let expected = context.files[0].fingerprint.clone();
    let stored = ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![
                modify("src/a.ts", "const a = 2;\n"),
                create("src/b.ts", "export {};\n"),
            ]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .expect("record");
    assert!(stored.id.starts_with("cgen-"));
    assert_eq!(stored.files.len(), 2);
    assert_eq!(
        stored.files[0].expected_fingerprint.as_deref(),
        Some(expected.as_str())
    );
    assert_eq!(stored.files[1].expected_fingerprint, None);
    assert!(stored
        .files
        .iter()
        .all(|f| f.state == CodeFileState::Pending));
    // Root outside the workspace: rejected even when coming from the model.
    let context = ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &scope_one(),
    )
    .expect("context");
    let mut abroad = modify("src/a.ts", "x");
    abroad.root_id = "root-9".to_string();
    assert!(ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![abroad]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .is_err());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn accept_validates_state_requirement_scope_and_target() {
    let mut baby = baby();
    let context = ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &scope_one(),
    )
    .expect("context");
    let stored = ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![
                modify("src/a.ts", "const a = 2;\n"),
                create("src/b.ts", "export {};\n"),
            ]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .expect("record");
    let gid = stored.id.clone();
    let mut log = CodeGenLog::new();
    log.record(stored).expect("memory");
    // Just generated: both files ready.
    let check = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect("ready");
    assert!(matches!(check, AcceptCheck::Ready(_)));
    let check = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 1).expect("ready");
    assert!(matches!(check, AcceptCheck::Ready(_)));
    // The `create` destination shows up: honest conflict.
    std::fs::write(baby.dir.join("src").join("b.ts"), "ajeno\n").expect("foreign");
    let err = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 1).expect_err("exists");
    assert_eq!(err.kind, "code_conflict");
    // The scope changes (different size: surely a different fingerprint):
    // everything blocks until regenerating.
    std::fs::write(baby.dir.join("src").join("a.ts"), "const a = 100;\n").expect("change");
    let err = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect_err("scope");
    assert_eq!(err.kind, "stale_scope");
    let freshness =
        ruth_api::generation_freshness(&baby.store, &baby.roots, log.get(&gid).expect("g"));
    assert!(freshness.stale());
    assert_eq!(freshness.changed_scope.len(), 1);
    assert_eq!(freshness.changed_scope[0].reason, "changed");
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn moved_or_deleted_requirement_blocks_and_reports() {
    let mut baby = baby();
    // Requirement with a second version BEFORE generating: the proposal
    // stays anchored to v1 by recording it by hand.
    let context = ruth_api::snapshot_code_context(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &baby.req,
        &scope_one(),
    )
    .expect("context");
    let stored = ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![modify("src/a.ts", "const a = 2;\n")]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .expect("record");
    let gid = stored.id.clone();
    let mut log = CodeGenLog::new();
    log.record(stored).expect("memory");
    // New version of the requirement: accepting blocks.
    let expected = baby
        .store
        .current_version(&ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id"))
        .expect("current")
        .id()
        .as_str()
        .to_string();
    ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: expected,
            content: "Descontar stock al reservar.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let err = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect_err("moved");
    assert_eq!(err.kind, "stale_requirement");
    let _ = std::fs::remove_dir_all(&baby.dir);
}

fn screen_spec(reqs: &[&str], title: &str) -> String {
    serde_json::json!({
        "title": title,
        "kind": "mockup",
        "screens": [{
            "id": "registro",
            "title": "Registro de usuario",
            "requirements": reqs,
            "designs": [],
            "components": [
                {"id": "f_nombre", "kind": "field", "label": "Nombre",
                 "field_type": "text", "required": true, "origin": "persisted",
                 "requirements": reqs, "designs": []}
            ]
        }]
    })
    .to_string()
}

fn add_mockup(baby: &mut Baby, spec: &str) -> String {
    let project = ruth_core::domain::ProjectId::new(baby.project.clone()).expect("project");
    let module = ruth_core::domain::ModuleId::new(baby.module.clone()).expect("module");
    let artifact = baby.ids.mockup();
    baby.store
        .create_artifact(
            &project,
            &module,
            artifact.clone(),
            ruth_core::domain::ArtifactType::Mockup,
        )
        .expect("mockup");
    let version = IdGen::version(&artifact, 1);
    let author =
        ruth_core::domain::Author::Human(ruth_core::domain::HumanId::new("ana").expect("author"));
    baby.store
        .create_version(
            &project,
            &artifact,
            None,
            version,
            ruth_core::domain::Content::new(spec.to_string()).expect("content"),
            &author,
            &[],
        )
        .expect("v1");
    artifact.as_str().to_string()
}

fn record_screen(baby: &mut Baby, mockup: &str) -> (String, CodeGenLog) {
    let context = ruth_api::snapshot_code_context_from_screen(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        mockup,
        "registro",
        &scope_one(),
    )
    .expect("context");
    let stored = ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![modify("src/a.ts", "const a = 2;\n")]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .expect("record");
    let gid = stored.id.clone();
    let mut log = CodeGenLog::new();
    log.record(stored).expect("memory");
    (gid, log)
}

#[test]
fn screen_freezes_version_sources_and_scope() {
    let mut baby = baby();
    let req = baby.req.clone();
    let mockup = add_mockup(&mut baby, &screen_spec(&[req.as_str()], "Registro"));
    let context = ruth_api::snapshot_code_context_from_screen(
        &baby.store,
        &baby.roots,
        &baby.project,
        &baby.module,
        &mockup,
        "registro",
        &scope_one(),
    )
    .expect("context");
    let screen = context.screen.as_ref().expect("screen");
    assert_eq!(screen.mockup_artifact_id, mockup);
    assert_eq!(screen.screen_id, "registro");
    assert_eq!(screen.screen_title, "Registro de usuario");
    assert!(
        screen.screen_text.contains("Nombre"),
        "{}",
        screen.screen_text
    );
    assert_eq!(screen.sources.len(), 1);
    assert_eq!(screen.sources[0].artifact_id, req);
    assert!(context.requirement_content.is_empty());
    assert_eq!(context.files.len(), 1);
    let meta_screen = ruth_api::context_screen(&context).expect("meta");
    assert_eq!(meta_screen.screen_id, "registro");
    assert_eq!(meta_screen.requirements.len(), 1);
    assert_eq!(meta_screen.requirements[0].artifact_id, req);
    let stored = ruth_api::build_stored_codegen(
        &baby.roots,
        &mut baby.ids,
        RecordCodeGenInput {
            context,
            code: proposal(vec![modify("src/a.ts", "const a = 2;\n")]),
            model: "m".to_string(),
            usage: None,
            created_at: "t".to_string(),
        },
    )
    .expect("record");
    assert!(stored.is_screen_sourced());
    assert_eq!(stored.template_version, MOCKUP_CODE_TEMPLATE_VERSION);
    assert_eq!(stored.screen_artifact_id, mockup);
    assert_eq!(stored.screen_sources.len(), 1);
    assert!(stored.requirement_artifact_id.is_empty());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn missing_corrupt_screen_or_lost_source_blocks() {
    let mut baby = baby();
    let req = baby.req.clone();
    let mockup = add_mockup(&mut baby, &screen_spec(&[req.as_str()], "Registro"));
    let snap = |baby: &Baby, mockup: &str, screen: &str| {
        ruth_api::snapshot_code_context_from_screen(
            &baby.store,
            &baby.roots,
            &baby.project,
            &baby.module,
            mockup,
            screen,
            &scope_one(),
        )
    };
    let err = snap(&baby, &mockup, "other").expect_err("screen");
    assert_eq!(err.kind, "screen_not_found");
    let err = snap(&baby, &req, "registro").expect_err("kind");
    assert_eq!(err.kind, "not_a_mockup");
    let roto = add_mockup(&mut baby, "no es json");
    let err = snap(&baby, &roto, "registro").expect_err("corrupt");
    assert_eq!(err.kind, "mockup_invalid");
    let orphan = add_mockup(&mut baby, &screen_spec(&["req-ghost"], "Orphan"));
    let err = snap(&baby, &orphan, "registro").expect_err("source");
    assert_eq!(err.kind, "screen_source_missing");
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn moved_screen_blocks_accept() {
    let mut baby = baby();
    let req = baby.req.clone();
    let mockup = add_mockup(&mut baby, &screen_spec(&[req.as_str()], "Registro"));
    let (gid, log) = record_screen(&mut baby, &mockup);
    let check = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect("list");
    assert!(matches!(check, AcceptCheck::Ready(_)));
    // New version of the mockup: the screen moved.
    let expected = baby
        .store
        .current_version(&ruth_core::domain::ArtifactId::new(mockup.clone()).expect("id"))
        .expect("current")
        .id()
        .as_str()
        .to_string();
    ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: mockup.clone(),
            expected_version_id: expected,
            content: screen_spec(&[req.as_str()], "Registro v2"),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let err = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect_err("moved");
    assert_eq!(err.kind, "stale_screen");
    let freshness =
        ruth_api::generation_freshness(&baby.store, &baby.roots, log.get(&gid).expect("g"));
    assert!(freshness.stale());
    assert!(freshness.screen_moved);
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn moved_screen_source_blocks_accept() {
    let mut baby = baby();
    let req = baby.req.clone();
    let mockup = add_mockup(&mut baby, &screen_spec(&[req.as_str()], "Registro"));
    let (gid, log) = record_screen(&mut baby, &mockup);
    // New version of the source requirement: the source moved.
    let expected = baby
        .store
        .current_version(&ruth_core::domain::ArtifactId::new(req.clone()).expect("id"))
        .expect("current")
        .id()
        .as_str()
        .to_string();
    ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: req.clone(),
            expected_version_id: expected,
            content: "Pedir nombre y correo.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let err = ruth_api::check_accept(&baby.store, &baby.roots, &log, &gid, 0).expect_err("source");
    assert_eq!(err.kind, "stale_screen_source");
    let freshness =
        ruth_api::generation_freshness(&baby.store, &baby.roots, log.get(&gid).expect("g"));
    assert!(freshness.stale());
    assert!(!freshness.screen_moved);
    assert_eq!(freshness.changed_sources.len(), 1);
    assert_eq!(freshness.changed_sources[0].artifact_id, req);
    assert_eq!(freshness.changed_sources[0].reason, "changed");
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn lists_only_proposable_mockups_with_their_screens() {
    let mut baby = baby();
    let req = baby.req.clone();
    let mockup = add_mockup(&mut baby, &screen_spec(&[req.as_str()], "Registro"));
    add_mockup(&mut baby, "no es json");
    add_mockup(
        &mut baby,
        &serde_json::json!({"title": "Empty", "kind": "mockup", "screens": []}).to_string(),
    );
    let listed =
        ruth_api::list_mockup_screens(&baby.store, &baby.project, &baby.module).expect("list");
    // Only the valid one with screens: neither the requirement, nor the
    // corrupt one, nor the blank canvas.
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].artifact_id, mockup);
    assert_eq!(listed[0].title, "Registro");
    assert_eq!(listed[0].screens.len(), 1);
    assert_eq!(listed[0].screens[0].id, "registro");
    assert_eq!(listed[0].screens[0].title, "Registro de usuario");
    let _ = std::fs::remove_dir_all(&baby.dir);
}
