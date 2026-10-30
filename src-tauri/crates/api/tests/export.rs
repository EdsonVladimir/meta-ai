//! Reproducible export: full package from the baseline, deterministic
//! ZIP and verifiable hashes. No network: core, API and temp SQLite.

use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, BaselineCreateInput, BaselineEntryInput, BaselinePrepareInput,
    CreateRequirementInput, IdGen,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, HumanId, ModuleId, ProjectId, VersionId,
};
use ruth_store::{BaselineMetaLog, DbActor};
use sha2::{Digest, Sha256};

static COUNTER: AtomicU64 = AtomicU64::new(1000);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-export-{}-{}-{}.db",
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
    metalog: BaselineMetaLog,
    project: ProjectId,
    module: ModuleId,
    req: ArtifactId,
    req_v1: VersionId,
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
            ruth_api::CreateModuleInput {
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
    let req_v1 = IdGen::version(&req, 1);
    Baby {
        store,
        ids,
        metalog: BaselineMetaLog::new(),
        project,
        module,
        req,
        req_v1,
    }
}

fn author() -> Author {
    Author::Human(HumanId::new("ana").expect("author"))
}

fn save_version(
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
            Content::new(content).expect("content"),
            &author(),
            sources,
        )
        .expect("version");
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
        .expect("artifact");
    save_version(baby, &id, 1, content, sources);
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
    .expect("approve");
}

fn flow_json(req_id: &str) -> String {
    serde_json::json!({
        "title": "Flujo de venta",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": [req_id]},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [{"from": "inicio", "to": "fin"}],
        "explanation": "Confirma y descuenta.",
        "questions": []
    })
    .to_string()
}

fn er_json(req_id: &str) -> String {
    serde_json::json!({
        "title": "Modelo de ventas",
        "entities": [
            {"name": "Venta", "attributes": [{"name": "id", "key": true}], "requirements": [req_id]}
        ],
        "relations": [],
        "explanation": "A sale groups lines.",
        "questions": ["Does the reservation lock available stock?"]
    })
    .to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write as _;
        write!(out, "{byte:02x}").expect("hex");
    }
    out
}

/// Sales ready: approved requirement, flow and ER; baseline created and
/// persisted in the temp database (still open in `db`).
fn sales_baseline(baby: &mut Baby, db: &DbActor) -> String {
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(baby, &req, &req_v1);
    let flow = design(
        baby,
        ArtifactType::Flow,
        &flow_json(req.as_str()),
        std::slice::from_ref(&req_v1),
    );
    let flow_v1 = IdGen::version(&flow, 1);
    approve(baby, &flow.clone(), &flow_v1);
    let model = design(
        baby,
        ArtifactType::DataModel,
        &er_json(req.as_str()),
        std::slice::from_ref(&req_v1),
    );
    let model_v1 = IdGen::version(&model, 1);
    approve(baby, &model.clone(), &model_v1);
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string(), model.as_str().to_string()],
        },
    )
    .expect("prepare");
    assert!(preview.can_create);
    let entries = preview
        .entries
        .iter()
        .map(|e| BaselineEntryInput {
            artifact_id: e.artifact.id.clone(),
            version_id: e.version_id.clone(),
        })
        .collect();
    ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Sales delivery".to_string(),
            description: Some("First delivery".to_string()),
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries,
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("create")
    .id
}

fn file<'a>(files: &'a [ruth_api::ExportFile], path: &str) -> &'a ruth_api::ExportFile {
    files.iter().find(|f| f.path == path).expect(path)
}

fn text(files: &[ruth_api::ExportFile], path: &str) -> String {
    String::from_utf8(file(files, path).bytes.clone()).expect("utf8")
}

fn is_safe_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
        && path
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '-' | '_'))
}

#[test]
fn export_builds_complete_package() {
    let tmp = TempDb::new("package");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let before = format!("{:?}", baby.store);
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("package");
    // Pure query: the domain does not change.
    assert_eq!(format!("{:?}", baby.store), before);
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted, "orden estable de archivos");
    for fixed in [
        "README.md",
        "specification.md",
        "manifest.json",
        "implementation-context.md",
    ] {
        assert!(paths.contains(&fixed), "{fixed}");
    }
    assert_eq!(
        paths.iter().filter(|p| p.starts_with("artifacts/")).count(),
        3
    );
    assert_eq!(
        paths.iter().filter(|p| p.starts_with("diagrams/")).count(),
        2
    );
    assert!(paths.iter().all(|p| is_safe_path(p)));
    // Exact original content.
    let req_file = paths
        .iter()
        .find(|p| p.starts_with("artifacts/requirement-"))
        .expect("requirement");
    assert_eq!(
        text(&files, req_file),
        "Confirmar una venta descuenta stock."
    );
    // Diagrams derived from the existing serializer.
    let flow_mmd = text(
        &files,
        paths
            .iter()
            .find(|p| p.starts_with("diagrams/flow-"))
            .expect("flow diagram"),
    );
    assert!(flow_mmd.starts_with("flowchart TD"), "{flow_mmd}");
    assert!(flow_mmd.contains("Venta creada"), "{flow_mmd}");
    let er_mmd = text(
        &files,
        paths
            .iter()
            .find(|p| p.starts_with("diagrams/data_model-"))
            .expect("ER diagram"),
    );
    assert!(er_mmd.starts_with("erDiagram"), "{er_mmd}");
    // Coherent documents.
    let readme = text(&files, "README.md");
    assert!(readme.contains(&baseline));
    assert!(readme.contains("are not a digital signature"));
    let spec = text(&files, "specification.md");
    assert!(spec.contains("Confirmar una venta descuenta stock."));
    assert!(spec.contains("Flujo de venta"));
    assert!(spec.contains("ana"));
    let context = text(&files, "implementation-context.md");
    assert!(context.contains("Does the reservation lock available stock?"));
    assert!(context.contains("Do not invent stack"));
    // Versioned, verifiable manifest.
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    assert_eq!(manifest["format"], "ruth-baseline-export");
    assert_eq!(manifest["format_version"], 1);
    assert_eq!(manifest["baseline"]["id"], baseline);
    assert_eq!(manifest["baseline"]["name"], "Sales delivery");
    assert_eq!(manifest["entries"].as_array().expect("entries").len(), 3);
    let listed = manifest["files"].as_array().expect("files");
    assert_eq!(listed.len(), files.len() - 1, "el manifiesto se excluye");
    assert!(!listed.iter().any(|f| f["path"] == "manifest.json"));
    for entry in listed {
        let path = entry["path"].as_str().expect("ruta");
        let bytes = &file(&files, path).bytes;
        assert_eq!(entry["sha256"], sha256_hex(bytes), "{path}");
        assert_eq!(entry["bytes"], bytes.len() as u64);
    }
    for entry in manifest["entries"].as_array().expect("entries") {
        if entry["kind"] == "requirement" {
            assert_eq!(entry["diagram_file"], serde_json::Value::Null);
            assert_eq!(entry["diagram_ok"], false);
        } else {
            assert!(entry["diagram_file"].is_string());
            assert_eq!(entry["diagram_ok"], true);
        }
    }
    db.close();
}

#[test]
fn export_zip_is_deterministic_and_readable() {
    let tmp = TempDb::new("zip");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let project = baby.project.as_str().to_string();
    let first = ruth_api::build_export_files(&baby.store, &baby.metalog, &project, &baseline)
        .expect("package");
    let second = ruth_api::build_export_files(&baby.store, &baby.metalog, &project, &baseline)
        .expect("package");
    assert_eq!(first, second);
    let zip_a = ruth_api::package_to_zip(&first).expect("zip");
    let zip_b = ruth_api::package_to_zip(&second).expect("zip");
    assert_eq!(zip_a, zip_b, "same package, same bytes");
    assert_eq!(ruth_api::zip_sha256(&zip_a), sha256_hex(&zip_a));
    // The ZIP opens with a standard reader and brings everything.
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&zip_a)).expect("open zip");
    assert_eq!(archive.len(), first.len());
    for expected in &first {
        let mut entry = archive.by_name(&expected.path).expect(&expected.path);
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("read");
        assert_eq!(bytes, expected.bytes, "{}", expected.path);
    }
    db.close();
}

#[test]
fn export_ignores_current_state() {
    let tmp = TempDb::new("historic");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    // The project advances after the baseline.
    let req_v1 = baby.req_v1.clone();
    ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Reservar antes de confirmar.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("package");
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let req_file = paths
        .iter()
        .find(|p| p.starts_with("artifacts/requirement-"))
        .expect("requirement");
    assert_eq!(
        text(&files, req_file),
        "Confirmar una venta descuenta stock.",
        "la baseline conserva la v1"
    );
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let req_entry = manifest["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .find(|e| e["kind"] == "requirement")
        .expect("entry");
    assert_eq!(req_entry["version"], baby.req_v1.as_str());
    db.close();
}

#[test]
fn export_rejects_unknown_baseline() {
    let tmp = TempDb::new("unknown");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let err = ruth_api::build_export_files(
        &baby.store,
        &baby.metalog,
        baby.project.as_str(),
        "base-404",
    )
    .expect_err("missing");
    assert_eq!(err.kind, "baseline_not_found");
    // From another project: never exports even when the baseline exists.
    let err = ruth_api::build_export_files(&baby.store, &baby.metalog, "proj-ajeno", &baseline)
        .expect_err("foreign");
    assert_eq!(err.kind, "baseline_not_found");
    db.close();
}

#[test]
fn export_neutralizes_malicious_titles_and_ids() {
    let tmp = TempDb::new("malicious");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let evil_title = "../../etc/evil\n<script>alert(1)</script>";
    let flow_content = serde_json::json!({
        "title": evil_title,
        "nodes": [
            {"id": "a", "kind": "step", "label": "../..\\x", "requirements": []}
        ],
        "edges": [],
        "explanation": "X",
        "questions": []
    })
    .to_string();
    let evil_id = ArtifactId::new("flow-../../x").expect("id");
    baby.store
        .create_artifact(
            &baby.project,
            &baby.module,
            evil_id.clone(),
            ArtifactType::Flow,
        )
        .expect("artifact");
    save_version(
        &mut baby,
        &evil_id,
        1,
        &flow_content,
        std::slice::from_ref(&req_v1),
    );
    let flow = evil_id;
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1);
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("prepare");
    assert!(preview.can_create);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Evil".to_string(),
            description: None,
            scope_module_id: None,
            entries: preview
                .entries
                .iter()
                .map(|e| BaselineEntryInput {
                    artifact_id: e.artifact.id.clone(),
                    version_id: e.version_id.clone(),
                })
                .collect(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("package");
    for f in &files {
        assert!(is_safe_path(&f.path), "unsafe path: {}", f.path);
        assert!(!f.path.contains(".."), "escape: {}", f.path);
    }
    // Free titles never reach file names.
    assert!(
        !files
            .iter()
            .any(|f| f.path.contains("etc") || f.path.contains("evil")),
        "title filtered to paths"
    );
    // The ZIP inherits the safe paths.
    let zip = ruth_api::package_to_zip(&files).expect("zip");
    let archive = zip::ZipArchive::new(std::io::Cursor::new(&zip)).expect("open");
    for name in archive.file_names() {
        assert!(is_safe_path(name), "ruta insegura en zip: {name}");
    }
    db.close();
}

#[test]
fn export_marks_unstructured_designs_without_inventing() {
    let tmp = TempDb::new("unstructured");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    // Legacy content: free text in a design artifact.
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        "Old draft without JSON.",
        std::slice::from_ref(&req_v1),
    );
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1);
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("prepare");
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Legacy".to_string(),
            description: None,
            scope_module_id: None,
            entries: preview
                .entries
                .iter()
                .map(|e| BaselineEntryInput {
                    artifact_id: e.artifact.id.clone(),
                    version_id: e.version_id.clone(),
                })
                .collect(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("package");
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let diagram = paths
        .iter()
        .find(|p| p.starts_with("diagrams/"))
        .expect("diagram");
    let body = text(&files, diagram);
    assert!(body.starts_with("%%"), "{body}");
    assert!(body.contains("artifacts/"), "{body}");
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let flow_entry = manifest["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .find(|e| e["kind"] == "flow")
        .expect("flow");
    assert_eq!(flow_entry["diagram_ok"], false);
    let spec = text(&files, "specification.md");
    assert!(spec.contains("Unstructured content"));
    db.close();
}

#[test]
fn export_preview_matches_package() {
    let tmp = TempDb::new("preview");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let preview =
        ruth_api::export_preview(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("preview");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("package");
    assert_eq!(preview.baseline_id, baseline);
    assert_eq!(preview.exporter_version, ruth_api::EXPORTER_VERSION);
    assert_eq!(preview.files.len(), files.len());
    for (dto, file) in preview.files.iter().zip(files.iter()) {
        assert_eq!(dto.path, file.path);
        assert_eq!(dto.bytes, file.bytes.len() as u64);
        assert_eq!(dto.sha256, sha256_hex(&file.bytes));
    }
    assert_eq!(
        preview.total_bytes,
        files.iter().map(|f| f.bytes.len() as u64).sum::<u64>()
    );
    db.close();
}

#[test]
fn export_enforces_size_limits() {
    let tmp = TempDb::new("limits");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let big = "x".repeat(ruth_api::export::MAX_EXPORT_FILE_BYTES + 1);
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        &big,
        std::slice::from_ref(&req_v1),
    );
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1);
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("prepare");
    assert!(preview.can_create);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Grande".to_string(),
            description: None,
            scope_module_id: None,
            entries: preview
                .entries
                .iter()
                .map(|e| BaselineEntryInput {
                    artifact_id: e.artifact.id.clone(),
                    version_id: e.version_id.clone(),
                })
                .collect(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    let err =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect_err("too large");
    assert_eq!(err.kind, "export_too_large");
    db.close();
}

#[test]
fn export_freezes_titles_and_never_reads_latest() {
    use ruth_api::{RenameArtifactInput, RenameModuleInput, RenameProjectInput};
    let tmp = TempDb::new("titles");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    // Requirement title before the baseline; the flow titles after.
    ruth_api::rename_requirement(
        &mut baby.store,
        RenameArtifactInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_title: None,
            title: "Confirmar venta".to_string(),
            by: "ana".to_string(),
        },
        "2026-10-28T11:00:00Z",
    )
    .expect("title");
    let baseline = sales_baseline(&mut baby, &db);
    // After the baseline all names change, including project and module.
    let req = baby.req.clone();
    ruth_api::rename_requirement(
        &mut baby.store,
        RenameArtifactInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: req.as_str().to_string(),
            expected_title: Some("Confirmar venta".to_string()),
            title: "Confirmar venta y reservas".to_string(),
            by: "ana".to_string(),
        },
        "2026-10-28T13:00:00Z",
    )
    .expect("retitle");
    ruth_api::rename_module(
        &mut baby.store,
        RenameModuleInput {
            project_id: baby.project.as_str().to_string(),
            module_id: baby.module.as_str().to_string(),
            expected_name: baby.module.as_str().to_string(),
            name: "Ventas renamed".to_string(),
        },
    )
    .expect("module");
    ruth_api::rename_project(
        &mut baby.store,
        RenameProjectInput {
            project_id: baby.project.as_str().to_string(),
            expected_name: baby.project.as_str().to_string(),
            name: "Shop renamed".to_string(),
        },
    )
    .expect("project");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("package");
    let spec = text(&files, "specification.md");
    assert!(
        spec.contains("## Confirmar venta — req-"),
        "heading with pinned title: {spec}"
    );
    assert!(
        !spec.contains("reservas"),
        "the current title does not leak: {spec}"
    );
    let context = text(&files, "implementation-context.md");
    assert!(context.contains("### Confirmar venta — req-"), "{context}");
    assert!(!context.contains("reservas"), "{context}");
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let req_entry = manifest["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .find(|e| e["kind"] == "requirement")
        .expect("entry");
    assert_eq!(req_entry["title"], "Confirmar venta");
    let flow_entry = manifest["entries"]
        .as_array()
        .expect("entries")
        .iter()
        .find(|e| e["kind"] == "flow")
        .expect("flow");
    assert!(
        flow_entry["title"].is_null(),
        "no title at creation: {flow_entry}"
    );
    // Neither current project/module names nor late titles in the package.
    let all = files
        .iter()
        .map(|f| String::from_utf8_lossy(&f.bytes).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!all.contains("renamed"), "no latest names: {all}");
    db.close();
}

fn mockup_json(req_id: &str) -> String {
    serde_json::json!({
        "title": "New booking",
        "screens": [{
            "id": "new_booking",
            "title": "New booking",
            "requirements": [req_id],
            "designs": [],
            "components": [
                {"id": "f_customer", "kind": "field", "label": "Customer",
                 "field_type": "text", "required": true, "origin": "persisted",
                 "requirements": [req_id], "designs": []},
                {"id": "b_ok", "kind": "button", "label": "Confirm",
                 "action": "confirm_booking", "requirements": [], "designs": []}
            ]
        }]
    })
    .to_string()
}

#[test]
fn export_renders_mockup_summary_without_diagram() {
    let tmp = TempDb::new("mockup");
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    let mut baby = baby();
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let mockup = design(
        &mut baby,
        ArtifactType::Mockup,
        &mockup_json(req.as_str()),
        std::slice::from_ref(&req_v1),
    );
    let mockup_v1 = IdGen::version(&mockup, 1);
    approve(&mut baby, &mockup.clone(), &mockup_v1);
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![mockup.as_str().to_string()],
        },
    )
    .expect("prepare");
    assert!(preview.can_create);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Con mockup".to_string(),
            description: None,
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries: preview
                .entries
                .iter()
                .map(|e| BaselineEntryInput {
                    artifact_id: e.artifact.id.clone(),
                    version_id: e.version_id.clone(),
                })
                .collect(),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("create");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("package");
    // Original JSON + readable summary, no invented diagram.
    let artifact_path = format!("artifacts/mockup-{}.json", mockup.as_str());
    assert!(
        files.iter().any(|f| f.path == artifact_path),
        "missing {artifact_path}"
    );
    assert!(
        files
            .iter()
            .all(|f| !f.path.starts_with("diagrams/mockup-")),
        "no mockup diagrams"
    );
    let spec = text(&files, "specification.md");
    assert!(spec.contains("### New booking"), "{spec}");
    assert!(spec.contains("1 screen"), "{spec}");
    assert!(spec.contains("2 components"), "{spec}");
    assert!(spec.contains("Confirm"), "{spec}");
    assert!(spec.contains("origin persisted"), "{spec}");
    let context = text(&files, "implementation-context.md");
    assert!(context.contains(mockup.as_str()), "{context}");
    assert!(context.contains("1 screen"), "{context}");
    db.close();
}
