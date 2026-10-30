//! Archiving and deletion without real I/O: the advance summary, execution
//! with revalidation and the generation, baseline and update blockers.

use ruth_api::{
    ArchiveModuleInput, ArchivePreviewInput, ArchiveRequirementInput, CreateModuleInput,
    CreateRequirementInput, DeleteModuleInput, DeleteProjectInput, DeleteRequirementInput, IdGen,
};
use ruth_core::application::Store;
use ruth_store::{
    BaselineMetaLog, CodeLinkLog, CodeRootLog, DesignLog, ProposalLog, ProposalState,
    StoredDesignGeneration, StoredDesignProposal, StoredGeneration, StoredProposal,
};

struct Baby {
    store: Store,
    ids: IdGen,
    proposals: ProposalLog,
    designs: DesignLog,
    metalog: BaselineMetaLog,
    links: CodeLinkLog,
    roots: CodeRootLog,
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
        ids,
        proposals: ProposalLog::new(),
        designs: DesignLog::new(),
        metalog: BaselineMetaLog::new(),
        links: CodeLinkLog::new(),
        roots: CodeRootLog::new(),
        project,
        module,
        req: detail.artifact.id,
        v1,
    }
}

fn generation(id: &str, project: &str, module: &str, context: Vec<String>) -> StoredGeneration {
    StoredGeneration {
        id: id.to_string(),
        project_id: project.to_string(),
        module_id: module.to_string(),
        model: "muse-spark-1.3".to_string(),
        description: "Ventas.".to_string(),
        context_version_ids: context,
        template_version: 1,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "2026-10-27T12:00:00Z".to_string(),
        questions: vec![],
        proposals: vec![StoredProposal {
            temp_id: "p1".to_string(),
            title: "Title".to_string(),
            description: "Description".to_string(),
            acceptance: vec!["Criterion".to_string()],
            assumptions: vec![],
            state: ProposalState::Pending,
        }],
    }
}

fn design_generation(
    id: &str,
    project: &str,
    module: &str,
    context: Vec<String>,
    target: Option<(&str, &str)>,
) -> StoredDesignGeneration {
    StoredDesignGeneration {
        id: id.to_string(),
        project_id: project.to_string(),
        module_id: module.to_string(),
        kind: "flow".to_string(),
        model: "muse-spark-1.3".to_string(),
        context_version_ids: context,
        template_version: 2,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "2026-10-27T12:00:00Z".to_string(),
        questions: vec![],
        proposal: StoredDesignProposal {
            title: "Flujo".to_string(),
            spec_json: "{\"nodes\":[]}".to_string(),
            explanation: "Explanation".to_string(),
            state: ProposalState::Pending,
        },
        target_artifact_id: target.map(|(a, _)| a.to_string()),
        target_version_id: target.map(|(_, v)| v.to_string()),
    }
}

fn preview_input(project: &str, kind: &str, id: &str) -> ArchivePreviewInput {
    ArchivePreviewInput {
        project_id: project.to_string(),
        kind: kind.to_string(),
        id: id.to_string(),
    }
}

#[test]
fn preview_reports_contents_dependents_and_generations() {
    let baby = baby();
    // The module summary lists its content; the unreferenced draft
    // can be deleted.
    let module = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "module", &baby.module),
    )
    .expect("summary");
    assert_eq!(module.contents.len(), 1);
    assert_eq!(module.contents[0].id, baby.req);
    assert!(!module.can_delete);
    assert!(module
        .delete_blockers
        .iter()
        .any(|b| b.code == "delete_module_not_empty"));
    let req = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("summary");
    assert_eq!(req.versions, 1);
    assert_eq!(req.approvals, 0);
    assert!(req.can_delete);
}

#[test]
fn preview_shows_external_dependents_and_generation_roles() {
    let mut baby = baby();
    // Second module with a design depending on the requirement (external).
    let other = ruth_api::create_module(
        &mut baby.store,
        &mut baby.ids,
        CreateModuleInput {
            project_id: baby.project.clone(),
        },
    )
    .expect("module")
    .id;
    let flow = format!("{other}-flow");
    baby.store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(other.clone()).expect("id"),
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
            &[ruth_core::domain::VersionId::new(baby.v1.clone()).expect("id")],
        )
        .expect("version");
    // Generation citing it in context + update aimed at it.
    baby.proposals
        .record(generation(
            "gen-1",
            &baby.project,
            &baby.module,
            vec![baby.v1.clone()],
        ))
        .expect("record");
    baby.designs
        .record(design_generation(
            "gen-d1",
            &baby.project,
            &other,
            vec![],
            Some((baby.req.as_str(), baby.v1.as_str())),
        ))
        .expect("record design");
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("summary");
    assert_eq!(preview.dependents.len(), 1);
    assert!(!preview.dependents[0].same_module);
    let roles: Vec<(&str, &str)> = preview
        .generations
        .iter()
        .map(|g| (g.log.as_str(), g.role.as_str()))
        .collect();
    assert!(roles.contains(&("requirement", "context")));
    assert!(roles.contains(&("design", "target")));
    assert!(!preview.can_delete);
    let codes: Vec<&str> = preview
        .delete_blockers
        .iter()
        .map(|b| b.code.as_str())
        .collect();
    assert!(codes.contains(&"delete_has_dependents"));
    assert!(codes.contains(&"delete_has_generations"));
}

#[test]
fn archive_restore_and_delete_roundtrip() {
    let mut baby = baby();
    // Archiving returns the authoritative detail with the flag.
    let archived = ruth_api::archive_requirement(
        &mut baby.store,
        ArchiveRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("archive");
    assert!(archived.artifact.archived);
    assert_eq!(archived.versions.len(), 1);
    // Restoring returns it to active.
    let restored = ruth_api::restore_requirement(
        &mut baby.store,
        ArchiveRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("restore");
    assert!(!restored.artifact.archived);
    // Deleting an unreferenced draft removes it entirely.
    let deleted = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.links,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("delete");
    assert_eq!(deleted, baby.req);
    assert!(baby
        .store
        .artifact(&ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id"))
        .is_none());
    // And the empty module is deleted too.
    let removed = ruth_api::delete_module_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        DeleteModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("delete module");
    assert_eq!(removed, baby.module);
}

#[test]
fn archive_module_roundtrip() {
    let mut baby = baby();
    let archived = ruth_api::archive_module(
        &mut baby.store,
        ArchiveModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("archive");
    assert!(archived.archived);
    let restored = ruth_api::restore_module(
        &mut baby.store,
        ArchiveModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("restore");
    assert!(!restored.archived);
}

#[test]
fn delete_execution_revalidates_and_keeps_state_on_failure() {
    let mut baby = baby();
    baby.proposals
        .record(generation(
            "gen-1",
            &baby.project,
            &baby.module,
            vec![baby.v1.clone()],
        ))
        .expect("record");
    // Execution revalidates: the in-context reference blocks.
    let before = baby.store.clone();
    let err = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.links,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_has_generations");
    assert_eq!(baby.store, before);
    // The module with own generations is not deleted either.
    let err = ruth_api::delete_module_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        DeleteModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect_err("must fail");
    assert!(
        err.kind == "delete_has_generations" || err.kind == "delete_module_not_empty",
        "kind inesperado: {}",
        err.kind
    );
}

#[test]
fn accepted_proposal_blocks_delete_of_created_draft() {
    let mut baby = baby();
    let mut generation = generation("gen-1", &baby.project, &baby.module, vec![]);
    generation.proposals[0].state = ProposalState::Accepted {
        artifact_id: baby.req.clone(),
        content: "accepted content".to_string(),
    };
    baby.proposals.record(generation).expect("record");
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("summary");
    assert!(
        preview.generations.iter().any(|g| g.role == "accepted"),
        "the acceptance must appear in the summary"
    );
    assert!(!preview.can_delete);
    let err = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.links,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_has_generations");
}

#[test]
fn archived_module_blocks_generation_and_approval_paths() {
    let mut baby = baby();
    baby.store
        .set_module_archived(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
            true,
        )
        .expect("archive");
    // Generation context over an archived module is rejected.
    let err = ruth_api::snapshot_context(&baby.store, &baby.project, &baby.module)
        .expect_err("must fail");
    assert_eq!(err.kind, "archived_module");
    // Saving a version under the archived module too.
    let err = ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: baby.v1.clone(),
            content: "change".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "archived_artifact");
    // And approving the same.
    let err = ruth_api::approve_version(
        &mut baby.store,
        ruth_api::ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: baby.v1.clone(),
            approver: "bruno".to_string(),
        },
        "2026-10-27T10:00:00Z",
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "archived_artifact");
}

#[test]
fn baseline_prepare_reports_archived_blockers() {
    let mut baby = baby();
    ruth_api::approve_version(
        &mut baby.store,
        ruth_api::ApproveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: baby.v1.clone(),
            approver: "bruno".to_string(),
        },
        "2026-10-27T10:00:00Z",
    )
    .expect("approve");
    baby.store
        .set_artifact_archived(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id"),
            true,
        )
        .expect("archive");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        ruth_api::BaselinePrepareInput {
            project_id: baby.project.clone(),
            scope_module_id: baby.module.clone(),
            artifact_ids: vec![baby.req.clone()],
        },
    )
    .expect("prepare");
    assert!(!preview.can_create);
    assert!(
        preview.blockers.iter().any(|b| b.code == "archived"),
        "the archived entry must block: {:?}",
        preview.blockers
    );
}

fn module_link(id: &str, owner: &str) -> ruth_store::StoredCodeLink {
    ruth_store::StoredCodeLink {
        id: id.to_string(),
        scope: ruth_store::LinkScope::Module,
        owner_id: owner.to_string(),
        root_id: "root-1".to_string(),
        rel: "src".to_string(),
        symbol: None,
        kind: ruth_store::LinkKind::Manual,
        created_at: "t".to_string(),
    }
}

fn symbol_link(id: &str, owner: &str) -> ruth_store::StoredCodeLink {
    ruth_store::StoredCodeLink {
        id: id.to_string(),
        scope: ruth_store::LinkScope::Artifact,
        owner_id: owner.to_string(),
        root_id: "root-1".to_string(),
        rel: "src/a.ts".to_string(),
        symbol: Some(ruth_store::SymbolRef {
            id: "s1".to_string(),
            name: "A".to_string(),
            kind: "class".to_string(),
            start_line: 1,
            start_col: 1,
            end_line: 2,
            end_col: 1,
            hash: "ab12".to_string(),
        }),
        kind: ruth_store::LinkKind::Detected,
        created_at: "t".to_string(),
    }
}

#[test]
fn preview_shows_links_and_delete_requires_unlinking() {
    let mut baby = baby();
    baby.links
        .record(module_link("link-1", &baby.module.clone()))
        .expect("module link");
    baby.links
        .record(symbol_link("link-2", &baby.req.clone()))
        .expect("symbol link");
    let module = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "module", &baby.module),
    )
    .expect("module summary");
    assert_eq!(module.code_links.len(), 1);
    assert_eq!(module.code_links[0].kind, "manual");
    assert!(
        module
            .delete_blockers
            .iter()
            .any(|b| b.code == "delete_has_code_links"),
        "the linked module must block: {:?}",
        module.delete_blockers
    );
    let req = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("requirement summary");
    assert_eq!(req.code_links.len(), 1);
    assert_eq!(req.code_links[0].symbol_name.as_deref(), Some("A"));
    assert!(!req.can_delete);
    let err = ruth_api::delete_module_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        DeleteModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_has_code_links");
    let err = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.links,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_has_code_links");
}

#[test]
fn preview_project_lists_modules_and_blocks_until_empty_and_unbound() {
    let mut baby = baby();
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&baby.project, "project", &baby.project),
    )
    .expect("summary");
    assert_eq!(preview.kind, "project");
    assert_eq!(preview.modules.len(), 1);
    assert_eq!(preview.modules[0].id, baby.module);
    assert!(!preview.can_delete);
    assert!(preview
        .delete_blockers
        .iter()
        .any(|b| b.code == "delete_project_not_empty"));

    // Empty but with a bound folder: blocked by the roots.
    let lonely = ruth_api::create_project(&mut baby.store, &mut baby.ids)
        .expect("project")
        .id;
    baby.roots.rehydrate(
        "root-1".to_string(),
        "/tmp/fe".to_string(),
        "fe".to_string(),
        Some(lonely.clone()),
    );
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        &baby.links,
        &baby.roots,
        preview_input(&lonely, "project", &lonely),
    )
    .expect("summary");
    assert!(preview.modules.is_empty());
    assert!(!preview.can_delete);
    let blocker = preview
        .delete_blockers
        .iter()
        .find(|b| b.code == "delete_has_roots")
        .expect("blocked by roots");
    assert!(blocker.message.contains("fe"), "{}", blocker.message);
}

#[test]
fn delete_project_checked_only_empty_unbound_and_unreferenced() {
    let mut baby = baby();
    let delete = |store: &mut ruth_core::application::Store,
                  proposals: &ruth_store::ProposalLog,
                  designs: &ruth_store::DesignLog,
                  roots: &ruth_store::CodeRootLog,
                  project_id: String| {
        ruth_api::delete_project_checked(
            store,
            proposals,
            designs,
            roots,
            DeleteProjectInput { project_id },
        )
    };
    // With modules: blocks without mutating.
    let err = delete(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.roots,
        baby.project.clone(),
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_project_not_empty");

    // Empty but with a bound folder: blocked by the roots.
    let lonely = ruth_api::create_project(&mut baby.store, &mut baby.ids)
        .expect("project")
        .id;
    baby.roots.rehydrate(
        "root-1".to_string(),
        "/tmp/fe".to_string(),
        "fe".to_string(),
        Some(lonely.clone()),
    );
    let err = delete(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.roots,
        lonely.clone(),
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "delete_has_roots");

    // Empty and loose: deleted.
    let other = ruth_api::create_project(&mut baby.store, &mut baby.ids)
        .expect("project")
        .id;
    let removed = delete(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.roots,
        other.clone(),
    )
    .expect("delete project");
    assert_eq!(removed, other);

    // Unknown: stable error.
    let err = delete(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.roots,
        "proy-ghost".to_string(),
    )
    .expect_err("must fail");
    assert_eq!(err.kind, "project_not_found");
}
