//! Baselines de entrega: preparar con cierre, crear atómico, listar con
//! aviso de avance. Sin red: todo es núcleo, API y SQLite temporal.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    ApproveVersionInput, BaselineCreateInput, BaselineEntryInput, BaselinePrepareInput,
    CreateModuleInput, CreateRequirementInput, IdGen, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, HumanId, ModuleId, ProjectId, VersionId,
};
use ruth_store::{BaselineMetaLog, DbActor};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-baseline-{}-{}-{}.db",
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
        metalog: BaselineMetaLog::new(),
        project,
        module,
        req,
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

fn flow_json() -> String {
    serde_json::json!({
        "title": "Flujo de venta",
        "nodes": [
            {"id": "inicio", "kind": "start", "label": "Venta creada", "requirements": []},
            {"id": "fin", "kind": "end", "label": "Venta confirmada", "requirements": []}
        ],
        "edges": [{"from": "inicio", "to": "fin"}],
        "explanation": "Mínimo.",
        "questions": []
    })
    .to_string()
}

/// Ventas listas: requisito y flujo aprobados y vigentes.
fn sales_ready() -> (Baby, ArtifactId) {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        &flow_json(),
        std::slice::from_ref(&req_v1),
    );
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow.clone(), &flow_v1);
    (baby, flow)
}

fn prepare_all(baby: &Baby, ids: &[String]) -> ruth_api::BaselinePreviewDto {
    ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: ids.to_vec(),
        },
    )
    .expect("preparar")
}

fn entries_of(preview: &ruth_api::BaselinePreviewDto) -> Vec<BaselineEntryInput> {
    preview
        .entries
        .iter()
        .map(|e| BaselineEntryInput {
            artifact_id: e.artifact.id.clone(),
            version_id: e.version_id.clone(),
        })
        .collect()
}

#[test]
fn prepare_closes_dependencies_and_can_create() {
    let (baby, flow) = sales_ready();
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    assert!(preview.can_create);
    assert!(preview.blockers.is_empty());
    assert_eq!(preview.entries.len(), 2);
    let flow_entry = preview
        .entries
        .iter()
        .find(|e| e.artifact.id == flow.as_str())
        .expect("flujo");
    assert!(!flow_entry.auto_included);
    assert_eq!(flow_entry.approved_by.as_deref(), Some("ana"));
    let req_entry = preview
        .entries
        .iter()
        .find(|e| e.artifact.id == baby.req.as_str())
        .expect("requisito por cierre");
    assert!(req_entry.auto_included);
    assert_eq!(req_entry.provenance.kind, "human");
    assert!(preview.out_of_scope.artifacts.is_empty());
    assert!(preview.out_of_scope.modules.is_empty());
}

#[test]
fn prepare_blocks_drafts() {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    // Flujo sin aprobar sobre requisito sin aprobar.
    let flow = design(
        &mut baby,
        ArtifactType::Flow,
        &flow_json(),
        std::slice::from_ref(&req_v1),
    );
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    assert!(!preview.can_create);
    let codes: Vec<&str> = preview.blockers.iter().map(|b| b.code.as_str()).collect();
    assert!(codes.iter().all(|c| *c == "draft"));
    assert_eq!(preview.blockers.len(), 2);
    assert!(preview
        .blockers
        .iter()
        .any(|b| b.message.contains("borrador")));
}

#[test]
fn prepare_blocks_stale_sources() {
    let (mut baby, flow) = sales_ready();
    // El requisito avanza: el flujo usa una fuente desactualizada.
    let req_v1 = IdGen::version(&baby.req, 1);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Reservar antes de confirmar.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    assert!(!preview.can_create);
    assert!(preview
        .blockers
        .iter()
        .any(|b| b.code == "stale_sources" && b.artifact_id.as_deref() == Some(flow.as_str())));
}

#[test]
fn prepare_reports_partial_scope() {
    let (mut baby, flow) = sales_ready();
    // Segundo módulo con un requisito: queda fuera del alcance.
    let other = ruth_api::create_module(
        &mut baby.store,
        &mut baby.ids,
        CreateModuleInput {
            project_id: baby.project.as_str().to_string(),
        },
    )
    .expect("módulo")
    .id;
    let other_id = ModuleId::new(other.clone()).expect("id");
    let extra = ArtifactId::new("req-9").expect("id");
    baby.store
        .create_artifact(
            &baby.project,
            &other_id,
            extra.clone(),
            ArtifactType::Requirement,
        )
        .expect("artefacto");
    save_version(&mut baby, &extra, 1, "Otro módulo.", &[]);
    // Solo se elige el requisito: el flujo del módulo queda fuera.
    let preview = prepare_all(&baby, &[baby.req.as_str().to_string()]);
    assert!(preview.can_create);
    assert_eq!(
        preview.out_of_scope.artifacts,
        vec![flow.as_str().to_string()]
    );
    assert_eq!(preview.out_of_scope.modules.len(), 1);
    assert_eq!(preview.out_of_scope.modules[0].id, other);
    assert_eq!(
        preview.out_of_scope.modules[0].artifacts,
        vec!["req-9".to_string()]
    );
}

#[test]
fn prepare_rejects_empty_and_foreign_selection() {
    let (baby, _) = sales_ready();
    let err = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec![],
        },
    )
    .expect_err("vacía");
    assert_eq!(err.kind, "empty_selection");
    let err = ruth_api::prepare_baseline(
        &baby.store,
        BaselinePrepareInput {
            project_id: baby.project.as_str().to_string(),
            scope_module_id: baby.module.as_str().to_string(),
            artifact_ids: vec!["req-404".to_string()],
        },
    )
    .expect_err("inexistente");
    assert_eq!(err.kind, "artifact_not_found");
}

#[test]
fn prepare_does_not_mutate() {
    let (baby, flow) = sales_ready();
    let before = format!("{:?}", baby.store);
    let first = prepare_all(&baby, &[flow.as_str().to_string()]);
    assert_eq!(format!("{:?}", baby.store), before);
    let second = prepare_all(&baby, &[flow.as_str().to_string()]);
    assert_eq!(first, second);
}

#[test]
fn create_ok_get_and_list_without_advance() {
    let tmp = TempDb::new("crear-baseline");
    let (mut baby, flow) = sales_ready();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Entrega 1".to_string(),
            description: Some("Ventas".to_string()),
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries: entries_of(&preview),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("crear");
    assert_eq!(dto.name, "Entrega 1");
    assert_eq!(dto.entries.len(), 2);
    assert!(dto.entries.iter().any(|e| e.kind == "flow"));
    let back = ruth_api::get_baseline(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
        .expect("detalle");
    assert_eq!(back, dto);
    let list = ruth_api::list_baselines(&baby.store, &baby.metalog, baby.project.as_str())
        .expect("listar");
    assert_eq!(list.len(), 1);
    assert!(!list[0].advanced);
    assert!(list[0].advanced_artifacts.is_empty());
    db.close();
}

#[test]
fn create_conflicts_when_project_changed_since_preview() {
    let tmp = TempDb::new("conflicto-baseline");
    let (mut baby, flow) = sales_ready();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    // El proyecto avanza después de la preparación.
    let req_v1 = IdGen::version(&baby.req, 1);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Cambio tardío.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let before_store = baby.store.clone();
    let before_ids = baby.ids.checkpoint();
    let err = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Entrega 1".to_string(),
            description: None,
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries: entries_of(&preview),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("conflicto");
    assert_eq!(err.kind, "changed_since_preview");
    assert_eq!(baby.store, before_store);
    assert_eq!(baby.ids.checkpoint(), before_ids);
    assert!(baby.metalog.all().is_empty());
    let list = ruth_api::list_baselines(&baby.store, &baby.metalog, baby.project.as_str())
        .expect("listar");
    assert!(list.is_empty());
    db.close();
}

#[test]
fn create_revalidates_coherence_without_partial_state() {
    let tmp = TempDb::new("revalidar-baseline");
    let (mut baby, flow) = sales_ready();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    // Entradas tramposas: el flujo sin su fuente (el núcleo lo rechaza).
    let flow_v1 = IdGen::version(&flow, 1);
    let before_store = baby.store.clone();
    let err = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Tramposa".to_string(),
            description: None,
            scope_module_id: None,
            entries: vec![BaselineEntryInput {
                artifact_id: flow.as_str().to_string(),
                version_id: flow_v1.as_str().to_string(),
            }],
        },
        "2026-10-28T12:00:00Z",
    )
    .expect_err("incoherente");
    assert_ne!(err.kind, "changed_since_preview");
    assert_eq!(baby.store, before_store);
    assert!(baby.metalog.all().is_empty());
    db.close();
}

#[test]
fn list_flags_advanced_baselines() {
    let tmp = TempDb::new("avance-baseline");
    let (mut baby, flow) = sales_ready();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = prepare_all(&baby, &[baby.req.as_str().to_string()]);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "A".to_string(),
            description: None,
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries: entries_of(&preview),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("crear");
    assert_eq!(dto.entries.len(), 1);
    let req_v1 = IdGen::version(&baby.req, 1);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Nueva redacción.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let list = ruth_api::list_baselines(&baby.store, &baby.metalog, baby.project.as_str())
        .expect("listar");
    assert!(list[0].advanced);
    assert_eq!(
        list[0].advanced_artifacts,
        vec![baby.req.as_str().to_string()]
    );
    // La baseline conserva la versión anterior.
    let back = ruth_api::get_baseline(&baby.store, &baby.metalog, baby.project.as_str(), &dto.id)
        .expect("detalle");
    assert_eq!(back.entries[0].version_id, req_v1.as_str());
    let _ = flow;
    db.close();
}

#[test]
fn baseline_roundtrips_through_db() {
    let tmp = TempDb::new("baseline-reabrir");
    let (mut baby, flow) = sales_ready();
    let (db, _) = DbActor::spawn(&tmp.path).expect("abrir");
    db.save(&baby.store, baby.ids.checkpoint())
        .expect("dominio");
    let preview = prepare_all(&baby, &[flow.as_str().to_string()]);
    let dto = ruth_api::create_baseline(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.metalog,
        &db,
        BaselineCreateInput {
            project_id: baby.project.as_str().to_string(),
            name: "Entrega 1".to_string(),
            description: None,
            scope_module_id: Some(baby.module.as_str().to_string()),
            entries: entries_of(&preview),
        },
        "2026-10-28T12:00:00Z",
    )
    .expect("crear");
    db.close();
    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reabrir");
    let back = ruth_api::get_baseline(
        &loaded.store,
        &loaded.baseline_meta,
        baby.project.as_str(),
        &dto.id,
    )
    .expect("detalle");
    assert_eq!(back.name, "Entrega 1");
    assert_eq!(back.entries.len(), 2);
    db2.close();
}
