//! Renaming: organizational names and titles as metadata separate from
//! content. No identity, version, source, approval or impact changes;
//! with title history and titles pinned in baselines.

use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, BaselineId, Content, CoreError, Date, HumanId, ModuleId,
    Name, ProjectId, VersionId,
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

fn rename(
    store: &mut Store,
    project: &ProjectId,
    artifact: &ArtifactId,
    expected: Option<&str>,
    title: &str,
) {
    store
        .rename_artifact(
            project,
            artifact,
            expected,
            Name::new(title.to_string()).expect("name"),
            &HumanId::new("ana").expect("id"),
            Date::new("2026-10-28").expect("date"),
        )
        .expect("rename");
}

#[test]
fn rename_all_four_kinds_without_touching_identity() {
    let (mut store, project, module, req) = setup();
    // Initial names = IDs.
    assert_eq!(store.project(&project).expect("p").name(), "proy-1");
    assert_eq!(store.module(&module).expect("m").name(), "mod-1");
    assert_eq!(store.artifact(&req).expect("a").title(), None);

    store
        .rename_project(
            &project,
            "proy-1",
            Name::new("Ventas 2026".to_string()).expect("n"),
        )
        .expect("project");
    store
        .rename_module(
            &project,
            &module,
            "mod-1",
            Name::new("Ventas mostrador".to_string()).expect("n"),
        )
        .expect("module");
    rename(
        &mut store,
        &project,
        &req,
        None,
        "Descontar stock al confirmar",
    );
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flow");
    rename(&mut store, &project, &flow, None, "Flujo de caja");

    assert_eq!(store.project(&project).expect("p").name(), "Ventas 2026");
    assert_eq!(store.module(&module).expect("m").name(), "Ventas mostrador");
    assert_eq!(
        store.artifact(&req).expect("a").title(),
        Some("Descontar stock al confirmar")
    );
    assert_eq!(
        store.artifact(&flow).expect("f").title(),
        Some("Flujo de caja")
    );
    // Identidades y pertenencias intactas.
    assert_eq!(store.project(&project).expect("p").id(), &project);
    assert_eq!(store.artifact(&req).expect("a").module(), &module);
    assert_eq!(store.modules_of(&project).len(), 1);
    assert_eq!(store.artifacts_of(&project, &module).len(), 2);
}

#[test]
fn rename_does_not_create_versions_or_invalidate_approvals() {
    let (mut store, project, _module, req) = setup();
    let v1 = VersionId::new("req-1-v1").expect("id");
    store
        .create_version(
            &project,
            &req,
            None,
            v1.clone(),
            Content::new("Confirmar una venta descuenta stock.").expect("c"),
            &human("ana"),
            &[],
        )
        .expect("v1");
    store
        .approve(
            &project,
            &req,
            &v1,
            &human("bruno"),
            Date::new("2026-10-28").expect("f"),
        )
        .expect("approve");
    rename(&mut store, &project, &req, None, "Descontar stock");
    rename(
        &mut store,
        &project,
        &req,
        Some("Descontar stock"),
        "Descontar stock v2",
    );

    // Ni versiones nuevas, ni aprobaciones tocadas.
    assert_eq!(store.versions_of(&req).len(), 1);
    assert_eq!(store.current_version(&req).expect("v").id(), &v1);
    assert!(store.is_approved(&v1));
    assert_eq!(store.approvals_of(&v1).len(), 1);
    // Title history recorded in order.
    let history: Vec<&str> = store
        .title_history(&req)
        .iter()
        .map(|c| c.title())
        .collect();
    assert_eq!(history, vec!["Descontar stock", "Descontar stock v2"]);
}

#[test]
fn rename_does_not_create_impact_and_allows_duplicates() {
    let (mut store, project, module, req) = setup();
    let flow = ArtifactId::new("flujo-1").expect("id");
    store
        .create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)
        .expect("flow");
    let v1 = VersionId::new("req-1-v1").expect("id");
    store
        .create_version(
            &project,
            &req,
            None,
            v1.clone(),
            Content::new("Contenido.").expect("c"),
            &human("ana"),
            &[],
        )
        .expect("v1");
    store
        .create_version(
            &project,
            &flow,
            None,
            VersionId::new("flujo-1-v1").expect("id"),
            Content::new("{\"nodes\":[]}").expect("c"),
            &human("ana"),
            std::slice::from_ref(&v1),
        )
        .expect("f1");
    // Same title on two artifacts: allowed, identity wins.
    rename(&mut store, &project, &req, None, "Ventas");
    rename(&mut store, &project, &flow, None, "Ventas");
    // Without new versions there is no impact to compute.
    assert_eq!(store.versions_of(&req).len(), 1);
    assert_eq!(store.versions_of(&flow).len(), 1);
    assert!(store.validity(&v1).expect("v").valid);
}

#[test]
fn names_are_validated_and_trimmed() {
    assert!(matches!(
        Name::new("".to_string()),
        Err(CoreError::EmptyName)
    ));
    assert!(matches!(
        Name::new("   ".to_string()),
        Err(CoreError::EmptyName)
    ));
    let long = "x".repeat(Name::MAX_CHARS + 1);
    assert!(matches!(
        Name::new(long),
        Err(CoreError::NameTooLong { .. })
    ));
    assert_eq!(
        Name::new("  Ventas  ".to_string()).expect("n").as_str(),
        "Ventas"
    );
    assert_eq!(Name::MAX_CHARS, 120);
}

#[test]
fn rename_rejects_stale_expectations_without_mutating() {
    let (mut store, project, _module, req) = setup();
    rename(&mut store, &project, &req, None, "Primero");
    let before = store.clone();
    let err = store
        .rename_artifact(
            &project,
            &req,
            None,
            Name::new("Segundo".to_string()).expect("n"),
            &HumanId::new("ana").expect("id"),
            Date::new("2026-10-28").expect("f"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::StaleName { .. }));
    assert_eq!(store, before);
    // Same project and module, with expected names.
    let err = store
        .rename_project(&project, "other", Name::new("New".to_string()).expect("n"))
        .expect_err("must fail");
    assert!(matches!(err, CoreError::StaleName { .. }));
    assert_eq!(store, before);
}

#[test]
fn rename_is_blocked_on_archived_elements() {
    let (mut store, project, module, req) = setup();
    store
        .set_module_archived(&project, &module, true)
        .expect("archive");
    let err = store
        .rename_module(
            &project,
            &module,
            "mod-1",
            Name::new("New".to_string()).expect("n"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedModule { .. }));
    // By context it blocks the artifact too.
    let err = store
        .rename_artifact(
            &project,
            &req,
            None,
            Name::new("New".to_string()).expect("n"),
            &HumanId::new("ana").expect("id"),
            Date::new("2026-10-28").expect("f"),
        )
        .expect_err("must fail");
    assert!(matches!(err, CoreError::ArchivedArtifact { .. }));
    // Restoring unlocks.
    store
        .set_module_archived(&project, &module, false)
        .expect("restore");
    rename(&mut store, &project, &req, None, "New");
}

#[test]
fn baselines_pin_titles_and_ignore_later_renames() {
    let (mut store, project, _module, req) = setup();
    let v1 = VersionId::new("req-1-v1").expect("id");
    store
        .create_version(
            &project,
            &req,
            None,
            v1.clone(),
            Content::new("Confirmar una venta descuenta stock.").expect("c"),
            &human("ana"),
            &[],
        )
        .expect("v1");
    store
        .approve(
            &project,
            &req,
            &v1,
            &human("bruno"),
            Date::new("2026-10-28").expect("f"),
        )
        .expect("approve");
    rename(&mut store, &project, &req, None, "Original title");
    let base = BaselineId::new("base-1").expect("id");
    store
        .create_baseline(
            &project,
            base.clone(),
            &[(req.clone(), v1)],
            Date::new("2026-10-28").expect("f"),
        )
        .expect("baseline");
    rename(
        &mut store,
        &project,
        &req,
        Some("Original title"),
        "New title",
    );

    let baseline = store.baseline(&base).expect("b");
    assert_eq!(baseline.title_of(&req), Some(Some("Original title")));
    assert_eq!(store.artifact(&req).expect("a").title(), Some("New title"));
}

#[test]
fn delete_removes_title_history_with_the_artifact() {
    let (mut store, project, _module, req) = setup();
    rename(&mut store, &project, &req, None, "Temporal");
    assert_eq!(store.title_history(&req).len(), 1);
    store.delete_artifact(&project, &req).expect("delete");
    assert!(store.title_history(&req).is_empty());
}
