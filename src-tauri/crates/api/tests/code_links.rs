//! Code↔knowledge links and snapshots without database I/O: validation,
//! blockers, hash verification and portability contracts.

use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{AddModuleLinkInput, AddSymbolLinkInput, IdGen, SaveSnapshotInput, SymbolInput};
use ruth_code::CodeRoot;
use ruth_core::application::Store;
use ruth_store::{CodeLinkLog, LinkKind, LinkScope, SnapshotLog, StoredCodeLink};

static COUNTER: AtomicU64 = AtomicU64::new(0);

fn scratch(name: &str) -> std::path::PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ruth-links-{}-{}-{n}", std::process::id(), name));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("src")).expect("scratch");
    std::fs::write(dir.join("src").join("a.ts"), "const a = 1;\n").expect("fixture");
    dir
}

struct Baby {
    store: Store,
    ids: IdGen,
    roots: Vec<CodeRoot>,
    project: String,
    module: String,
    req: String,
    dir: std::path::PathBuf,
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
        ruth_api::CreateModuleInput {
            project_id: project.clone(),
        },
    )
    .expect("module")
    .id;
    let req = ruth_api::create_requirement(
        &mut store,
        &mut ids,
        ruth_api::CreateRequirementInput {
            project_id: project.clone(),
            module_id: module.clone(),
            content: "Contenido".to_string(),
            author: "ana".to_string(),
        },
    )
    .expect("requirement")
    .artifact
    .id;
    let dir = scratch("baby");
    let roots = vec![CodeRoot {
        id: "root-1".to_string(),
        path: dir.display().to_string(),
        name: "baby".to_string(),
        project_id: Some(project.clone()),
    }];
    Baby {
        store,
        ids,
        roots,
        project,
        module,
        req,
        dir,
    }
}

fn symbol_input() -> SymbolInput {
    SymbolInput {
        id: "root-1::src/a.ts::A::class::0".to_string(),
        name: "A".to_string(),
        kind: "class".to_string(),
        start_line: 1,
        start_col: 1,
        end_line: 2,
        end_col: 1,
        hash: "0123abcd".to_string(),
    }
}

#[test]
fn module_link_requires_existing_ones_and_disk() {
    let mut baby = baby();
    let links = CodeLinkLog::new();
    let link = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src".to_string(),
        },
        "2026-10-28T00:00:00Z",
    )
    .expect("valid");
    assert_eq!(link.scope, LinkScope::Module);
    assert_eq!(link.kind, LinkKind::Manual);
    assert!(link.symbol.is_none());
    // Missing module.
    let err = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: "mod-999".to_string(),
            root_id: "root-1".to_string(),
            rel: "src".to_string(),
        },
        "t",
    )
    .expect_err("missing module");
    assert_ne!(err.kind, "code_link_duplicate");
    // Missing root.
    let err = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-9".to_string(),
            rel: "src".to_string(),
        },
        "t",
    )
    .expect_err("missing root");
    assert_eq!(err.kind, "code_root_not_found");
    // Escape and on-disk absence.
    for rel in ["../outside", "src/no-existe.ts"] {
        assert!(
            ruth_api::build_module_link(
                &baby.store,
                &baby.roots,
                &links,
                &mut baby.ids,
                AddModuleLinkInput {
                    module_id: baby.module.clone(),
                    root_id: "root-1".to_string(),
                    rel: rel.to_string(),
                },
                "t",
            )
            .is_err(),
            "invalid rel: {rel}"
        );
    }
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn module_link_rejects_archived_and_duplicates() {
    let mut baby = baby();
    let mut links = CodeLinkLog::new();
    let link = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
        },
        "t",
    )
    .expect("first");
    links.record(link).expect("record");
    let err = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
        },
        "t",
    )
    .expect_err("duplicate");
    assert_eq!(err.kind, "code_link_duplicate");
    // Archiving the module blocks linking (but keeps the links).
    ruth_api::archive_module(
        &mut baby.store,
        ruth_api::ArchiveModuleInput {
            project_id: baby.project.clone(),
            module_id: baby.module.clone(),
        },
    )
    .expect("archive");
    let err = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src".to_string(),
        },
        "t",
    )
    .expect_err("archived");
    assert_eq!(err.kind, "code_link_archived");
    assert_eq!(links.by_owner(LinkScope::Module, &baby.module).len(), 1);
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn symbol_link_requires_identity_and_evidence() {
    let mut baby = baby();
    let links = CodeLinkLog::new();
    let link = ruth_api::build_symbol_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddSymbolLinkInput {
            artifact_id: baby.req.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
            symbol: symbol_input(),
        },
        "t",
    )
    .expect("valid");
    assert_eq!(link.kind, LinkKind::Detected);
    assert_eq!(link.symbol.as_ref().expect("symbol").name, "A");
    // Without a hash there is not enough evidence.
    let mut bad = symbol_input();
    bad.hash = String::new();
    let err = ruth_api::build_symbol_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddSymbolLinkInput {
            artifact_id: baby.req.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
            symbol: bad,
        },
        "t",
    )
    .expect_err("no hash");
    assert_eq!(err.kind, "code_link_invalid");
    // Incoherent range.
    let mut bad = symbol_input();
    bad.end_line = 0;
    assert!(ruth_api::build_symbol_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddSymbolLinkInput {
            artifact_id: baby.req.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
            symbol: bad,
        },
        "t",
    )
    .is_err());
    // Archived artifact: blocks creating, keeps reading.
    ruth_api::archive_requirement(
        &mut baby.store,
        ruth_api::ArchiveRequirementInput {
            project_id: baby.project.clone(),
            artifact_id: baby.req.clone(),
        },
    )
    .expect("archive");
    let err = ruth_api::build_symbol_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddSymbolLinkInput {
            artifact_id: baby.req.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
            symbol: symbol_input(),
        },
        "t",
    )
    .expect_err("archived");
    assert_eq!(err.kind, "code_link_archived");
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn deletion_blocks_quote_links() {
    let mut baby = baby();
    let mut links = CodeLinkLog::new();
    let module_link = ruth_api::build_module_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddModuleLinkInput {
            module_id: baby.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src".to_string(),
        },
        "t",
    )
    .expect("module");
    links.record(module_link).expect("record");
    let symbol_link = ruth_api::build_symbol_link(
        &baby.store,
        &baby.roots,
        &links,
        &mut baby.ids,
        AddSymbolLinkInput {
            artifact_id: baby.req.clone(),
            root_id: "root-1".to_string(),
            rel: "src/a.ts".to_string(),
            symbol: symbol_input(),
        },
        "t",
    )
    .expect("symbol");
    links.record(symbol_link).expect("record");
    assert_eq!(
        ruth_api::check_root_removable(&links, "root-1")
            .expect_err("root")
            .kind,
        "code_root_has_links"
    );
    assert!(ruth_api::check_root_removable(&links, "root-9").is_ok());
    assert_eq!(
        ruth_api::check_module_deletable(&links, &baby.module)
            .expect_err("module")
            .kind,
        "delete_has_code_links"
    );
    assert_eq!(
        ruth_api::check_artifact_deletable(&links, &baby.req)
            .expect_err("artifact")
            .kind,
        "delete_has_code_links"
    );
    // Per project: one link of each scope.
    let (modules, artifacts) =
        ruth_api::links_for_project(&baby.store, &links, &baby.project).expect("project");
    assert_eq!(modules.len(), 1);
    assert_eq!(artifacts.len(), 1);
    assert!(ruth_api::links_for_project(&baby.store, &links, "proy-999").is_err());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

fn snapshot_result() -> serde_json::Value {
    serde_json::json!({
        "files": [{"rootId": "root-1", "rel": "src/a.ts", "hash": "0123abcd", "bytes": 14}],
        "symbols": [{"id": "s1", "name": "A", "kind": "class"}],
        "relations": [],
        "symbolsTruncated": false,
        "relationsTruncated": false,
        "limits": {"maxFiles": 20, "maxSymbols": 300, "maxRelations": 500, "maxMembers": 50},
    })
}

#[test]
fn instantanea_valida_formas_y_rechaza_contenido() {
    let baby = baby();
    let validated = ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: Some(baby.project.clone()),
            name: Some("Analysis 1".to_string()),
            result: snapshot_result(),
        },
    )
    .expect("valid");
    assert_eq!(validated.name, "Analysis 1");
    assert!(validated.files_json.contains("src/a.ts"));
    // Missing project.
    assert!(ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: Some("proy-999".to_string()),
            name: Some("X".to_string()),
            result: snapshot_result(),
        },
    )
    .is_err());
    // Root outside the workspace.
    let mut bad = snapshot_result();
    bad["files"][0]["rootId"] = serde_json::json!("root-9");
    assert!(ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("X".to_string()),
            result: bad,
        },
    )
    .is_err());
    // `content` key at any level: rejected.
    let mut bad = snapshot_result();
    bad["symbols"][0]["content"] = serde_json::json!("const a = 1;");
    let err = ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("X".to_string()),
            result: bad,
        },
    )
    .expect_err("content");
    assert_eq!(err.kind, "code_snapshot_invalid");
    // Nameless.
    assert!(ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("  ".to_string()),
            result: snapshot_result(),
        },
    )
    .is_err());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn instantanea_acepta_apis_opcionales_y_acota() {
    let baby = baby();
    // With endpoints and calls: passes and stays in the JSON.
    let mut with_apis = snapshot_result();
    with_apis["endpoints"] = serde_json::json!([
        {"id": "e1", "method": "GET", "url": "/users", "rootId": "root-1", "rel": "src/a.ts"}
    ]);
    with_apis["calls"] = serde_json::json!([
        {"id": "c1", "method": "GET", "url": "/users", "rootId": "root-1", "rel": "src/b.ts"}
    ]);
    let validated = ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("Con APIs".to_string()),
            result: with_apis,
        },
    )
    .expect("valid with APIs");
    assert!(validated.result_json.contains("endpoints"));
    // Endpoint excess: rejected without saving anything.
    let mut too_many = snapshot_result();
    too_many["endpoints"] = serde_json::json!(vec![serde_json::json!({"id": "e"}); 201]);
    let err = ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("X".to_string()),
            result: too_many,
        },
    )
    .expect_err("too many");
    assert_eq!(err.kind, "code_snapshot_invalid");
    // Invalid shape (not an array): rejected.
    let mut bad_shape = snapshot_result();
    bad_shape["calls"] = serde_json::json!({"id": "c1"});
    assert!(ruth_api::validate_snapshot(
        &baby.store,
        &baby.roots,
        SaveSnapshotInput {
            project_id: None,
            name: Some("X".to_string()),
            result: bad_shape,
        },
    )
    .is_err());
    let _ = std::fs::remove_dir_all(&baby.dir);
}

#[test]
fn verification_compares_hashes_unambiguously() {
    use ruth_api::{snapshot_file_status, CurrentFile, SnapshotFileStatus};
    assert_eq!(
        snapshot_file_status("ab", &CurrentFile::Hash("ab".to_string())),
        SnapshotFileStatus::Fresh
    );
    assert_eq!(
        snapshot_file_status("ab", &CurrentFile::Hash("cd".to_string())),
        SnapshotFileStatus::Stale
    );
    assert_eq!(
        snapshot_file_status("ab", &CurrentFile::RootGone),
        SnapshotFileStatus::Missing
    );
    assert_eq!(
        snapshot_file_status("ab", &CurrentFile::Gone),
        SnapshotFileStatus::Missing
    );
    assert_eq!(
        snapshot_file_status("ab", &CurrentFile::UnreadableChanged("binario".to_string())),
        SnapshotFileStatus::Stale
    );
    assert!(matches!(
        snapshot_file_status("ab", &CurrentFile::Unreadable("permiso".to_string())),
        SnapshotFileStatus::Error(_)
    ));
}

#[test]
fn portabilidad_exporta_y_rechaza_versiones() {
    let mut links = CodeLinkLog::new();
    links
        .record(StoredCodeLink {
            id: "link-1".to_string(),
            scope: LinkScope::Module,
            owner_id: "mod-2".to_string(),
            root_id: "root-1".to_string(),
            rel: "src".to_string(),
            symbol: None,
            kind: LinkKind::Manual,
            created_at: "t".to_string(),
        })
        .expect("link");
    let mut snapshots = SnapshotLog::new();
    snapshots
        .record(ruth_store::StoredSnapshot {
            id: "snap-1".to_string(),
            project_id: Some("proy-1".to_string()),
            name: "A".to_string(),
            created_at: "t".to_string(),
            files_json: r#"[{"rootId":"root-1","rel":"a","hash":"h","bytes":1}]"#.to_string(),
            result_json: r#"{"files":[],"symbols":[],"relations":[]}"#.to_string(),
        })
        .expect("snapshot");
    let roots = vec![CodeRoot {
        id: "root-1".to_string(),
        path: "/tmp/x".to_string(),
        name: "x".to_string(),
        project_id: Some("proy-1".to_string()),
    }];
    let export = ruth_api::export_portable(
        Some("proy-1"),
        &roots,
        links.all(),
        snapshots.all(),
        "2026-10-28T00:00:00Z",
    )
    .expect("export");
    assert_eq!(export.version, ruth_api::PORTABILITY_VERSION);
    let json = serde_json::to_string(&export).expect("serialize");
    let parsed = ruth_api::parse_portable_export(&json).expect("read");
    assert_eq!(parsed, export);
    // Unknown version: complete rejection.
    let bad = json.replace(
        &format!("\"version\":{}", ruth_api::PORTABILITY_VERSION),
        "\"version\":99",
    );
    let err = ruth_api::parse_portable_export(&bad).expect_err("version");
    assert_eq!(err.kind, "portable_invalid");
    // Broken JSON.
    assert!(ruth_api::parse_portable_export("{no").is_err());
}
