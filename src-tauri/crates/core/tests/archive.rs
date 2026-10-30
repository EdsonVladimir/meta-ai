//! Reversible archiving and safe deletion: visibility by context,
//! blocking writes on archived items, archived sources blocking
//! approvals and baselines, and deletion only without references.

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
    store.create_project(project.clone()).expect("project");
    store
        .create_module(&project, module.clone())
        .expect("module");
    store
        .create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)
        .expect("artifact");
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
            Content::new(format!("contenido {id}")).expect("content"),
            &human("ana"),
            sources,
        )
        .expect("version");
    vid
}

fn approve(store: &mut Store, project: &ProjectId, artifact: &ArtifactId, version: &VersionId) {
    store
        .approve(
            project,
            artifact,
            version,
            &human("bruno"),
            Date::new("2026-10-27").expect("date"),
        )
        .expect("approval");
}

#[test]
fn archive_hides_by_context_without_touching_individual_state() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    approve(&mut store, &project, &req, &v1);

    // Archiving the module touches neither the individual flag nor the history.
    store
        .set_module_archived(&project, &module, true)
        .expect("archive module");
    assert!(store.module(&module).expect("module").archived());
    assert!(!store.artifact(&req).expect("req").archived());
    assert!(store.is_effectively_archived(&req));
    assert_eq!(store.versions_of(&req).len(), 1);
    assert!(!store.approvals_of(&v1).is_empty());

    // Restoring the module does not restore individually archived items.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archive req");
    store
        .set_module_archived(&project, &module, false)
        .expect("restore module");
    assert!(store.artifact(&req).expect("req").archived());
    assert!(store.is_effectively_archived(&req));
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restore req");
    assert!(!store.is_effectively_archived(&req));
}

#[test]
fn writes_are_blocked_on_archived_elements() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);

    // New version over individually archived items.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archive");
    let before = store.clone();
    let err = store
        .create_version(
            &project,
            &req,
            Some(&v1),
            VersionId::new("req-1-v2").expect("id"),
            Content::new("cambio").expect("content"),
            &human("ana"),
            &[],
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    assert_eq!(store, before);

    // Create artifacts in an archived module.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restore");
    store
        .set_module_archived(&project, &module, true)
        .expect("archive module");
    let err = store
        .create_artifact(
            &project,
            &module,
            ArtifactId::new("req-2").expect("id"),
            ArtifactType::Requirement,
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedModule { .. }));

    // Approve under an archived module (archived by context).
    let err = store
        .approve(
            &project,
            &req,
            &v1,
            &human("bruno"),
            Date::new("2026-10-27").expect("date"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    assert_eq!(store.versions_of(&req).len(), 1);
}

#[test]
fn archived_source_blocks_approval_until_resolved() {
    let (mut store, project, module, req) = setup();
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flow");
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    let f1 = mk_version(
        &mut store,
        &project,
        &flow,
        "flujo-1-v1",
        std::slice::from_ref(&v1),
    );

    // Archiving the source blocks approving the active derivative.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archive source");
    let err = store
        .approve(
            &project,
            &flow,
            &f1,
            &human("bruno"),
            Date::new("2026-10-27").expect("date"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedSource { .. }));

    // Restoring the source unblocks the pending approval.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restore");
    approve(&mut store, &project, &req, &v1);
    approve(&mut store, &project, &flow, &f1);

    // Or a reviewed version without the archived source also resolves.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archive again");
    let f2 = mk_version(&mut store, &project, &flow, "flujo-1-v2", &[]);
    approve(&mut store, &project, &flow, &f2);
    assert!(store.is_approved(&f2));
}

#[test]
fn archived_entries_and_sources_block_baselines() {
    let (mut store, project, module, req) = setup();
    let v1 = mk_version(&mut store, &project, &req, "req-1-v1", &[]);
    approve(&mut store, &project, &req, &v1);

    // An archived entry does not enter a new baseline.
    store
        .set_artifact_archived(&project, &req, true)
        .expect("archive");
    let err = store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone())],
            Date::new("2026-10-27").expect("date"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));

    // Nor an active derivative with an archived source.
    store
        .set_artifact_archived(&project, &req, false)
        .expect("restore");
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flow");
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
        .expect("archive source");
    let err = store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone()), (flow.clone(), f1.clone())],
            Date::new("2026-10-27").expect("date"),
        )
        .expect_err("must fail");
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
        .expect("other");
    let o1 = mk_version(&mut store, &project, &other, "req-2-v1", &[]);

    let deleted = store.delete_artifact(&project, &req).expect("delete");
    assert_eq!(deleted, req);
    assert!(store.artifact(&req).is_none());
    assert!(store
        .version(&VersionId::new("req-1-v1").expect("id"))
        .is_none());
    assert!(store
        .version(&VersionId::new("req-1-v2").expect("id"))
        .is_none());
    assert!(store.versions_of(&req).is_empty());
    // Everything else stays intact.
    assert!(store.artifact(&other).is_some());
    assert_eq!(store.current_version(&other).expect("actual").id(), &o1);

    // Already-empty module: it is deleted too.
    store
        .delete_artifact(&project, &other)
        .expect("delete other");
    let removed = store
        .delete_module(&project, &module)
        .expect("delete module");
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
        .expect("flow");
    mk_version(
        &mut store,
        &project,
        &flow,
        "flujo-1-v1",
        std::slice::from_ref(&v1),
    );
    approve(&mut store, &project, &req, &v1);

    // With approval and dependent: blocks and states the reason.
    let before = store.clone();
    let err = store
        .delete_artifact(&project, &req)
        .expect_err("must fail");
    assert!(matches!(err, CoreError::DeleteHasApprovals { .. }));
    assert_eq!(store, before);

    // Without approvals but with a dependent: blocks naming it.
    let (mut plain, p2, m2, r2) = setup_plain();
    let w1 = mk_version(&mut plain, &p2, &r2, "req-9-v1", &[]);
    let f2 = ArtifactId::new("flujo-9").expect("id");
    plain
        .create_artifact(&p2, &m2, f2.clone(), ArtifactType::Flow)
        .expect("flow");
    mk_version(&mut plain, &p2, &f2, "flujo-9-v1", &[w1]);
    let err = plain.delete_artifact(&p2, &r2).expect_err("must fail");
    match err {
        CoreError::DeleteHasDependents { dependents, .. } => assert_eq!(dependents, vec![f2]),
        other => panic!("error inesperado: {other:?}"),
    }

    // In a baseline: blocks naming it.
    store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(req.clone(), v1.clone())],
            Date::new("2026-10-27").expect("date"),
        )
        .expect("baseline");
    let err = store
        .delete_artifact(&project, &req)
        .expect_err("must fail");
    assert!(matches!(
        err,
        CoreError::DeleteHasApprovals { .. } | CoreError::DeleteInBaseline { .. }
    ));

    // Module with content: blocks listing it.
    let err = store
        .delete_module(&project, &module)
        .expect_err("must fail");
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
    store.create_project(project.clone()).expect("project");
    store
        .create_module(&project, module.clone())
        .expect("module");
    store
        .create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)
        .expect("artifact");
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

#[test]
fn delete_project_only_when_empty_without_cascades() {
    let (mut store, project, module, req) = setup();
    // With a module (even archived): blocks naming it, without mutating.
    store
        .set_module_archived(&project, &module, true)
        .expect("archive");
    let before = store.clone();
    let err = store.delete_project(&project).expect_err("must fail");
    match err {
        CoreError::DeleteProjectNotEmpty { modules, .. } => {
            assert_eq!(modules, vec![module.clone()])
        }
        other => panic!("error inesperado: {other:?}"),
    }
    assert_eq!(store, before);

    // Fully empty: it is deleted and the rest stays intact.
    store
        .delete_artifact(&project, &req)
        .expect("delete requirement");
    store
        .delete_module(&project, &module)
        .expect("delete module");
    let removed = store.delete_project(&project).expect("delete project");
    assert_eq!(removed, project);
    assert!(store.project(&project).is_none());

    // Unknown: error, no panic.
    let ghost = ProjectId::new("proy-ghost").expect("id");
    let err = store.delete_project(&ghost).expect_err("must fail");
    assert!(matches!(err, CoreError::ProjectNotFound { .. }));
}
