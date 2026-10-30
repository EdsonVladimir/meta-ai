//! Impact report over the core, no network or persistence: the
//! sales scenario builds with use cases and the report only reads.

use ruth_api::{
    ApproveVersionInput, CreateModuleInput, CreateRequirementInput, IdGen, ImpactQueryInput,
    SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_core::domain::{
    ArtifactId, ArtifactType, Author, Content, HumanId, ModuleId, ProjectId, VersionId,
};

const AT: &str = "2026-10-28T12:00:00Z";

struct Baby {
    store: Store,
    ids: IdGen,
    project: ProjectId,
    module: ModuleId,
    req: ArtifactId,
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
            CreateModuleInput {
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
    Baby {
        store,
        ids,
        project,
        module,
        req,
    }
}

fn author() -> Author {
    Author::Human(HumanId::new("ana").expect("author"))
}

/// New version of the artifact with the given exact sources.
fn save_with_sources(
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

fn design(baby: &mut Baby, kind: ArtifactType, sources: &[VersionId]) -> ArtifactId {
    let id = match kind {
        ArtifactType::Flow => baby.ids.flow(),
        ArtifactType::DataModel => baby.ids.data_model(),
        ArtifactType::Requirement => baby.ids.requirement(),
        ArtifactType::Mockup => baby.ids.mockup(),
    };
    baby.store
        .create_artifact(&baby.project, &baby.module, id.clone(), kind)
        .expect("artifact");
    save_with_sources(baby, &id, 1, "{}", sources);
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
        AT,
    )
    .expect("approve");
}

fn query(baby: &Baby, from: Option<&str>) -> ruth_api::ImpactReportDto {
    ruth_api::impact_report(
        &baby.store,
        ImpactQueryInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            from_version_id: from.map(str::to_string),
        },
    )
    .expect("report")
}

fn sales_with_designs() -> (Baby, ArtifactId, ArtifactId) {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let req = baby.req.clone();
    approve(&mut baby, &req, &req_v1);
    let flow = design(&mut baby, ArtifactType::Flow, std::slice::from_ref(&req_v1));
    let flow_v1 = IdGen::version(&flow, 1);
    approve(&mut baby, &flow, &flow_v1);
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        std::slice::from_ref(&req_v1),
    );
    let mer_v1 = IdGen::version(&mer, 1);
    approve(&mut baby, &mer, &mer_v1);
    // Change the rule: new version of the requirement.
    let detail = ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Reservar unidades antes de confirmar; cancelar libera la reserva."
                .to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    assert_eq!(
        detail.current_version_id,
        IdGen::version(&baby.req, 2).as_str()
    );
    (baby, flow, mer)
}

#[test]
fn direct_impact_lists_pins_and_paths() {
    let (baby, flow, mer) = sales_with_designs();
    let report = query(&baby, None);
    assert_eq!(report.origin.from_version.number, 1);
    assert_eq!(report.origin.current_version.number, 2);
    assert_eq!(report.affected.len(), 2);

    let flow_dto = report
        .affected
        .iter()
        .find(|a| a.artifact.id == flow.as_str())
        .expect("flow");
    assert!(flow_dto.requires_review);
    assert_eq!(flow_dto.current_number, 1);
    assert_eq!(
        flow_dto.stale_sources,
        vec![IdGen::version(&baby.req, 1).as_str().to_string()]
    );
    assert_eq!(flow_dto.pins.len(), 1);
    let pin = &flow_dto.pins[0];
    assert_eq!(
        pin.used_version_id.as_str(),
        IdGen::version(&baby.req, 1).as_str()
    );
    assert_eq!(pin.source_artifact_id.as_deref(), Some(baby.req.as_str()));
    assert_eq!(
        pin.current_version_id.as_deref(),
        Some(IdGen::version(&baby.req, 2).as_str())
    );
    assert!(pin.stale);
    assert_eq!(
        flow_dto.paths,
        vec![vec![
            baby.req.as_str().to_string(),
            flow.as_str().to_string()
        ]]
    );
    // The approved v1 stays approved; the current one (v1) has no new
    // approvals and the report shows both facts.
    assert!(flow_dto.approved_before);
    assert_eq!(flow_dto.approvals.len(), 1);

    let mer_dto = report
        .affected
        .iter()
        .find(|a| a.artifact.id == mer.as_str())
        .expect("erm");
    assert!(mer_dto.requires_review);
    assert_eq!(mer_dto.paths.len(), 1);
}

#[test]
fn transitive_impact_reaches_two_levels() {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let flow = design(&mut baby, ArtifactType::Flow, std::slice::from_ref(&req_v1));
    let flow_v1 = IdGen::version(&flow, 1);
    // The model derives from the flow, not from the requirement.
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        std::slice::from_ref(&flow_v1),
    );
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

    let report = query(&baby, None);
    assert_eq!(report.affected.len(), 2);
    let mer_dto = report
        .affected
        .iter()
        .find(|a| a.artifact.id == mer.as_str())
        .expect("erm");
    assert_eq!(
        mer_dto.paths,
        vec![vec![
            baby.req.as_str().to_string(),
            flow.as_str().to_string(),
            mer.as_str().to_string()
        ]]
    );
    // The model's pin still points to the flow's current one: reached by
    // the change (impact) even though its pin is not stale.
    assert!(!mer_dto.requires_review);
    assert!(mer_dto.pins.iter().all(|p| !p.stale));
}

#[test]
fn diamond_keeps_every_path() {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    let flow = design(&mut baby, ArtifactType::Flow, std::slice::from_ref(&req_v1));
    let flow_v1 = IdGen::version(&flow, 1);
    let mer = design(
        &mut baby,
        ArtifactType::DataModel,
        std::slice::from_ref(&req_v1),
    );
    let mer_v1 = IdGen::version(&mer, 1);
    let report = design(&mut baby, ArtifactType::Flow, &[flow_v1, mer_v1]);
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

    let impact = query(&baby, None);
    let report_dto = impact
        .affected
        .iter()
        .find(|a| a.artifact.id == report.as_str())
        .expect("report");
    assert_eq!(report_dto.paths.len(), 2);
    // A single log even with several paths: no duplicates.
    assert_eq!(
        impact
            .affected
            .iter()
            .filter(|a| a.artifact.id == report.as_str())
            .count(),
        1
    );
}

#[test]
fn requirement_without_dependents_reports_empty() {
    let mut baby = baby();
    let req_v1 = IdGen::version(&baby.req, 1);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v1.as_str().to_string(),
            content: "Second wording.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v2");
    let report = query(&baby, None);
    assert!(report.affected.is_empty());
    assert_eq!(report.origin.from_version.number, 1);
    assert_eq!(report.origin.current_version.number, 2);
}

#[test]
fn updated_design_is_related_but_not_pending() {
    let (mut baby, flow, mer) = sales_with_designs();
    // The flow reviews with the current source; the model does not.
    let req_v2 = IdGen::version(&baby.req, 2);
    save_with_sources(
        &mut baby,
        &flow,
        2,
        "{\"v\":2}",
        std::slice::from_ref(&req_v2),
    );

    let report = query(&baby, None);
    let flow_dto = report
        .affected
        .iter()
        .find(|a| a.artifact.id == flow.as_str())
        .expect("flow");
    assert!(!flow_dto.requires_review);
    assert!(flow_dto.stale_sources.is_empty());
    assert!(flow_dto.approved_before);
    assert!(flow_dto.approvals.is_empty());
    let mer_dto = report
        .affected
        .iter()
        .find(|a| a.artifact.id == mer.as_str())
        .expect("erm");
    assert!(mer_dto.requires_review);
}

#[test]
fn explicit_from_version_compares() {
    let (mut baby, _, _) = sales_with_designs();
    let req_v2 = IdGen::version(&baby.req, 2);
    ruth_api::save_version(
        &mut baby.store,
        SaveVersionInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            expected_version_id: req_v2.as_str().to_string(),
            content: "Third wording.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("v3");
    let report = query(&baby, Some(IdGen::version(&baby.req, 1).as_str()));
    assert_eq!(report.origin.from_version.number, 1);
    assert_eq!(report.origin.current_version.number, 3);
    assert!(report
        .origin
        .from_version
        .content
        .contains("descuenta stock"));
}

#[test]
fn single_version_compares_with_itself() {
    let baby = baby();
    let report = query(&baby, None);
    assert_eq!(
        report.origin.from_version.id,
        report.origin.current_version.id
    );
    assert!(report.affected.is_empty());
}

#[test]
fn invalid_references_fail_with_stable_kinds() {
    let mut baby = self::baby();
    let second = ruth_api::create_project(&mut baby.store, &mut baby.ids).expect("second");
    let err = ruth_api::impact_report(
        &baby.store,
        ImpactQueryInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: "req-404".to_string(),
            from_version_id: None,
        },
    )
    .expect_err("missing artifact");
    assert_eq!(err.kind, "artifact_not_found");

    let err = ruth_api::impact_report(
        &baby.store,
        ImpactQueryInput {
            project_id: baby.project.as_str().to_string(),
            artifact_id: baby.req.as_str().to_string(),
            from_version_id: Some("req-9-v9".to_string()),
        },
    )
    .expect_err("foreign version");
    assert_eq!(err.kind, "version_not_found");

    let err = ruth_api::impact_report(
        &baby.store,
        ImpactQueryInput {
            project_id: second.id,
            artifact_id: baby.req.as_str().to_string(),
            from_version_id: None,
        },
    )
    .expect_err("other project");
    assert_eq!(err.kind, "artifact_not_in_project");
}

#[test]
fn query_does_not_mutate() {
    let (baby, _, _) = sales_with_designs();
    let before = format!("{:?}", baby.store);
    let first = query(&baby, None);
    let after = format!("{:?}", baby.store);
    assert_eq!(before, after);
    let second = query(&baby, None);
    assert_eq!(first, second);
}

#[test]
fn pins_always_resolve_on_valid_state() {
    // Invariants forbid dangling sources (rejected at creation and
    // reconstitution), so every pin resolves to artifact and current.
    let (baby, _, _) = sales_with_designs();
    let report = query(&baby, None);
    assert!(!report.affected.is_empty());
    for item in &report.affected {
        for pin in &item.pins {
            assert!(pin.source_artifact_id.is_some());
            assert!(pin.current_version_id.is_some());
        }
    }
}
