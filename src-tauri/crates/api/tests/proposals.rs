//! Assisted generations without network: the "fake generator" builds the
//! validated output by hand; real network only exists in the Tauri command.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    AcceptProposalInput, CreateModuleInput, CreateRequirementInput, DiscardProposalInput,
    GenerationContextInput, IdGen, ListGenerationsInput, RecordInput, SaveVersionInput,
};
use ruth_core::application::Store;
use ruth_meta::generation::{
    GenerationContextItem, ProposalDraft, ValidatedGeneration, TEMPLATE_VERSION,
};
use ruth_store::{DbActor, ProposalLog};

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct TempDb {
    path: PathBuf,
}

impl TempDb {
    fn new(name: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "ruth-prop-{}-{}-{}.db",
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
    log: ProposalLog,
    project: String,
    module: String,
    req: String,
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
    let req = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Confirmar una venta descuenta stock.".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement")
    .artifact
    .id;
    Baby {
        store,
        ids,
        log: ProposalLog::new(),
        project,
        module,
        req,
    }
}

/// Fake generator: already validated output, as `ruth-meta` would deliver it.
fn fake_validated() -> ValidatedGeneration {
    ValidatedGeneration {
        proposals: vec![
            ProposalDraft {
                temp_id: "p1".to_string(),
                title: "Reserve before confirming".to_string(),
                description: "A sale may reserve stock.".to_string(),
                acceptance: vec!["Reserving holds units".to_string()],
                assumptions: vec![],
            },
            ProposalDraft {
                temp_id: "p2".to_string(),
                title: "Release on cancel".to_string(),
                description: "Canceling frees the reservation.".to_string(),
                acceptance: vec!["Canceling frees".to_string()],
                assumptions: vec!["No expiry".to_string()],
            },
        ],
        questions: vec!["Do reservations expire?".to_string()],
    }
}

fn record_input(baby: &Baby, validated: ValidatedGeneration) -> RecordInput {
    let context =
        ruth_api::snapshot_context(&baby.store, &baby.project, &baby.module).expect("context");
    RecordInput {
        project_id: baby.project.clone(),
        module_id: baby.module.clone(),
        model: "muse-spark-1.3".to_string(),
        description: "Ventas con control de stock.".to_string(),
        context,
        validated,
        input_tokens: Some(100),
        output_tokens: Some(200),
        total_tokens: Some(300),
        created_at: "2026-10-27T12:00:00Z".to_string(),
    }
}

fn accept_input(generation_id: &str, temp_id: &str) -> AcceptProposalInput {
    AcceptProposalInput {
        generation_id: generation_id.to_string(),
        temp_id: temp_id.to_string(),
        title: "Reserve before confirming (edited)".to_string(),
        description: "A sale may reserve stock before confirmation.".to_string(),
        acceptance: vec!["Reserving holds units".to_string()],
        assumptions: vec![],
    }
}

#[test]
fn record_and_list_roundtrip_with_reopen() {
    let tmp = TempDb::new("record");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    assert!(!dto.stale);
    assert_eq!(dto.proposals.len(), 2);
    assert_eq!(dto.questions.len(), 1);
    assert_eq!(dto.template_version, TEMPLATE_VERSION);
    let listed = ruth_api::list_generations(
        &baby.store,
        &baby.log,
        ListGenerationsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, dto.id);
    db.close();

    let (db2, loaded) = DbActor::spawn(&tmp.path).expect("reopen");
    let again = loaded.proposals.generation(&dto.id).expect("generation");
    assert_eq!(again.proposals.len(), 2);
    assert_eq!(again.context_version_ids, dto.context_version_ids);
    db2.close();
}

#[test]
fn context_change_marks_stale_and_blocks_accept() {
    let tmp = TempDb::new("staleness");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    // Change a context source: new version of the requirement.
    let detail = ruth_api::get_requirement(
        &baby.store,
        ruth_api::GetRequirementInput {
            artifact_id: baby.req.clone(),
        },
    )
    .expect("detail");
    ruth_api::transact(&mut baby.store, &mut baby.ids, &db, |s, _| {
        ruth_api::save_version(
            s,
            SaveVersionInput {
                project_id: baby.project.clone(),
                artifact_id: baby.req.clone(),
                expected_version_id: detail.current_version_id.clone(),
                content: "Confirmar descuenta stock; reservas antes.".to_string(),
                author: "ana".to_string(),
            },
        )
    })
    .expect("new version");
    let listed = ruth_api::list_generations(
        &baby.store,
        &baby.log,
        ListGenerationsInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("list");
    assert!(listed[0].stale);
    // The result stays linked to its original context.
    assert_eq!(listed[0].context_version_ids, dto.context_version_ids);

    let before = baby.store.clone();
    let err = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p1"),
    )
    .expect_err("accept blocked");
    assert_eq!(err.kind, "generation_stale");
    assert_eq!(baby.store, before);
    db.close();
}

#[test]
fn accept_creates_unapproved_ai_draft_with_definitive_id() {
    let tmp = TempDb::new("accept");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    let detail = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p1"),
    )
    .expect("accept");
    // The app's definitive identifier, not the model's temp one.
    assert!(detail.artifact.id.starts_with("req-"));
    assert_eq!(detail.versions.len(), 1);
    assert_eq!(detail.versions[0].provenance.kind, "ai");
    assert!(detail.versions[0].provenance.by.contains("ruth-gen"));
    // Draft: no approval. Accepting does not equal approving.
    assert!(detail.approvals.is_empty());
    // No sources: the context is not a business dependency.
    assert!(detail.versions[0].sources.is_empty());
    // Content composed from the edited fields.
    assert!(detail.versions[0]
        .content
        .contains("Reserve before confirming (edited)"));
    assert!(detail.versions[0]
        .content
        .contains("- Reserving holds units"));
    // The proposal stayed marked with artifact and final content.
    let stored = baby.log.generation(&dto.id).expect("generation");
    assert!(matches!(
        &stored.proposals[0].state,
        ruth_store::ProposalState::Accepted { artifact_id, content }
        if artifact_id == &detail.artifact.id && content == &detail.versions[0].content
    ));
    db.close();
}

#[test]
fn accept_is_idempotent_without_duplicates() {
    let tmp = TempDb::new("idempotent");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    let first = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p1"),
    )
    .expect("accept");
    let count = baby
        .store
        .artifacts_of(
            &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
            &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
        )
        .len();
    // Double click / retry: same detail, no duplicates.
    let second = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p1"),
    )
    .expect("retry");
    assert_eq!(second.artifact.id, first.artifact.id);
    assert_eq!(
        baby.store
            .artifacts_of(
                &ruth_core::domain::ProjectId::new(baby.project.clone()).expect("id"),
                &ruth_core::domain::ModuleId::new(baby.module.clone()).expect("id"),
            )
            .len(),
        count
    );
    db.close();
}

#[test]
fn discard_blocks_accept_and_accept_blocks_discard() {
    let tmp = TempDb::new("discard");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    ruth_api::discard_proposal(
        &mut baby.log,
        &db,
        DiscardProposalInput {
            generation_id: dto.id.clone(),
            temp_id: "p2".to_string(),
        },
    )
    .expect("discard");
    let err = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p2"),
    )
    .expect_err("discarded is not accepted");
    assert_eq!(err.kind, "proposal_discarded");
    ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db,
        accept_input(&dto.id, "p1"),
    )
    .expect("accept");
    let err = ruth_api::discard_proposal(
        &mut baby.log,
        &db,
        DiscardProposalInput {
            generation_id: dto.id.clone(),
            temp_id: "p1".to_string(),
        },
    )
    .expect_err("accepted is not discarded");
    assert_eq!(err.kind, "storage_error");
    db.close();
}

#[test]
fn invalid_edits_are_rejected_without_side_effects() {
    let tmp = TempDb::new("invalid-edit");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    let before = baby.store.clone();
    let mut bad = accept_input(&dto.id, "p1");
    bad.title = "  ".to_string();
    let err = ruth_api::accept_proposal(&mut baby.store, &mut baby.ids, &mut baby.log, &db, bad)
        .expect_err("empty title");
    assert_eq!(err.kind, "invalid_proposal");
    let mut bad = accept_input(&dto.id, "p1");
    bad.acceptance.clear();
    let err = ruth_api::accept_proposal(&mut baby.store, &mut baby.ids, &mut baby.log, &db, bad)
        .expect_err("no criteria");
    assert_eq!(err.kind, "invalid_proposal");
    assert_eq!(baby.store, before);
    db.close();
}

#[test]
fn persistence_failure_accepts_nothing_partially() {
    let tmp = TempDb::new("disk-failure");
    let mut baby = baby();
    let (db, _) = DbActor::spawn(&tmp.path).expect("open");
    db.save(&baby.store, baby.ids.checkpoint()).expect("domain");
    let input = record_input(&baby, fake_validated());
    let dto = ruth_api::record_generation(&baby.store, &mut baby.ids, &mut baby.log, &db, input)
        .expect("record");
    db.close();
    // Disk/memory divergence: on disk the proposal stops being pending.
    {
        let raw = rusqlite::Connection::open(&tmp.path).expect("raw");
        raw.execute(
            "UPDATE proposals SET state = 'discarded' WHERE generation_id = ? AND temp_id = 'p1'",
            [&dto.id],
        )
        .expect("force");
    }
    let (db2, _) = DbActor::spawn(&tmp.path).expect("reopen");
    let before_store = baby.store.clone();
    let before_log = baby.log.clone();
    // In memory it stays pending, but disk rejects: nothing is published.
    let err = ruth_api::accept_proposal(
        &mut baby.store,
        &mut baby.ids,
        &mut baby.log,
        &db2,
        accept_input(&dto.id, "p1"),
    )
    .expect_err("disk rules");
    assert_eq!(err.kind, "storage_error");
    assert_eq!(baby.store, before_store);
    assert_eq!(baby.log, before_log);
    db2.close();
}

#[test]
fn description_and_preview_are_validated() {
    assert_eq!(
        ruth_api::validate_description("  Ventas.  ").expect("ok"),
        "Ventas."
    );
    assert_eq!(
        ruth_api::validate_description("   ")
            .expect_err("empty")
            .kind,
        "empty_description"
    );
    assert_eq!(
        ruth_api::validate_description(&"x".repeat(4001))
            .expect_err("long")
            .kind,
        "description_too_long"
    );
    let baby = baby();
    let preview = ruth_api::context_preview(
        &baby.store,
        GenerationContextInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("preview");
    assert_eq!(preview.len(), 1);
    assert_eq!(preview[0].artifact_id, baby.req);
    assert!(preview[0].chars > 0);
    assert!(preview[0].excerpt.contains("descuenta stock"));
}

#[test]
fn context_snapshot_holds_exact_current_versions() {
    let baby = baby();
    let context =
        ruth_api::snapshot_context(&baby.store, &baby.project, &baby.module).expect("snapshot");
    assert_eq!(context.len(), 1);
    assert_eq!(
        context[0],
        GenerationContextItem {
            artifact_id: baby.req.clone(),
            version_id: format!("{}-v1", baby.req),
            content: "Confirmar una venta descuenta stock.".to_string(),
        }
    );
}

#[test]
fn meta_errors_map_to_stable_kinds() {
    use ruth_meta::{MetaError, MetaErrorKind};
    let cases = [
        (MetaErrorKind::MissingKey, "missing_key"),
        (MetaErrorKind::Billing, "meta_billing"),
        (MetaErrorKind::RateLimit, "meta_rate_limit"),
        (MetaErrorKind::Timeout, "meta_timeout"),
        (MetaErrorKind::Incomplete, "generation_incomplete"),
        (MetaErrorKind::InvalidResponse, "generation_invalid"),
    ];
    for (kind, expected) in cases {
        let mapped = ruth_api::ApiError::from_meta(MetaError::new(kind, "detalle", false));
        assert_eq!(mapped.kind, expected);
        assert_eq!(mapped.message, "detalle");
    }
}
