//! Structure replication without a database: base suggestion, preview,
//! idempotent planning and application over drafts.

use std::sync::atomic::{AtomicU64, Ordering};

use ruth_api::{
    build_replication_links, plan_replication, preview_replication, suggest_base, IdGen,
    ReplicateInput, ReplicateTarget,
};
use ruth_code::{CodeRoot, CodeWorkspace};
use ruth_core::application::Store;
use ruth_store::CodeLinkLog;

static COUNTER: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    store: Store,
    ids: IdGen,
    roots: CodeWorkspace,
    links: CodeLinkLog,
    project: String,
    module: String,
    dir: std::path::PathBuf,
}

fn angular(dir: &std::path::Path) {
    for rel in [
        "src/app/audit",
        "src/app/clasificadores",
        "src/main.ts",
        "src/app/node_modules/dep",
        "src/app/.hidden",
        "src/app/dist",
        "src/app/build",
    ] {
        let path = dir.join(rel);
        if rel.ends_with(".ts") {
            std::fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
            std::fs::write(&path, "x").expect("file");
        } else {
            std::fs::create_dir_all(&path).expect("dirs");
        }
    }
    std::fs::write(dir.join("src/app/audit/a.ts"), "x").expect("file");
}

fn fixture(build: impl Fn(&std::path::Path)) -> Fixture {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ruth-replicate-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    build(&dir);
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
    let roots = CodeWorkspace::from_roots(vec![CodeRoot {
        id: "root-1".to_string(),
        path: dir.display().to_string(),
        name: "fe".to_string(),
        project_id: None,
    }]);
    Fixture {
        store,
        ids,
        roots,
        links: CodeLinkLog::new(),
        project,
        module,
        dir,
    }
}

fn nest(dir: &std::path::Path) {
    for rel in ["src/users", "src/auth", "src/main.ts"] {
        let path = dir.join(rel);
        if rel.ends_with(".ts") {
            std::fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
            std::fs::write(&path, "x").expect("file");
        } else {
            std::fs::create_dir_all(&path).expect("dirs");
        }
    }
}

impl Fixture {
    fn root(&self) -> &CodeRoot {
        self.roots.get("root-1").expect("root")
    }

    fn cleanup(self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn suggests_src_app_on_angular_and_src_on_nest() {
    let fe = fixture(angular);
    let (base, reason) = suggest_base(std::path::Path::new(&fe.root().path)).expect("base");
    assert_eq!(base, "src/app");
    assert!(reason.contains("Angular"), "{reason}");
    fe.cleanup();
    let be = fixture(nest);
    let (base, _) = suggest_base(std::path::Path::new(&be.root().path)).expect("base");
    assert_eq!(base, "src");
    be.cleanup();
}

#[test]
fn without_src_suggests_root_and_empty_src_app_falls_to_src() {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!("ruth-replicate-{}-flat-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("docs")).expect("dirs");
    let (base, reason) = suggest_base(&dir).expect("root");
    assert_eq!(base, "");
    assert!(reason.contains("No src"), "{reason}");
    let _ = std::fs::remove_dir_all(&dir);
    let empty_app = fixture(|dir: &std::path::Path| {
        std::fs::create_dir_all(dir.join("src/app")).expect("dirs");
        std::fs::create_dir_all(dir.join("src/common")).expect("dirs");
    });
    let (base, _) = suggest_base(std::path::Path::new(&empty_app.root().path)).expect("base");
    assert_eq!(base, "src");
    empty_app.cleanup();
}

#[test]
fn preview_lists_folders_and_excludes_policy() {
    let fe = fixture(angular);
    let preview = preview_replication(&fe.store, &fe.links, fe.root(), None).expect("preview");
    assert_eq!(preview.base, "src/app");
    assert!(preview.suggested);
    assert_eq!(preview.entries.len(), 2);
    assert_eq!(preview.entries[0].name, "audit");
    assert_eq!(preview.entries[0].rel, "src/app/audit");
    assert!(preview.entries.iter().all(|e| e.linked_module.is_none()));
    // The base listing already hides node_modules/dist; replication adds
    // hidden ones and build (the full policy shows in the dialog).
    assert_eq!(preview.excluded, vec![".hidden", "build"]);
    assert!(!preview.truncated);
    assert!(!preview.over_cap);
    // Explicit base: the user rules, no suggestion.
    let preview =
        preview_replication(&fe.store, &fe.links, fe.root(), Some("src")).expect("preview");
    assert_eq!(preview.base, "src");
    assert!(!preview.suggested);
    assert!(preview.entries.iter().any(|e| e.name == "app"));
    fe.cleanup();
}

#[test]
fn root_base_preview_and_plan_one_module_per_service() {
    // Sibling microservices without src in the parent: base "" is
    // the root and each direct child a module.
    let mono = fixture(|dir: &std::path::Path| {
        for rel in [
            "me-of-api-gateway/src/main/java/org/x",
            "me-of-be-person/src/main/java/org/y",
            "me-of-api-gateway/target",
            "README.md",
        ] {
            let path = dir.join(rel);
            if rel.ends_with(".md") {
                std::fs::write(&path, "x").expect("file");
            } else {
                std::fs::create_dir_all(&path).expect("dirs");
            }
        }
    });
    let preview =
        preview_replication(&mono.store, &mono.links, mono.root(), None).expect("preview");
    assert_eq!(preview.base, "");
    assert!(preview.suggested);
    assert_eq!(preview.entries.len(), 2);
    assert_eq!(preview.entries[0].rel, "me-of-api-gateway");
    // Explicit "" equals the suggested one.
    let again =
        preview_replication(&mono.store, &mono.links, mono.root(), Some("")).expect("preview");
    assert_eq!(again.entries.len(), 2);

    let plan = |rels: Vec<String>| {
        plan_replication(
            &mono.store,
            &mono.roots,
            &mono.links,
            &ReplicateInput {
                root_id: "root-1".to_string(),
                base: String::new(),
                rels,
                target: ReplicateTarget::New {
                    name: "Medical".to_string(),
                },
            },
        )
    };
    let ok = plan(vec![
        "me-of-api-gateway".to_string(),
        "me-of-be-person".to_string(),
    ])
    .expect("plan");
    assert_eq!(ok.modules.len(), 2);
    assert_eq!(ok.modules[0].name, "me-of-api-gateway");
    assert_eq!(ok.modules[0].rel, "me-of-api-gateway");
    // Grandchildren, empties and escapes are not root children.
    for bad in [
        "me-of-api-gateway/src",
        "../outside",
        "",
        "me-of-api-gateway/../be-person",
    ] {
        let err = plan(vec![bad.to_string()]).expect_err(bad);
        assert_eq!(err.kind, "replicate_entry", "{bad}");
    }
    // A file exists but is not a folder: gone.
    let err = plan(vec!["README.md".to_string()]).expect_err("file");
    assert_eq!(err.kind, "replicate_entry_gone");
    mono.cleanup();
}

#[test]
fn over_cap_reports_without_truncating() {
    let many = fixture(|dir: &std::path::Path| {
        for n in 0..55 {
            std::fs::create_dir_all(dir.join(format!("src/mod-{n:02}"))).expect("dirs");
        }
    });
    let preview =
        preview_replication(&many.store, &many.links, many.root(), None).expect("preview");
    assert_eq!(preview.entries.len(), 55);
    assert!(preview.over_cap);
    let rels: Vec<String> = preview.entries.iter().map(|e| e.rel.clone()).collect();
    let err = plan_replication(
        &many.store,
        &many.roots,
        &many.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src".to_string(),
            rels,
            target: ReplicateTarget::New {
                name: "Grande".to_string(),
            },
        },
    )
    .expect_err("cap");
    assert_eq!(err.kind, "replicate_too_many");
    many.cleanup();
}

#[test]
fn plan_validates_selection_destination_and_disk() {
    let fe = fixture(angular);
    let plan = |rels: Vec<String>, target: ReplicateTarget| {
        plan_replication(
            &fe.store,
            &fe.roots,
            &fe.links,
            &ReplicateInput {
                root_id: "root-1".to_string(),
                base: "src/app".to_string(),
                rels,
                target,
            },
        )
    };
    let target = || ReplicateTarget::New {
        name: "Front".to_string(),
    };
    let ok = plan(
        vec![
            "src/app/audit".to_string(),
            "src/app/clasificadores".to_string(),
        ],
        target(),
    )
    .expect("plan");
    assert_eq!(ok.modules.len(), 2);
    assert_eq!(ok.modules[0].name, "audit");
    assert!(ok.already_linked.is_empty());
    assert_eq!(ok.project_name.as_deref(), Some("Front"));

    let err = plan(vec![], target()).expect_err("empty");
    assert_eq!(err.kind, "replicate_empty");
    let err = plan(
        vec!["src/app/audit".to_string(), "src/app/audit".to_string()],
        target(),
    )
    .expect_err("repeated");
    assert_eq!(err.kind, "replicate_duplicate");
    let err = plan(vec!["src/app/audit/deep".to_string()], target()).expect_err("deep");
    assert_eq!(err.kind, "replicate_entry");
    let err = plan(vec!["src/main.ts".to_string()], target()).expect_err("file");
    assert_eq!(err.kind, "replicate_entry");
    let err = plan(vec!["../outside".to_string()], target()).expect_err("escape");
    assert_eq!(err.kind, "replicate_entry");
    let err = plan(vec!["src/app/..".to_string()], target()).expect_err("dots");
    assert_eq!(err.kind, "replicate_entry");
    let err = plan(
        vec!["src/app/ghost".to_string()],
        ReplicateTarget::Existing {
            project_id: fe.project.clone(),
        },
    )
    .expect_err("missing");
    assert_eq!(err.kind, "replicate_entry_gone");
    let err = plan(
        vec!["src/app/audit".to_string()],
        ReplicateTarget::Existing {
            project_id: "proy-ghost".to_string(),
        },
    )
    .expect_err("project");
    assert_eq!(err.kind, "project_not_found");
    fe.cleanup();
}

#[test]
fn excluded_and_long_names_rejected() {
    let fe = fixture(|dir: &std::path::Path| {
        angular(dir);
        std::fs::create_dir_all(dir.join("src/app/build")).expect("dirs");
        std::fs::create_dir_all(dir.join("src/app").join("n".repeat(121))).expect("long");
    });
    let plan = |rels: Vec<String>| {
        plan_replication(
            &fe.store,
            &fe.roots,
            &fe.links,
            &ReplicateInput {
                root_id: "root-1".to_string(),
                base: "src/app".to_string(),
                rels,
                target: ReplicateTarget::New {
                    name: "Front".to_string(),
                },
            },
        )
    };
    let err = plan(vec!["src/app/build".to_string()]).expect_err("excluded");
    assert_eq!(err.kind, "replicate_excluded");
    let err = plan(vec![format!("src/app/{}", "n".repeat(121))]).expect_err("long");
    assert_eq!(err.kind, "name_too_long");
    fe.cleanup();
}

#[test]
fn root_bound_to_another_project_blocks() {
    let mut fe = fixture(angular);
    fe.roots = CodeWorkspace::from_roots(vec![CodeRoot {
        id: "root-1".to_string(),
        path: fe.dir.display().to_string(),
        name: "fe".to_string(),
        project_id: Some(fe.project.clone()),
    }]);
    let err = plan_replication(
        &fe.store,
        &fe.roots,
        &fe.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src/app".to_string(),
            rels: vec!["src/app/audit".to_string()],
            target: ReplicateTarget::New {
                name: "Otro".to_string(),
            },
        },
    )
    .expect_err("bound");
    assert_eq!(err.kind, "replicate_bound_elsewhere");
    // Same project is allowed (adds what is missing).
    let ok = plan_replication(
        &fe.store,
        &fe.roots,
        &fe.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src/app".to_string(),
            rels: vec!["src/app/audit".to_string()],
            target: ReplicateTarget::Existing {
                project_id: fe.project.clone(),
            },
        },
    )
    .expect("same project");
    assert_eq!(ok.project_id, fe.project);
    fe.cleanup();
}

#[test]
fn linked_ones_skipped_and_all_linked_blocks() {
    let mut fe = fixture(angular);
    let link = ruth_api::build_module_link(
        &fe.store,
        fe.roots.roots(),
        &fe.links,
        &mut fe.ids,
        ruth_api::AddModuleLinkInput {
            module_id: fe.module.clone(),
            root_id: "root-1".to_string(),
            rel: "src/app/audit".to_string(),
        },
        "t",
    )
    .expect("link");
    fe.links.record(link).expect("memory");
    let plan = plan_replication(
        &fe.store,
        &fe.roots,
        &fe.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src/app".to_string(),
            rels: vec![
                "src/app/audit".to_string(),
                "src/app/clasificadores".to_string(),
            ],
            target: ReplicateTarget::New {
                name: "Front".to_string(),
            },
        },
    )
    .expect("plan");
    assert_eq!(plan.modules.len(), 1);
    assert_eq!(plan.modules[0].rel, "src/app/clasificadores");
    assert_eq!(plan.already_linked, vec!["src/app/audit".to_string()]);
    // The preview also marks the link with the module name.
    let preview = preview_replication(&fe.store, &fe.links, fe.root(), None).expect("preview");
    let entry = preview
        .entries
        .iter()
        .find(|e| e.rel == "src/app/audit")
        .expect("entry");
    assert!(entry.linked_module.is_some());
    let err = plan_replication(
        &fe.store,
        &fe.roots,
        &fe.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src/app".to_string(),
            rels: vec!["src/app/audit".to_string()],
            target: ReplicateTarget::New {
                name: "Front".to_string(),
            },
        },
    )
    .expect_err("nothing new");
    assert_eq!(err.kind, "replicate_nothing_new");
    fe.cleanup();
}

#[test]
fn apply_creates_project_modules_and_links_on_draft() {
    let mut fe = fixture(angular);
    let plan = plan_replication(
        &fe.store,
        &fe.roots,
        &fe.links,
        &ReplicateInput {
            root_id: "root-1".to_string(),
            base: "src/app".to_string(),
            rels: vec!["src/app/clasificadores".to_string()],
            target: ReplicateTarget::New {
                name: "Front".to_string(),
            },
        },
    )
    .expect("plan");
    let mut draft = fe.store.clone();
    let mut ids = fe.ids.clone();
    let applied = ruth_api::apply_replication(&mut draft, &mut ids, &plan).expect("apply");
    assert!(applied.project_created);
    assert_eq!(applied.modules.len(), 1);
    assert_eq!(applied.modules[0].name, "clasificadores");
    let project = draft
        .project(&ruth_core::domain::ProjectId::new(applied.project_id.clone()).expect("id"))
        .expect("project");
    assert_eq!(project.name(), "Front");
    let links = build_replication_links(
        &draft,
        fe.roots.roots(),
        &fe.links,
        &mut ids,
        "root-1",
        &applied,
        "t",
    )
    .expect("links");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].owner_id, applied.modules[0].module_id);
    assert_eq!(links[0].rel, "src/app/clasificadores");
    // The plan mutated nothing: the original still has one project.
    assert_eq!(fe.store.projects().len(), 1);
    fe.cleanup();
}
