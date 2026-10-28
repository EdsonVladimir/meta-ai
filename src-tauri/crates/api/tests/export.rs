//! Exportación reproducible: paquete completo desde la baseline, ZIP
//! determinista y hashes verificables. Sin red: núcleo, API y SQLite temporal.

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
            .expect("proyecto")
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
    Author::Human(HumanId::new("ana").expect("autora"))
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
    .expect("aprobar");
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
        "explanation": "Una venta agrupa líneas.",
        "questions": ["¿La reserva bloquea stock disponible?"]
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

/// Ventas listas: requisito, flujo y ER aprobados; baseline creada y
/// persistida en la base temporal (que sigue abierta en `db`).
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
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string(), model.as_str().to_string()],
        },
    )
    .expect("preparar");
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
            name: "Entrega ventas".to_string(),
            description: Some("Primera entrega".to_string()),
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries,
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("crear")
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
    let tmp = TempDb::new("paquete");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let before = format!("{:?}", baby.store);
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("paquete");
    // Consulta pura: el dominio no cambia.
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
    // Contenido original exacto.
    let req_file = paths
        .iter()
        .find(|p| p.starts_with("artifacts/requirement-"))
        .expect("requisito");
    assert_eq!(
        text(&files, req_file),
        "Confirmar una venta descuenta stock."
    );
    // Diagramas derivados del serializador existente.
    let flow_mmd = text(
        &files,
        paths
            .iter()
            .find(|p| p.starts_with("diagrams/flow-"))
            .expect("diagrama de flujo"),
    );
    assert!(flow_mmd.starts_with("flowchart TD"), "{flow_mmd}");
    assert!(flow_mmd.contains("Venta creada"), "{flow_mmd}");
    let er_mmd = text(
        &files,
        paths
            .iter()
            .find(|p| p.starts_with("diagrams/data_model-"))
            .expect("diagrama ER"),
    );
    assert!(er_mmd.starts_with("erDiagram"), "{er_mmd}");
    // Documentos coherentes.
    let readme = text(&files, "README.md");
    assert!(readme.contains(&baseline));
    assert!(readme.contains("no son una firma digital"));
    let spec = text(&files, "specification.md");
    assert!(spec.contains("Confirmar una venta descuenta stock."));
    assert!(spec.contains("Flujo de venta"));
    assert!(spec.contains("ana"));
    let context = text(&files, "implementation-context.md");
    assert!(context.contains("¿La reserva bloquea stock disponible?"));
    assert!(context.contains("No inventar stack"));
    // Manifiesto versionado y verificable.
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    assert_eq!(manifest["format"], "ruth-baseline-export");
    assert_eq!(manifest["format_version"], 1);
    assert_eq!(manifest["baseline"]["id"], baseline);
    assert_eq!(manifest["baseline"]["name"], "Entrega ventas");
    assert_eq!(manifest["entries"].as_array().expect("entradas").len(), 3);
    let listed = manifest["files"].as_array().expect("archivos");
    assert_eq!(listed.len(), files.len() - 1, "el manifiesto se excluye");
    assert!(!listed.iter().any(|f| f["path"] == "manifest.json"));
    for entry in listed {
        let path = entry["path"].as_str().expect("ruta");
        let bytes = &file(&files, path).bytes;
        assert_eq!(entry["sha256"], sha256_hex(bytes), "{path}");
        assert_eq!(entry["bytes"], bytes.len() as u64);
    }
    for entry in manifest["entries"].as_array().expect("entradas") {
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
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let project = baby.project.as_str().to_string();
    let first = ruth_api::build_export_files(&baby.store, &baby.metalog, &project, &baseline)
        .expect("paquete");
    let second = ruth_api::build_export_files(&baby.store, &baby.metalog, &project, &baseline)
        .expect("paquete");
    assert_eq!(first, second);
    let zip_a = ruth_api::package_to_zip(&first).expect("zip");
    let zip_b = ruth_api::package_to_zip(&second).expect("zip");
    assert_eq!(zip_a, zip_b, "mismo paquete, mismos bytes");
    assert_eq!(ruth_api::zip_sha256(&zip_a), sha256_hex(&zip_a));
    // El ZIP se abre con un lector estándar y trae todo.
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&zip_a)).expect("abrir zip");
    assert_eq!(archive.len(), first.len());
    for expected in &first {
        let mut entry = archive.by_name(&expected.path).expect(&expected.path);
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).expect("leer");
        assert_eq!(bytes, expected.bytes, "{}", expected.path);
    }
    db.close();
}

#[test]
fn export_ignores_current_state() {
    let tmp = TempDb::new("historica");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    // El proyecto avanza después de la baseline.
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
            .expect("paquete");
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let req_file = paths
        .iter()
        .find(|p| p.starts_with("artifacts/requirement-"))
        .expect("requisito");
    assert_eq!(
        text(&files, req_file),
        "Confirmar una venta descuenta stock.",
        "la baseline conserva la v1"
    );
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let req_entry = manifest["entries"]
        .as_array()
        .expect("entradas")
        .iter()
        .find(|e| e["kind"] == "requirement")
        .expect("entrada");
    assert_eq!(req_entry["version"], baby.req_v1.as_str());
    db.close();
}

#[test]
fn export_rejects_unknown_baseline() {
    let tmp = TempDb::new("desconocida");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let err = ruth_api::build_export_files(
        &baby.store,
        &baby.metalog,
        baby.project.as_str(),
        "base-404",
    )
    .expect_err("inexistente");
    assert_eq!(err.kind, "baseline_not_found");
    // De otro proyecto: no se exporta aunque exista la baseline.
    let err = ruth_api::build_export_files(&baby.store, &baby.metalog, "proj-ajeno", &baseline)
        .expect_err("ajena");
    assert_eq!(err.kind, "baseline_not_found");
    db.close();
}

#[test]
fn export_neutralizes_malicious_titles_and_ids() {
    let tmp = TempDb::new("maliciosa");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
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
        .expect("artefacto");
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
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("preparar");
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
    .expect("crear");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("paquete");
    for f in &files {
        assert!(is_safe_path(&f.path), "ruta insegura: {}", f.path);
        assert!(!f.path.contains(".."), "escape: {}", f.path);
    }
    // Los títulos libres nunca llegan a los nombres de archivo.
    assert!(
        !files
            .iter()
            .any(|f| f.path.contains("etc") || f.path.contains("evil")),
        "título filtrado a rutas"
    );
    // El ZIP hereda las rutas seguras.
    let zip = ruth_api::package_to_zip(&files).expect("zip");
    let archive = zip::ZipArchive::new(std::io::Cursor::new(&zip)).expect("abrir");
    for name in archive.file_names() {
        assert!(is_safe_path(name), "ruta insegura en zip: {name}");
    }
    db.close();
}

#[test]
fn export_marks_unstructured_designs_without_inventing() {
    let tmp = TempDb::new("no-estructurado");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let req_v1 = baby.req_v1.clone();
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    // Contenido heredado: texto libre en un artefacto de diseño.
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        "Borrador antiguo sin JSON.",
        std::slice::from_ref(&req_v1),
    );
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1);
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("preparar");
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Legado".to_string(),
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
    .expect("crear");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("paquete");
    let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
    let diagram = paths
        .iter()
        .find(|p| p.starts_with("diagrams/"))
        .expect("diagrama");
    let body = text(&files, diagram);
    assert!(body.starts_with("%%"), "{body}");
    assert!(body.contains("artifacts/"), "{body}");
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let flow_entry = manifest["entries"]
        .as_array()
        .expect("entradas")
        .iter()
        .find(|e| e["kind"] == "flow")
        .expect("flujo");
    assert_eq!(flow_entry["diagram_ok"], false);
    let spec = text(&files, "specification.md");
    assert!(spec.contains("no estructurado"));
    db.close();
}

#[test]
fn export_preview_matches_package() {
    let tmp = TempDb::new("vista-previa");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    let baseline = sales_baseline(&mut baby, &db);
    let preview =
        ruth_api::export_preview(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("vista previa");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("paquete");
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
    let tmp = TempDb::new("limites");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
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
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![flow.as_str().to_string()],
        },
    )
    .expect("preparar");
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
    .expect("crear");
    let err =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect_err("demasiado grande");
    assert_eq!(err.kind, "export_too_large");
    db.close();
}

#[test]
fn export_freezes_titles_and_never_reads_latest() {
    use ruth_api::{RenameArtifactInput, RenameModuleInput, RenameProjectInput};
    let tmp = TempDb::new("titulos");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    let mut baby = baby();
    // Título del requisito antes de la baseline; el flujo se titula después.
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
    .expect("título");
    let baseline = sales_baseline(&mut baby, &db);
    // Tras la baseline cambian todos los nombres, incluidos proyecto y módulo.
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
    .expect("retítulo");
    ruth_api::rename_module(
        &mut baby.store,
        RenameModuleInput {
            project_id: baby.project.as_str().to_string(),
            module_id: baby.module.as_str().to_string(),
            expected_name: baby.module.as_str().to_string(),
            name: "Ventas renombrado".to_string(),
        },
    )
    .expect("módulo");
    ruth_api::rename_project(
        &mut baby.store,
        RenameProjectInput {
            project_id: baby.project.as_str().to_string(),
            expected_name: baby.project.as_str().to_string(),
            name: "Tienda renombrado".to_string(),
        },
    )
    .expect("proyecto");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &baseline)
            .expect("paquete");
    let spec = text(&files, "specification.md");
    assert!(
        spec.contains("## Confirmar venta — req-"),
        "encabezado con título fijado: {spec}"
    );
    assert!(
        !spec.contains("reservas"),
        "el título vigente no se filtra: {spec}"
    );
    let context = text(&files, "implementation-context.md");
    assert!(context.contains("### Confirmar venta — req-"), "{context}");
    assert!(!context.contains("reservas"), "{context}");
    let manifest: serde_json::Value =
        serde_json::from_str(&text(&files, "manifest.json")).expect("json");
    let req_entry = manifest["entries"]
        .as_array()
        .expect("entradas")
        .iter()
        .find(|e| e["kind"] == "requirement")
        .expect("entrada");
    assert_eq!(req_entry["title"], "Confirmar venta");
    let flow_entry = manifest["entries"]
        .as_array()
        .expect("entradas")
        .iter()
        .find(|e| e["kind"] == "flow")
        .expect("flujo");
    assert!(
        flow_entry["title"].is_null(),
        "sin título al crear: {flow_entry}"
    );
    // Ni nombres de proyecto/módulo vigentes ni títulos tardíos en el paquete.
    let all = files
        .iter()
        .map(|f| String::from_utf8_lossy(&f.bytes).into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!all.contains("renombrado"), "sin nombres latest: {all}");
    db.close();
}

fn mockup_json(req_id: &str) -> String {
    serde_json::json!({
        "title": "Nueva reserva",
        "screens": [{
            "id": "nueva_reserva",
            "title": "Nueva reserva",
            "requirements": [req_id],
            "designs": [],
            "components": [
                {"id": "f_cliente", "kind": "field", "label": "Cliente",
                 "field_type": "text", "required": true, "origin": "persisted",
                 "requirements": [req_id], "designs": []},
                {"id": "b_ok", "kind": "button", "label": "Confirmar",
                 "action": "confirmar_reserva", "requirements": [], "designs": []}
            ]
        }]
    })
    .to_string()
}

#[test]
fn export_renders_mockup_summary_without_diagram() {
    let tmp = TempDb::new("mockup");
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
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
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![mockup.as_str().to_string()],
        },
    )
    .expect("preparar");
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
    .expect("crear");
    let files =
        ruth_api::build_export_files(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
            .expect("paquete");
    // JSON original + resumen legible, sin diagrama inventado.
    let artifact_path = format!("artifacts/mockup-{}.json", mockup.as_str());
    assert!(
        files.iter().any(|f| f.path == artifact_path),
        "falta {artifact_path}"
    );
    assert!(
        files
            .iter()
            .all(|f| !f.path.starts_with("diagrams/mockup-")),
        "sin diagramas de mockup"
    );
    let spec = text(&files, "specification.md");
    assert!(spec.contains("### Nueva reserva"), "{spec}");
    assert!(spec.contains("1 pantalla"), "{spec}");
    assert!(spec.contains("2 componentes"), "{spec}");
    assert!(spec.contains("Confirmar"), "{spec}");
    assert!(spec.contains("origen persisted"), "{spec}");
    let context = text(&files, "implementation-context.md");
    assert!(context.contains(mockup.as_str()), "{context}");
    assert!(context.contains("1 pantalla"), "{context}");
    db.close();
}
