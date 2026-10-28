//! Archivo reversible y borrado seguro: visibilidad por contexto,
//! bloqueo de escrituras sobre archivados, fuentes archivadas que bloquean
//! aprobaciones y baselines, y borrado solo sin referencias.

use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, CoreError, Date, HumanId, ModuleId, ProjectId,
    VersionId,
};

fn human(name: &str) -> Author {
    Author::Human(HumanId::new(name).expect("id"))
}

fn setup() -> (Store, ProjectId, ModuleId, ArtifactId) {
    let project = ProjectId::new("proy-1").expect("id");
    let module = ModuleId::new("mod-1").expect("id");
    let req = ArtifactId::new("req-1").expect("id");
    let mut store = Store::new();
    store.create_project(project.clone()).expect("proyecto");
    store
        .create_module(&project, module.clone())
        .expect("módulo");
    store
        .create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)
        .expect("artefacto");
    (store, project, module, req)
}

fn mk_version(
    store: &mut Store,
    project: &ProjectId,
    artifact: &ArtifactId,
    id: &str,
    sources: &[VersionId],
) -> VersionId {
    let vid = VersionId::new(id).expect("id");
    let current = store.current_version(artifact).map(|v| v.id().clone());
    store
        .create_version(
            project,
            artifact,
            current.as_ref(),
            vid.clone(),
            Content::new(format!("contenido {id}")).expect("contenido"),
            &human("ana"),
            sources,
        )
        .expect("versión");
    vid
}

fn approve(store: &mut Store, project: &ProjectId, artifact: &ArtifactId, version: &VersionId) {
    store
        .approve(
            project,
            artifact,
            version,
            &human("bruno"),
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect("aprobación");
}

#[test]
fn archive_hides_by_context_without_touching_individual_state() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    approve(&mut store, &project, &req, &v1);

    // Archivar el módulo no toca el flag individual ni el historial.
    store
        .set_module_archived(&project, &module, true)
        .expect("archivar módulo");
    assert!(store.module(&module).expect("módulo").archived());
    assert!(!store.artifact(&req).expect("req").archived());
    assert!(store.is_effectively_archived(&req));
    assert_eq!(store.versions_of(&req).len(), 1);
    assert!(!store.approvals_of(&v1).is_empty());

    // Restaurar el módulo no restaura lo archivado individualmente.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar req");
    store
        .set_module_archived(&project, &module, false)
        .expect("restaurar módulo");
    assert!(store.artifact(&req).expect("req").archived());
    assert!(store.is_effectively_archived(&req));
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restaurar req");
    assert!(!store.is_effectively_archived(&req));
}

#[test]
fn writes_are_blocked_on_archived_elements() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);

    // Nueva versión sobre archivado individual.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar");
    let before = store.clone();
    let err = store
        .create_version(
            &project,
            &req,
            Some(&v1),
            VersionId::new("req-1-v2").expect("id"),
            Content::new("cambio").expect("contenido"),
            &human("ana"),
            &[],
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    assert_eq!(store, before);

    // Crear artefactos en un módulo archivado.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restaurar");
    store
        .set_module_archived(&project, &module, true)
        .expect("archivar módulo");
    let err = store
        .create_artifact(
            &project,
            &module,
            ArtifactId::new("req-2").expect("id"),
            ArtifactType::Requirement,
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedModule { .. }));

    // Aprobar bajo un módulo archivado (archivado por contexto).
    let err = store
        .approve(
            &project,
            &req,
            &v1,
            &human("bruno"),
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    assert_eq!(store.versions_of(&req).len(), 1);
}

#[test]
fn archived_source_blocks_approval_until_resolved() {
    let (mut store, project, module, req) = setup();
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flujo");
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    let f1 = mk_version(
        &mut store,
        &project,
        &flow,
        "flujo-1-v1",
        std::slice::from_ref(&v1),
    );

    // Archivar la fuente bloquea aprobar el derivado activo.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar fuente");
    let err = store
        .approve(
            &project,
            &flow,
            &f1,
            &human("bruno"),
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedSource { .. }));

    // Restaurar la fuente desbloquea la aprobación pendiente.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restaurar");
    approve(&mut store, &project, &req, &v1);
    approve(&mut store, &project, &flow, &f1);

    // O una versión revisada sin la fuente archivada también resuelve.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar de nuevo");
    let f2 = mk_version(&mut store, &project, &flow, "flujo-1-v2", &[]);
    approve(&mut store, &project, &flow, &f2);
    assert!(store.is_approved(&f2));
}

#[test]
fn archived_entries_and_sources_block_baselines() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    approve(&mut store, &project, &req, &v1);

    // Una entrada archivada no entra en una baseline nueva.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar");
    let err = store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone())],
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));

    // Ni un derivado activo con fuente archivada.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restaurar");
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flujo");
    let f1 = mk_version(
        &mut store,
        &project,
        &flow,
        "flujo-1-v1",
        std::slice::from_ref(&v1),
    );
    approve(&mut store, &project, &flow, &f1);
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archivar fuente");
    let err = store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone()), (flow.clone(), f1.clone())],
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
}

#[test]
fn safe_delete_removes_draft_without_touching_the_rest() {
    let (mut store, project, module, req) = setup();
    mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    mk_version(&mut store, &project, &req, "req-1-v2", &[]);
    let other = ArtifactId::new("req-2").expect("id");
    store
        .create_artifact(&project, &module, other.clone(), ArtifactType::Requirement)
        .expect("otro");
    let o1 = mk_version(&mut store, &project, &other, "req-2-v1", &[]);

    let deleted = store.delete_artifact(&project, &req).expect("borrar");
    assert_eq!(deleted, req);
    assert!(store.artifact(&req).is_none());
    assert!(store
        .version(&VersionId::new("req-1-v1").expect("id"))
        .is_none());
    assert!(store
        .version(&VersionId::new("req-1-v2").expect("id"))
        .is_none());
    assert!(store.versions_of(&req).is_empty());
    // Lo demás sigue intacto.
    assert!(store.artifact(&other).is_some());
    assert_eq!(store.current_version(&other).expect("actual").id(), &o1);

    // Módulo ya vacío: también se elimina.
    store
        .delete_artifact(&project, &other)
        .expect("borrar otro");
    let removed = store
        .delete_module(&project, &module)
        .expect("borrar módulo");
    assert_eq!(removed, module);
    assert!(store.module(&module).is_none());
    assert!(store.project(&project).is_some());
}

#[test]
fn delete_is_blocked_by_approvals_dependents_and_baselines() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flujo");
    mk_version(
        &mut store,
        &project,
        &flow,
        "flujo-1-v1",
        std::slice::from_ref(&v1),
    );
    approve(&mut store, &project, &req, &v1);

    // Con aprobación y dependiente: bloquea e indica el motivo.
    let before = store.clone();
    let err = store
        .delete_artifact(&project, &req)
        .expect_err("debe fallar");
    assert!(matches!(err, CoreError::DeleteHasApprovals { .. }));
    assert_eq!(store, before);

    // Sin aprobaciones pero con dependiente: bloquea nombrándolo.
    let (mut plain, p2, m2, r2) = setup_plain();
    let w1 = mk_version(&mut plain, &p2, &r2, "req-9-v1", &[]);
    let f2 = ArtifactId::new("flujo-9").expect("id");
    plain
        .create_artifact(&p2, &m2, f2.clone(), ArtifactType::Flow)
        .expect("flujo");
    mk_version(&mut plain, &p2, &f2, "flujo-9-v1", &[w1]);
    let err = plain.delete_artifact(&p2, &r2).expect_err("debe fallar");
    match err {
        CoreError::DeleteHasDependents { dependents, .. } => assert_eq!(dependents, vec![f2]),
        other => panic!("error inesperado: {other:?}"),
    }

    // En baseline: bloquea nombrándola.
    store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone())],
            Date::new("2026-10-27").expect("fecha"),
        )
        .expect("baseline");
    let err = store
        .delete_artifact(&project, &req)
        .expect_err("debe fallar");
    assert!(matches!(
        err,
        CoreError::DeleteHasApprovals { .. } | CoreError::DeleteInBaseline { .. }
    ));

    // Módulo con contenido: bloquea listándolo.
    let err = store
        .delete_module(&project, &module)
        .expect_err("debe fallar");
    match err {
        CoreError::DeleteModuleNotEmpty { artifacts, .. } => {
            assert!(artifacts.contains(&req));
            assert!(artifacts.contains(&flow));
        }
        other => panic!("error inesperado: {other:?}"),
    }
    assert!(store.artifact(&req).is_some());
}

fn setup_plain() -> (Store, ProjectId, ModuleId, ArtifactId) {
    let project = ProjectId::new("proy-9").expect("id");
    let module = ModuleId::new("mod-9").expect("id");
    let req = ArtifactId::new("req-9").expect("id");
    let mut store = Store::new();
    store.create_project(project.clone()).expect("proyecto");
    store
        .create_module(&project, module.clone())
        .expect("módulo");
    store
        .create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)
        .expect("artefacto");
    (store, project, module, req)
}

#[test]
fn references_report_dependents_baselines_and_approvals() {
    let (mut store, project, _module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    let refs = store.artifact_references(&project, &req).expect("refs");
    assert!(refs.dependents.is_empty());
    assert!(refs.baselines.is_empty());
    assert_eq!(refs.approvals, 0);
    assert_eq!(refs.versions, 1);

    approve(&mut store, &project, &req, &v1);
    let refs = store.artifact_references(&project, &req).expect("refs");
    assert_eq!(refs.approvals, 1);
}
