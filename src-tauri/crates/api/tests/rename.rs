//! Renaming without real I/O: the four kinds, validation, conflicts,
//! archiving and baseline-pinned titles.

use ruth_api::{
    ApproveVersionInput, CreateModuleInput, CreateRequirementInput, IdGen, RenameArtifactInput,
    RenameModuleInput, RenameProjectInput,
};
use ruth_core::application::Store;
use ruth_store::BaselineMetaLog;

const NOW: &str = "2026-10-28T10:00:00Z";

struct Baby {
    store: Store,
    project: String,
    module: String,
    req: String,
    v1: String,
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
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let detail = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Confirmar una venta descuenta stock.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement");
    let v1 = detail.current_version_id.clone();
    Baby {
        store,
        project,
        module,
        req: detail.artifact.id,
        v1,
    }
}

fn artifact_input(baby: &Baby, expected: Option<&str>, title: &str) -> RenameArtifactInput {
    RenameArtifactInput {
        project_id: baby.project.clone(),
        artifact_id: baby.req.clone(),
        expected_title: expected.map(str::to_string),
        title: title.to_string(),
        by: "ana".to_string(),
    }
}

#[test]
fn rename_project_module_and_requirement() {
    let mut baby = baby();
    let project = ruth_api::rename_project(
        &mut baby.store,
        RenameProjectInput {
            project_id: baby.project.clone(),
            expected_name: baby.project.clone(),
            name: "Ventas 2026".to_string(),
        },
    )
    .expect("project");
    assert_eq!(project.id, baby.project);
    assert_eq!(project.name, "Ventas 2026");
    let module = ruth_api::rename_module(
        &mut baby.store,
        RenameModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            expected_name: baby.module.clone(),
            name: "Mostrador".to_string(),
        },
    )
    .expect("module");
    assert_eq!(module.id, baby.module);
    assert_eq!(module.name, "Mostrador");
    let input = artifact_input(&baby, None, "Descontar stock");
    let detail = ruth_api::rename_requirement(&mut baby.store, input, NOW).expect("requirement");
    assert_eq!(detail.artifact.id, baby.req);
    assert_eq!(detail.artifact.title.as_deref(), Some("Descontar stock"));
    // No new versions or touched approvals.
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.current_version_id, baby.v1);
    assert!(detail.approvals.is_empty());
}

#[test]
fn rename_design_and_kind_checks() {
    let mut baby = baby();
    let flow = format!("{}-flow", baby.module);
    baby.store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
            ruth_core::domain::ArtifactId::new(flow.clone()).expect("id"),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flow");
    baby.store
        .create_version(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ArtifactId::new(flow.clone()).expect("id"),
            None,
            ruth_core::domain::VersionId::new(format!("{flow}-v1")).expect("id"),
            ruth_core::domain::Content::new("{\"nodes\":[]}").expect("content"),
            &ruth_core::domain::Author::Human(ruth_core::domain::HumanId::new("ana").expect("id")),
            &[],
        )
        .expect("version");
    let detail = ruth_api::rename_design(
        &mut baby.store,
        RenameArtifactInput {
            project_id: baby.project.clone(),
            artifact_id: flow.clone(),
            expected_title: None,
            title: "Flujo de caja".to_string(),
            by: "ana".to_string(),
        },
        NOW,
    )
    .expect("design");
    assert_eq!(detail.artifact.title.as_deref(), Some("Flujo de caja"));
    // Each command requires its kind.
    let input = artifact_input(&baby, None, "X");
    let err = ruth_api::rename_design(&mut baby.store, input, NOW)
        .expect_err("requirement is not a design");
    assert_eq!(err.kind, "not_a_design");
    let err = ruth_api::rename_requirement(
        &mut baby.store,
        RenameArtifactInput {
            project_id: baby.project.clone(),
            artifact_id: flow,
            expected_title: None,
            title: "X".to_string(),
            by: "ana".to_string(),
        },
        NOW,
    )
    .expect_err("design is not a requirement");
    assert_eq!(err.kind, "not_a_requirement");
}

#[test]
fn rename_validates_names_and_conflicts() {
    let mut baby = baby();
    let input = artifact_input(&baby, None, "   ");
    let err = ruth_api::rename_requirement(&mut baby.store, input, NOW).expect_err("empty");
    assert_eq!(err.kind, "empty_name");
    let err = ruth_api::rename_project(
        &mut baby.store,
        RenameProjectInput {
            project_id: baby.project.clone(),
            expected_name: baby.project.clone(),
            name: "x".repeat(121),
        },
    )
    .expect_err("long");
    assert_eq!(err.kind, "name_too_long");
    let input = artifact_input(&baby, None, "First");
    ruth_api::rename_requirement(&mut baby.store, input, NOW).expect("first");
    let before = baby.store.clone();
    let input = artifact_input(&baby, None, "Second");
    let err = ruth_api::rename_requirement(&mut baby.store, input, NOW).expect_err("stale");
    assert_eq!(err.kind, "stale_name");
    assert_eq!(baby.store, before);
}

#[test]
fn rename_is_blocked_on_archived_elements() {
    let mut baby = baby();
    baby.store
        .set_module_archived(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
            true,
        )
        .expect("archive");
    let err = ruth_api::rename_module(
        &mut baby.store,
        RenameModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
            expected_name: baby.module.clone(),
            name: "New".to_string(),
        },
    )
    .expect_err("archived module");
    assert_eq!(err.kind, "archived_module");
    let input = artifact_input(&baby, None, "New");
    let err =
        ruth_api::rename_requirement(&mut baby.store, input, NOW).expect_err("archived context");
    assert_eq!(err.kind, "archived_artifact");
}

#[test]
fn baseline_detail_serves_pinned_titles_not_latest() {
    let mut baby = baby();
    ruth_api::approve_version(
        &mut baby.store,
        ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: baby.v1.clone(),
            approver: "bruno".to_string(),
        },
        NOW,
    )
    .expect("approve");
    let input = artifact_input(&baby, None, "Original title");
    ruth_api::rename_requirement(&mut baby.store, input, NOW).expect("title");
    let project = ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id");
    let artifact = ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id");
    let version = ruth_core::domain::VersionId::new(baby.v1.clone()).expect("id");
    let baseline = baby
        .store
        .create_baseline(
            &project,
            ruth_core::domain::BaselineId::new("base-1").expect("id"),
            &[(artifact, version)],
            ruth_core::domain::Date::new("2026-10-28").expect("date"),
        )
        .expect("baseline");
    let mut metalog = BaselineMetaLog::new();
    metalog
        .record(ruth_store::BaselineMeta {
            baseline_id: baseline.id().as_str().to_string(),
            name: "Delivery 1".to_string(),
            description: None,
            scope_module: Some(baby.module.clone()),
            created_at: NOW.to_string(),
        })
        .expect("meta");
    // Renaming later does not move the historic one.
    let input = artifact_input(&baby, Some("Original title"), "New title");
    ruth_api::rename_requirement(&mut baby.store, input, NOW).expect("rename");
    let detail =
        ruth_api::get_baseline(&baby.store, &metalog, &baby.project, "base-1").expect("detail");
    assert_eq!(detail.entries.len(), 1);
    assert_eq!(detail.entries[0].title.as_deref(), Some("Original title"));
    assert_eq!(
        detail.entries[0].artifact.title.as_deref(),
        Some("New title"),
        "the artifact carries the current one; the pinned title rules"
    );
}
