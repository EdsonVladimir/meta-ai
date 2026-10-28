//! Archivo y borrado sin E/S real: el resumen previo, la ejecución con
//! revalidación y los bloqueos de generaciones, baselines y actualizaciones.

use ruth_api::{
    ArchiveModuleInput, ArchivePreviewInput, ArchiveRequirementInput, CreateModuleInput,
    CreateRequirementInput, DeleteModuleInput, DeleteRequirementInput, IdGen,
};
use ruth_core::application::Store;
use ruth_store::{
    BaselineMetaLog, DesignLog, ProposalLog, ProposalState, StoredDesignGeneration,
    StoredDesignProposal, StoredGeneration, StoredProposal,
};

struct Baby {
    store: Store,
    ids: IdGen,
    proposals: ProposalLog,
    designs: DesignLog,
    metalog: BaselineMetaLog,
    project: String,
    module: String,
    req: String,
    v1: String,
}

fn baby() -> Baby {
    let mut store = Store::new();
    let mut ids = IdGen::new();
    let project = ruth_api::create_project(&mut store, &mut ids)
        .expect("proyecto")
        .id;
    let module = ruth_api::create_module(
        &mut store,
        &mut ids,
        CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("módulo")
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
    .expect("requisito");
    let v1 = detail.current_version_id.clone();
    Baby {
        store,
        ids,
        proposals: ProposalLog::new(),
        designs: DesignLog::new(),
        metalog: BaselineMetaLog::new(),
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
            title: "Título".to_string(),
            description: "Descripción".to_string(),
            acceptance: vec!["Criterio".to_string()],
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
        template_version: 1,
        input_tokens: None,
        output_tokens: None,
        total_tokens: None,
        created_at: "2026-10-27T12:00:00Z".to_string(),
        questions: vec![],
        proposal: StoredDesignProposal {
            title: "Flujo".to_string(),
            spec_json: "{\"nodes\":[]}".to_string(),
            explanation: "Explicación".to_string(),
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
    // El resumen del módulo lista su contenido; el borrador sin referencias
    // puede eliminarse.
    let module = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        preview_input(&baby.project, "module", &baby.module),
    )
    .expect("resumen");
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
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("resumen");
    assert_eq!(req.versions, 1);
    assert_eq!(req.approvals, 0);
    assert!(req.can_delete);
}

#[test]
fn preview_shows_external_dependents_and_generation_roles() {
    let mut baby = baby();
    // Segundo módulo con un diseño que depende del requisito (externo).
    let other = ruth_api::create_module(
        &mut baby.store,
        &mut baby.ids,
        CreateModuleInput {
            project_id: baby.project.clone(),
        },
    )
    .expect("módulo")
    .id;
    let flow = format!("{other}-flow");
    baby.store
        .create_artifact(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(other.clone()).expect("id"),
            ruth_core::domain::ArtifactId::new(flow.clone()).expect("id"),
            ruth_core::domain::ArtifactType::Flow,
        )
        .expect("flujo");
    baby.store
        .create_version(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ArtifactId::new(flow.clone()).expect("id"),
            None,
            ruth_core::domain::VersionId::new(format!("{flow}-v1")).expect("id"),
            ruth_core::domain::Content::new("{\"nodes\":[]}").expect("contenido"),
            &ruth_core::domain::Author::Human(ruth_core::domain::HumanId::new("ana").expect("id")),
            &[ruth_core::domain::VersionId::new(baby.v1.clone()).expect("id")],
        )
        .expect("versión");
    // Generación que lo cita en contexto + actualización dirigida a él.
    baby.proposals
        .record(generation(
            "gen-1",
            &baby.project,
            &baby.module,
            vec![baby.v1.clone()],
        ))
        .expect("registrar");
    baby.designs
        .record(design_generation(
            "gen-d1",
            &baby.project,
            &other,
            vec![],
            Some((baby.req.as_str(), baby.v1.as_str())),
        ))
        .expect("registrar diseño");
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("resumen");
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
    // Archivar devuelve el detalle autoritativo con el flag.
    let archived = ruth_api::archive_requirement(
        &mut baby.store,
        ArchiveRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("archivar");
    assert!(archived.artifact.archived);
    assert_eq!(archived.versions.len(), 1);
    // Restaurar lo devuelve a activo.
    let restored = ruth_api::restore_requirement(
        &mut baby.store,
        ArchiveRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("restaurar");
    assert!(!restored.artifact.archived);
    // Borrar un borrador sin referencias lo elimina del todo.
    let deleted = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("borrar");
    assert_eq!(deleted, baby.req);
    assert!(baby
        .store
        .artifact(&ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id"))
        .is_none());
    // Y el módulo vacío también se elimina.
    let removed = ruth_api::delete_module_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        DeleteModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("borrar módulo");
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
    .expect("archivar");
    assert!(archived.archived);
    let restored = ruth_api::restore_module(
        &mut baby.store,
        ArchiveModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("restaurar");
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
        .expect("registrar");
    // La ejecución revalida: la referencia en contexto bloquea.
    let before = baby.store.clone();
    let err = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect_err("debe fallar");
    assert_eq!(err.kind, "delete_has_generations");
    assert_eq!(baby.store, before);
    // El módulo con generaciones propias tampoco se borra.
    let err = ruth_api::delete_module_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        DeleteModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect_err("debe fallar");
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
        content: "contenido aceptado".to_string(),
    };
    baby.proposals.record(generation).expect("registrar");
    let preview = ruth_api::archive_preview(
        &baby.store,
        &baby.proposals,
        &baby.designs,
        &baby.metalog,
        preview_input(&baby.project, "requirement", &baby.req),
    )
    .expect("resumen");
    assert!(
        preview.generations.iter().any(|g| g.role == "accepted"),
        "la aceptación debe aparecer en el resumen"
    );
    assert!(!preview.can_delete);
    let err = ruth_api::delete_requirement_checked(
        &mut baby.store,
        &baby.proposals,
        &baby.designs,
        DeleteRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect_err("debe fallar");
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
        .expect("archivar");
    // El contexto de generación sobre un módulo archivado se rechaza.
    let err = ruth_api::snapshot_context(&baby.store, &baby.project, &baby.module)
        .expect_err("debe fallar");
    assert_eq!(err.kind, "archived_module");
    // Guardar una versión bajo el módulo archivado también.
    let err = ruth_api::save_version(
        &mut baby.store,
        ruth_api::SaveVersionInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
            expected_version_id: baby.v1.clone(),
            content: "cambio".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect_err("debe fallar");
    assert_eq!(err.kind, "archived_artifact");
    // Y aprobar igual.
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
    .expect_err("debe fallar");
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
    .expect("aprobar");
    baby.store
        .set_artifact_archived(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ArtifactId::new(baby.req.clone()).expect("id"),
            true,
        )
        .expect("archivar");
    let preview = ruth_api::prepare_baseline(
        &baby.store,
        ruth_api::BaselinePrepareInput {
            project_id: baby.project.clone(),
            scope_module_id: baby.module.clone(),
            artifact_ids: vec![baby.req.clone()],
        },
    )
    .expect("preparar");
    assert!(!preview.can_create);
    assert!(
        preview.blockers.iter().any(|b| b.code == "archived"),
        "la entrada archivada debe bloquear: {:?}",
        preview.blockers
    );
}
