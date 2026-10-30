//! Core invariants: history, approvals, dependencies, impact,
//! baselines y ausencia de mutaciones parciales ante errores.

use ruth_core::application::{Snapshot, Store};
use ruth_core::domain::{
    AgentId, ArtifactId, ArtifactType, Author, Baseline, BaselineId, Content, CoreError, Date,
    HumanId, ModuleId, ProjectId, Provenance, Version, VersionId,
};

fn ids(s: &str) -> (ProjectId, ModuleId, ArtifactId) {
    (
        ProjectId::new(format!("proy-{s}")).expect("id"),
        ModuleId::new(format!("mod-{s}")).expect("id"),
        ArtifactId::new(format!("req-{s}")).expect("id"),
    )
}

fn human(name: &str) -> Author {
    Author::Human(HumanId::new(name).expect("id"))
}

fn agent(name: &str) -> Author {
    Author::Agent(AgentId::new(name).expect("id"))
}

fn setup_artifact(s: &str) -> Result<(Store, ProjectId, ArtifactId), CoreError> {
    let (project, module, req) = ids(s);
    let mut store = Store::new();
    store.create_project(project.clone())?;
    store.create_module(&project, module.clone())?;
    store.create_artifact(&project, &module, req.clone(), ArtifactType::Requirement)?;
    Ok((store, project, req))
}

fn mk_version(
    store: &mut Store,
    project: &ProjectId,
    artifact: &ArtifactId,
    id: &str,
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
            &[],
        )
        .expect("version");
    vid
}

#[test]
fn history_is_immutable() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("a")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    let v2 = mk_version(&mut store, &project, &req, "v2");
    assert_eq!(
        store.version(&v1).expect("v1").content().as_str(),
        "contenido v1"
    );
    assert_eq!(store.version(&v1).expect("v1").number(), 1);
    assert_eq!(store.version(&v2).expect("v2").number(), 2);
    let numbers: Vec<u32> = store.versions_of(&req).iter().map(|v| v.number()).collect();
    assert_eq!(numbers, vec![1, 2]);
    Ok(())
}

#[test]
fn rejects_approval_of_obsolete_version() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("b")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-20")?)?;
    let v2 = mk_version(&mut store, &project, &req, "v2");
    let err = store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-21")?);
    assert_eq!(
        err,
        Err(CoreError::StaleVersion {
            expected: Some(v1),
            actual: Some(v2)
        })
    );
    Ok(())
}

#[test]
fn new_version_does_not_inherit_approvals() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("c")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-20")?)?;
    let v2 = mk_version(&mut store, &project, &req, "v2");
    assert_eq!(store.approvals_of(&v1).len(), 1);
    assert!(store.approvals_of(&v2).is_empty());
    assert!(!store.is_approved(&v2));
    Ok(())
}

#[test]
fn rejects_ai_self_approval() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("d")?;
    let agent_id = AgentId::new("agent-1")?;
    let draft = VersionId::new("draft-1")?;
    store.accept_ai_draft(
        &project,
        &req,
        None,
        draft.clone(),
        Content::new("borrador de IA")?,
        &agent_id,
        &[],
    )?;
    // Accepting incorporates a draft: it creates no approval.
    assert!(store.approvals_of(&draft).is_empty());
    // The agent cannot approve itself or anything.
    let itself = store.approve(
        &project,
        &req,
        &draft,
        &agent("agent-1"),
        Date::new("2026-10-20")?,
    );
    assert_eq!(
        itself,
        Err(CoreError::ApproverMustBeHuman {
            approver: AgentId::new("agent-1")?
        })
    );
    let other = store.approve(
        &project,
        &req,
        &draft,
        &agent("agent-2"),
        Date::new("2026-10-20")?,
    );
    assert!(matches!(other, Err(CoreError::ApproverMustBeHuman { .. })));
    // A person can approve the reviewed proposal.
    store.approve(
        &project,
        &req,
        &draft,
        &human("ana"),
        Date::new("2026-10-21")?,
    )?;
    assert!(store.is_approved(&draft));
    Ok(())
}

#[test]
fn rejects_duplicate_approval_by_same_human() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("e")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-20")?)?;
    let dup = store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-21")?);
    assert_eq!(
        dup,
        Err(CoreError::DuplicateApproval {
            version: v1.clone(),
            human: HumanId::new("ana")?
        })
    );
    store.approve(
        &project,
        &req,
        &v1,
        &human("bruno"),
        Date::new("2026-10-21")?,
    )?;
    assert_eq!(store.approvals_of(&v1).len(), 2);
    Ok(())
}

#[test]
fn rejects_missing_source_without_mutation() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("f")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    let before = store.clone();
    let missing = VersionId::new("no-existe")?;
    let err = store.create_version(
        &project,
        &req,
        Some(&v1),
        VersionId::new("v2")?,
        Content::new("x")?,
        &human("ana"),
        std::slice::from_ref(&missing),
    );
    assert_eq!(err, Err(CoreError::VersionNotFound { version: missing }));
    assert_eq!(store, before);
    Ok(())
}

#[test]
fn rejects_self_dependency_without_mutation() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("g")?;
    mk_version(&mut store, &project, &req, "v1");
    let before = store.clone();
    let id = VersionId::new("v2")?;
    let err = store.create_version(
        &project,
        &req,
        store
            .current_version(&req)
            .map(|v| v.id())
            .cloned()
            .as_ref(),
        id.clone(),
        Content::new("x")?,
        &human("ana"),
        std::slice::from_ref(&id),
    );
    assert_eq!(
        err,
        Err(CoreError::DependencyCycle {
            cycle: vec![id.clone(), id]
        })
    );
    assert_eq!(store, before);
    Ok(())
}

#[test]
fn rejects_cross_project_dependency() -> Result<(), CoreError> {
    let (store_a, project_a, req_a) = setup_artifact("h1")?;
    let (project_b, module_b, req_b) = ids("h2");
    let mut store = store_a;
    store.create_project(project_b.clone())?;
    store.create_module(&project_b, module_b.clone())?;
    store.create_artifact(
        &project_b,
        &module_b,
        req_b.clone(),
        ArtifactType::Requirement,
    )?;
    let src = mk_version(&mut store, &project_a, &req_a, "src-v1");
    let before = store.clone();
    let derived = VersionId::new("der-v1")?;
    let err = store.create_version(
        &project_b,
        &req_b,
        None,
        derived.clone(),
        Content::new("x")?,
        &human("ana"),
        std::slice::from_ref(&src),
    );
    assert_eq!(
        err,
        Err(CoreError::CrossProjectDependency {
            from: derived,
            to: src
        })
    );
    assert_eq!(store, before);
    Ok(())
}

#[test]
fn rejects_duplicate_source() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("i")?;
    let module = store.artifact(&req).expect("req").module().clone();
    let flow = ArtifactId::new("flujo-i")?;
    store.create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)?;
    let src = mk_version(&mut store, &project, &req, "src-v1");
    let err = store.create_version(
        &project,
        &flow,
        None,
        VersionId::new("flow-v1")?,
        Content::new("x")?,
        &human("ana"),
        &[src.clone(), src.clone()],
    );
    assert_eq!(err, Err(CoreError::DuplicateSource { source: src }));
    Ok(())
}

#[test]
fn generation_with_old_sources_is_kept_but_not_valid() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("j")?;
    let module = store.artifact(&req).expect("req").module().clone();
    let flow = ArtifactId::new("flujo-j")?;
    store.create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)?;
    let req_v1 = mk_version(&mut store, &project, &req, "req-v1");
    let req_v2 = mk_version(&mut store, &project, &req, "req-v2");
    // Creating with old sources is allowed: it explains a stale
    // generation; freshness is computed, not stored.
    let flow_v1 = VersionId::new("flujo-v1")?;
    store.create_version(
        &project,
        &flow,
        None,
        flow_v1.clone(),
        Content::new("generated with req v1")?,
        &human("ana"),
        std::slice::from_ref(&req_v1),
    )?;
    let validity = store.validity(&flow_v1)?;
    assert!(!validity.valid);
    assert_eq!(validity.stale_sources, vec![req_v1]);
    assert_eq!(store.requires_review(&project)?, vec![flow.clone()]);
    // ... but it cannot be approved until reviewed with current sources.
    let denied = store.approve(
        &project,
        &flow,
        &flow_v1,
        &human("ana"),
        Date::new("2026-10-20")?,
    );
    assert!(matches!(denied, Err(CoreError::VersionNotValid { .. })));
    let flow_v2 = VersionId::new("flujo-v2")?;
    store.create_version(
        &project,
        &flow,
        Some(&flow_v1),
        flow_v2.clone(),
        Content::new("reviewed with req v2")?,
        &human("ana"),
        &[req_v2],
    )?;
    assert!(store.validity(&flow_v2)?.valid);
    Ok(())
}

#[test]
fn stale_create_is_rejected_without_mutation() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("k")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    let before = store.clone();
    let err = store.create_version(
        &project,
        &req,
        None,
        VersionId::new("v2")?,
        Content::new("x")?,
        &human("ana"),
        &[],
    );
    assert_eq!(
        err,
        Err(CoreError::StaleVersion {
            expected: None,
            actual: Some(v1)
        })
    );
    assert_eq!(store, before);
    Ok(())
}

#[test]
fn enumerates_projects_modules_and_artifacts_in_order() -> Result<(), CoreError> {
    let mut store = Store::new();
    for name in ["b", "a"] {
        let project = ProjectId::new(format!("proy-{name}"))?;
        let module = ModuleId::new(format!("mod-{name}"))?;
        let req = ArtifactId::new(format!("req-{name}"))?;
        store.create_project(project.clone())?;
        store.create_module(&project, module.clone())?;
        store.create_artifact(&project, &module, req, ArtifactType::Requirement)?;
    }
    let projects: Vec<&str> = store.projects().iter().map(|p| p.id().as_str()).collect();
    assert_eq!(projects, vec!["proy-a", "proy-b"]);
    let modules: Vec<&str> = store
        .modules_of(&ProjectId::new("proy-a")?)
        .iter()
        .map(|m| m.id().as_str())
        .collect();
    assert_eq!(modules, vec!["mod-a"]);
    let artifacts: Vec<&str> = store
        .artifacts_of(&ProjectId::new("proy-a")?, &ModuleId::new("mod-a")?)
        .iter()
        .map(|a| a.id().as_str())
        .collect();
    assert_eq!(artifacts, vec!["req-a"]);
    Ok(())
}

fn snapshot_of(store: &Store) -> Snapshot {
    let mut modules = Vec::new();
    let mut artifacts = Vec::new();
    let mut versions = Vec::new();
    for project in store.projects() {
        for module in store.modules_of(project.id()) {
            for artifact in store.artifacts_of(project.id(), module.id()) {
                for version in store.versions_of(artifact.id()) {
                    versions.push((*version).clone());
                }
                artifacts.push((*artifact).clone());
            }
            modules.push((*module).clone());
        }
    }
    Snapshot {
        projects: store.projects().iter().map(|p| (*p).clone()).collect(),
        modules,
        artifacts,
        versions,
        approvals: store.approvals().iter().map(|a| (*a).clone()).collect(),
        baselines: store.baselines().iter().map(|b| (*b).clone()).collect(),
        title_history: store.title_changes().to_vec(),
        deliveries: store.deliveries().iter().map(|d| (*d).clone()).collect(),
    }
}

#[test]
fn reconstitute_roundtrip_preserves_store() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("r")?;
    let module = store.artifact(&req).expect("req").module().clone();
    let flow = ArtifactId::new("flujo-r")?;
    store.create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)?;
    let req_v1 = mk_version(&mut store, &project, &req, "req-v1");
    store.approve(
        &project,
        &req,
        &req_v1,
        &human("ana"),
        Date::new("2026-10-20")?,
    )?;
    let req_v2 = mk_version(&mut store, &project, &req, "req-v2");
    store.approve(
        &project,
        &req,
        &req_v2,
        &human("ana"),
        Date::new("2026-10-21")?,
    )?;
    let flow_v1 = VersionId::new("flujo-v1")?;
    store.create_version(
        &project,
        &flow,
        None,
        flow_v1.clone(),
        Content::new("derivado")?,
        &human("ana"),
        std::slice::from_ref(&req_v2),
    )?;
    store.approve(
        &project,
        &flow,
        &flow_v1,
        &human("bruno"),
        Date::new("2026-10-22")?,
    )?;
    store.create_baseline(
        &project,
        BaselineId::new("base-r")?,
        &[(req.clone(), req_v2), (flow, flow_v1)],
        Date::new("2026-10-23")?,
    )?;
    let restored = Store::reconstitute(snapshot_of(&store))?;
    assert_eq!(restored, store);
    Ok(())
}

#[test]
fn reconstitute_rejects_gap_in_numbers() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("s")?;
    mk_version(&mut store, &project, &req, "req-v1");
    mk_version(&mut store, &project, &req, "req-v2");
    let mut snapshot = snapshot_of(&store);
    snapshot.versions.retain(|v| v.number() != 1);
    let err = Store::reconstitute(snapshot).expect_err("must fail");
    assert_eq!(err, CoreError::NonConsecutiveVersions { artifact: req });
    Ok(())
}

#[test]
fn reconstitute_rejects_cycle() -> Result<(), CoreError> {
    let (store, project, req) = setup_artifact("t")?;
    let module = store.artifact(&req).expect("req").module().clone();
    let flow = ArtifactId::new("flujo-t")?;
    let req_v1 = VersionId::new("req-v1")?;
    let flow_v1 = VersionId::new("flujo-v1")?;
    let author = Provenance::Human(HumanId::new("ana")?);
    let snapshot = Snapshot {
        projects: vec![ruth_core::domain::Project::new(project.clone())],
        modules: vec![ruth_core::domain::Module::new(
            module.clone(),
            project.clone(),
        )],
        artifacts: vec![
            ruth_core::domain::Artifact::new(
                req.clone(),
                project.clone(),
                module.clone(),
                ArtifactType::Requirement,
            ),
            ruth_core::domain::Artifact::new(
                flow.clone(),
                project.clone(),
                module.clone(),
                ArtifactType::Flow,
            ),
        ],
        versions: vec![
            Version::new(
                req_v1.clone(),
                req.clone(),
                1,
                Content::new("a")?,
                author.clone(),
                vec![flow_v1.clone()],
            ),
            Version::new(
                flow_v1.clone(),
                flow.clone(),
                1,
                Content::new("b")?,
                author,
                vec![req_v1.clone()],
            ),
        ],
        approvals: vec![],
        baselines: vec![],
        title_history: vec![],
        deliveries: vec![],
    };
    let err = Store::reconstitute(snapshot).expect_err("must fail");
    assert!(
        matches!(err, CoreError::DependencyCycle { .. }),
        "era {err:?}"
    );
    Ok(())
}

#[test]
fn reconstitute_rejects_dangling_source() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("u")?;
    let v1 = mk_version(&mut store, &project, &req, "req-v1");
    let mut snapshot = snapshot_of(&store);
    snapshot.versions.push(Version::new(
        VersionId::new("req-v2")?,
        req.clone(),
        2,
        Content::new("broken")?,
        Provenance::Human(HumanId::new("ana")?),
        vec![VersionId::new("ghost")?],
    ));
    let err = Store::reconstitute(snapshot).expect_err("must fail");
    assert_eq!(
        err,
        CoreError::VersionNotFound {
            version: VersionId::new("ghost")?
        }
    );
    assert!(store.version(&v1).is_some());
    Ok(())
}

#[test]
fn reconstitute_rejects_duplicate_approval() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("v")?;
    let v1 = mk_version(&mut store, &project, &req, "req-v1");
    store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-20")?)?;
    let mut snapshot = snapshot_of(&store);
    let dup = snapshot.approvals[0].clone();
    snapshot.approvals.push(dup);
    let err = Store::reconstitute(snapshot).expect_err("must fail");
    assert!(
        matches!(err, CoreError::DuplicateApproval { .. }),
        "era {err:?}"
    );
    Ok(())
}

#[test]
fn reconstitute_rejects_baseline_without_closure() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("w")?;
    let module = store.artifact(&req).expect("req").module().clone();
    let flow = ArtifactId::new("flujo-w")?;
    store.create_artifact(&project, &module, flow.clone(), ArtifactType::Flow)?;
    let req_v1 = mk_version(&mut store, &project, &req, "req-v1");
    store.approve(
        &project,
        &req,
        &req_v1,
        &human("ana"),
        Date::new("2026-10-20")?,
    )?;
    let flow_v1 = VersionId::new("flujo-v1")?;
    store.create_version(
        &project,
        &flow,
        None,
        flow_v1.clone(),
        Content::new("derivado")?,
        &human("ana"),
        std::slice::from_ref(&req_v1),
    )?;
    store.approve(
        &project,
        &flow,
        &flow_v1,
        &human("ana"),
        Date::new("2026-10-21")?,
    )?;
    let mut snapshot = snapshot_of(&store);
    snapshot.baselines.push(Baseline::new(
        BaselineId::new("base-broken")?,
        project.clone(),
        vec![(flow.clone(), flow_v1.clone())],
        std::collections::HashMap::new(),
        Date::new("2026-10-22")?,
    ));
    let err = Store::reconstitute(snapshot).expect_err("must fail");
    assert!(
        matches!(err, CoreError::BaselineMissingSource { .. }),
        "era {err:?}"
    );
    Ok(())
}

#[test]
fn reconstitute_allows_historical_baseline() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("x")?;
    let v1 = mk_version(&mut store, &project, &req, "req-v1");
    store.approve(&project, &req, &v1, &human("ana"), Date::new("2026-10-20")?)?;
    mk_version(&mut store, &project, &req, "req-v2");
    let mut snapshot = snapshot_of(&store);
    // Historic: v1 is no longer current, but stays closed and approved.
    snapshot.baselines.push(Baseline::new(
        BaselineId::new("base-vieja")?,
        project.clone(),
        vec![(req.clone(), v1)],
        std::collections::HashMap::new(),
        Date::new("2026-10-21")?,
    ));
    let restored = Store::reconstitute(snapshot)?;
    assert_eq!(restored.baselines().len(), 1);
    Ok(())
}

#[test]
fn recalculating_does_not_mutate() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("l")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    let before = store.clone();
    let _ = store.validity(&v1)?;
    let _ = store.impact(&project, std::slice::from_ref(&req))?;
    let _ = store.requires_review(&project)?;
    let _ = store.versions_of(&req);
    let _ = store.approvals_of(&v1);
    assert_eq!(store, before);
    Ok(())
}

#[test]
fn baseline_rejects_incoherence_without_mutation() -> Result<(), CoreError> {
    let (mut store, project, req) = setup_artifact("m")?;
    let v1 = mk_version(&mut store, &project, &req, "v1");
    let v2 = mk_version(&mut store, &project, &req, "v2");
    let before = store.clone();

    let empty = store.create_baseline(&project, BaselineId::new("b0")?, &[], Date::new("d")?);
    assert_eq!(empty, Err(CoreError::EmptyBaseline));

    let dup = store.create_baseline(
        &project,
        BaselineId::new("b1")?,
        &[(req.clone(), v2.clone()), (req.clone(), v2.clone())],
        Date::new("d")?,
    );
    assert_eq!(
        dup,
        Err(CoreError::BaselineDuplicateArtifact {
            artifact: req.clone()
        })
    );

    let other = ArtifactId::new("other-m")?;
    let module = store.artifact(&req).expect("req").module().clone();
    store.create_artifact(&project, &module, other.clone(), ArtifactType::Flow)?;
    let unknown = store.create_baseline(
        &project,
        BaselineId::new("b2")?,
        &[(ArtifactId::new("ghost")?, v2.clone())],
        Date::new("d")?,
    );
    assert!(matches!(unknown, Err(CoreError::ArtifactNotFound { .. })));
    let mismatch = store.create_baseline(
        &project,
        BaselineId::new("b2b")?,
        &[(other.clone(), v2.clone())],
        Date::new("d")?,
    );
    assert_eq!(
        mismatch,
        Err(CoreError::BaselineMismatch {
            artifact: other,
            version: v2.clone()
        })
    );

    let not_current = store.create_baseline(
        &project,
        BaselineId::new("b3")?,
        &[(req.clone(), v1.clone())],
        Date::new("d")?,
    );
    assert_eq!(
        not_current,
        Err(CoreError::VersionNotCurrent {
            version: v1,
            current: v2.clone()
        })
    );

    let not_approved = store.create_baseline(
        &project,
        BaselineId::new("b4")?,
        &[(req.clone(), v2.clone())],
        Date::new("d")?,
    );
    assert_eq!(
        not_approved,
        Err(CoreError::VersionNotApproved {
            version: v2.clone()
        })
    );

    store.approve(&project, &req, &v2, &human("ana"), Date::new("2026-10-20")?)?;
    store.create_baseline(
        &project,
        BaselineId::new("b5")?,
        &[(req.clone(), v2)],
        Date::new("2026-10-21")?,
    )?;
    for missing in ["b0", "b1", "b2", "b2b", "b3", "b4"] {
        assert!(store.baseline(&BaselineId::new(missing)?).is_none());
    }
    assert!(store.baseline(&BaselineId::new("b5")?).is_some());
    assert_ne!(store, before, "only the valid baseline mutated state");
    Ok(())
}
