//! Work/draft deliveries: a snapshot of saved versions WITHOUT requiring
//! approval. Invariants separate from the approved baseline: current
//! entries, from the project, unarchived and without artifact duplicates;
//! reviews and staleness are identified on read.

use ruth_core::application::{Snapshot, Store};
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, CoreError, Date, DeliveryId, HumanId, ModuleId,
    ProjectId, VersionId,
};

fn human(name: &str) -> Author {
    Author::Human(HumanId::new(name).expect("id"))
}

fn setup() -> (Store, ProjectId, ModuleId, ArtifactId, VersionId) {
    let project = ProjectId::new("proy-1").expect("id");
    let module = ModuleId::new("mod-1").expect("id");
    let req = ArtifactId::new("req-1").expect("id");
    let mut store = Store::new();
    store.create_project(project.clone()).expect("project");
    store
        .create_module(&project, module.clone())
        .expect("module");
    store
        .create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)
        .expect("artifact");
    let v1 = VersionId::new("req-1-v1").expect("id");
    store
        .create_version(
            &project,
            &req,
            None,
            v1.clone(),
            Content::new("confirmar una venta descuenta stock").expect("c"),
            &human("ana"),
            &[],
        )
        .expect("v1");
    (store, project, module, req, v1)
}

fn save_req(store: &mut Store, project: &ProjectId, req: &ArtifactId, id: &str) -> VersionId {
    let vid = VersionId::new(id).expect("id");
    let current = store.current_version(req).map(|v| v.id().clone());
    store
        .create_version(
            project,
            req,
            current.as_ref(),
            vid.clone(),
            Content::new(format!("contenido {id}")).expect("c"),
            &human("ana"),
            &[],
        )
        .expect("version");
    vid
}

#[test]
fn delivery_needs_no_approval() -> Result<(), CoreError> {
    let (mut store, project, module, req, v1) = setup();
    assert!(!store.is_approved(&v1));
    let at = Date::new("2026-10-28T10:00:00Z")?;
    let delivery = store.create_work_delivery(
        &project,
        DeliveryId::new("entrega-1")?,
        "Monday work".to_string(),
        None,
        Some(module.clone()),
        &[(req.clone(), v1.clone())],
        at,
    )?;
    assert_eq!(delivery.name(), "Monday work");
    assert_eq!(delivery.scope_module(), Some(&module));
    assert_eq!(delivery.entries(), &[(req, v1)]);
    assert_eq!(store.deliveries().len(), 1);
    // The approved baseline still requires review: separate invariants.
    let err = store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1")?,
            delivery.entries(),
            Date::new("2026-10-28T10:00:00Z")?,
        )
        .expect_err("unapproved baseline");
    assert!(matches!(err, CoreError::VersionNotApproved { .. }));
    Ok(())
}

#[test]
fn delivery_rejects_structural_problems() -> Result<(), CoreError> {
    let (mut store, project, module, req, v1) = setup();
    let at = || Date::new("2026-10-28T10:00:00Z").expect("date");
    // Empty.
    let err = store
        .create_work_delivery(
            &project,
            DeliveryId::new("e-vacia")?,
            "Empty".to_string(),
            None,
            None,
            &[],
            at(),
        )
        .expect_err("empty");
    assert_eq!(err, CoreError::EmptyDelivery);
    // Obsolete version: current ones only.
    let v2 = save_req(&mut store, &project, &req, "req-1-v2");
    let err = store
        .create_work_delivery(
            &project,
            DeliveryId::new("e-vieja")?,
            "Vieja".to_string(),
            None,
            None,
            &[(req.clone(), v1.clone())],
            at(),
        )
        .expect_err("obsoleta");
    assert!(matches!(err, CoreError::VersionNotCurrent { .. }));
    // Duplicar artefacto.
    let err = store
        .create_work_delivery(
            &project,
            DeliveryId::new("e-dup")?,
            "Dup".to_string(),
            None,
            None,
            &[(req.clone(), v2.clone()), (req.clone(), v2.clone())],
            at(),
        )
        .expect_err("duplicado");
    assert!(matches!(err, CoreError::DeliveryDuplicateArtifact { .. }));
    // Scope from another project.
    let other_project = ProjectId::new("proy-9")?;
    store.create_project(other_project.clone())?;
    let other_module = ModuleId::new("mod-9")?;
    store.create_module(&other_project, other_module.clone())?;
    let err = store
        .create_work_delivery(
            &project,
            DeliveryId::new("e-alcance")?,
            "Alcance".to_string(),
            None,
            Some(other_module),
            &[(req.clone(), v2.clone())],
            at(),
        )
        .expect_err("alcance ajeno");
    assert!(matches!(err, CoreError::ModuleNotInProject { .. }));
    // Entrada archivada.
    store.set_artifact_archived(&project, &req, true)?;
    let err = store
        .create_work_delivery(
            &project,
            DeliveryId::new("e-arch")?,
            "Arch".to_string(),
            None,
            None,
            &[(req.clone(), v2)],
            at(),
        )
        .expect_err("archivada");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    // The module was untouched by the foreign-scope attempt.
    assert!(store.module(&module).is_some());
    Ok(())
}

#[test]
fn delivery_freezes_titles_and_stays_immutable() -> Result<(), CoreError> {
    let (mut store, project, _, req, v1) = setup();
    store.rename_artifact(
        &project,
        &req,
        None,
        ruth_core::domain::Name::new("Confirmar venta".to_string())?,
        &HumanId::new("ana")?,
        Date::new("2026-10-28")?,
    )?;
    let delivery = store.create_work_delivery(
        &project,
        DeliveryId::new("entrega-1")?,
        "With title".to_string(),
        Some("for export".to_string()),
        None,
        &[(req.clone(), v1)],
        Date::new("2026-10-28T10:00:00Z")?,
    )?;
    assert_eq!(delivery.title_of(&req), Some(Some("Confirmar venta")));
    assert_eq!(delivery.description(), Some("for export"));
    // Retitling later does not move the delivery.
    store.rename_artifact(
        &project,
        &req,
        Some("Confirmar venta"),
        ruth_core::domain::Name::new("Confirmar venta y reservas".to_string())?,
        &HumanId::new("ana")?,
        Date::new("2026-10-29")?,
    )?;
    let frozen = store
        .delivery(&DeliveryId::new("entrega-1")?)
        .expect("delivery");
    assert_eq!(frozen.title_of(&req), Some(Some("Confirmar venta")));
    assert_eq!(frozen.entries().len(), 1);
    Ok(())
}

#[test]
fn delivery_blocks_safe_delete() -> Result<(), CoreError> {
    let (mut store, project, _, req, v1) = setup();
    store.create_work_delivery(
        &project,
        DeliveryId::new("entrega-1")?,
        "Protege".to_string(),
        None,
        None,
        &[(req.clone(), v1)],
        Date::new("2026-10-28T10:00:00Z")?,
    )?;
    let refs = store.artifact_references(&project, &req)?;
    assert_eq!(refs.deliveries.len(), 1);
    let err = store
        .delete_artifact(&project, &req)
        .expect_err("en entrega");
    assert!(matches!(err, CoreError::DeleteInDelivery { .. }));
    Ok(())
}

#[test]
fn reconstitute_validates_deliveries() -> Result<(), CoreError> {
    let (mut store, project, module, req, v1) = setup();
    store.create_work_delivery(
        &project,
        DeliveryId::new("entrega-1")?,
        "Ronda".to_string(),
        None,
        Some(module.clone()),
        &[(req.clone(), v1.clone())],
        Date::new("2026-10-28T10:00:00Z")?,
    )?;
    let snapshot = Snapshot {
        projects: store.projects().iter().map(|p| (*p).clone()).collect(),
        modules: store
            .modules_of(&project)
            .iter()
            .map(|m| (*m).clone())
            .collect(),
        artifacts: vec![store.artifact(&req).expect("req").clone()],
        versions: vec![store.version(&v1).expect("v1").clone()],
        approvals: vec![],
        baselines: vec![],
        title_history: vec![],
        deliveries: store.deliveries().iter().map(|d| (*d).clone()).collect(),
    };
    let loaded = Store::reconstitute(snapshot)?;
    assert_eq!(loaded.deliveries().len(), 1);
    // Dangling entry: rejected without loading anything.
    let ghost = VersionId::new("req-1-v99")?;
    let bad = Snapshot {
        projects: loaded.projects().iter().map(|p| (*p).clone()).collect(),
        modules: loaded
            .modules_of(&project)
            .iter()
            .map(|m| (*m).clone())
            .collect(),
        artifacts: vec![loaded.artifact(&req).expect("req").clone()],
        versions: vec![loaded.version(&v1).expect("v1").clone()],
        approvals: vec![],
        baselines: vec![],
        title_history: vec![],
        deliveries: vec![ruth_core::domain::WorkDelivery::new(
            DeliveryId::new("entrega-mala")?,
            project.clone(),
            "Mala".to_string(),
            None,
            None,
            vec![(req.clone(), ghost)],
            std::collections::HashMap::new(),
            Date::new("2026-10-28T10:00:00Z")?,
        )],
    };
    let err = Store::reconstitute(bad).expect_err("colgada");
    assert!(matches!(err, CoreError::VersionNotFound { .. }));
    Ok(())
}
