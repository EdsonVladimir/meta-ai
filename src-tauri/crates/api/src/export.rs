//! Reproducible baseline export: the file package and the deterministic
//! ZIP build exclusively from the given baseline, never from the current
//! (`latest`) versions. For the same baseline and the same exporter
//! version, the content is identical.
//!
//! It exports no keys, SQLite databases, chat histories, raw API
//! responses, discarded proposals or off-baseline artifacts.

use std::io::Write;

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, BaselineId, DeliveryId, ProjectId, VersionId};
use ruth_meta::design::{parse_design_output, to_mermaid, DesignKind, ValidatedDesign};
use ruth_meta::mockup::{summarize_mockup, validate_mockup_value, ValidatedMockup};
use ruth_store::BaselineMetaLog;
use sha2::{Digest, Sha256};

use crate::baseline::{approval_dto, kind_str, provenance_dto};
use crate::dto::{
    ApprovalDto, DeliveryExportPreviewDto, ExportFileDto, ExportPreviewDto, ProvenanceDto,
};
use crate::error::ApiError;

/// Export format version. On change, older ZIPs are no longer
/// binary-comparable with new ones.
pub const EXPORTER_VERSION: u32 = 1;
pub const EXPORT_FORMAT: &str = "ruth-baseline-export";
/// Reasonable limits: a larger delivery must split into baselines.
pub const MAX_EXPORT_ARTIFACTS: usize = 500;
pub const MAX_EXPORT_FILE_BYTES: usize = 1024 * 1024;
pub const MAX_EXPORT_TOTAL_BYTES: usize = 16 * 1024 * 1024;

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        write!(out, "{byte:02x}").expect("in-memory hex");
    }
    out
}

/// File name derived from the ID, never from free titles: keeps
/// letters, digits, `-` and `_`; anything else becomes `_`. No slashes
/// or escape sequences possible.
fn safe_stem(id: &str) -> String {
    let mut stem: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(64)
        .collect();
    if stem.trim_matches(['_', '.']).is_empty() {
        stem = "artifact".to_string();
    }
    stem
}

fn design_kind(kind: ArtifactType) -> Option<DesignKind> {
    match kind {
        ArtifactType::Flow => Some(DesignKind::Flow),
        ArtifactType::DataModel => Some(DesignKind::DataModel),
        ArtifactType::Requirement | ArtifactType::Mockup => None,
    }
}

/// Baseline or delivery entry resolved against the domain. Everything
/// comes from the exact pinned version, not the current one; the title
/// is the pinned-at-creation one, never the current (`latest`).
/// `stale_sources` identifies sources that are no longer current (work
/// deliveries show them; approved baselines ignore them to keep their bytes).
struct Entry {
    artifact_id: String,
    kind: ArtifactType,
    module: String,
    title: Option<String>,
    version_id: String,
    number: u32,
    content: String,
    provenance: ProvenanceDto,
    approvals: Vec<ApprovalDto>,
    sources: Vec<String>,
    stale_sources: Vec<String>,
    artifact_file: String,
    design: Option<ValidatedDesign>,
    mockup: Option<ValidatedMockup>,
    diagram_file: Option<String>,
    diagram_ok: bool,
}

fn resolve_entries(
    store: &Store,
    project: &ProjectId,
    id: &BaselineId,
) -> Result<(String, String, Vec<Entry>), ApiError> {
    let baseline_id = id.as_str();
    let Some(baseline) = store.baseline(id) else {
        return Err(ApiError::coded(
            "baseline_not_found",
            format!("Baseline {baseline_id} does not exist."),
        ));
    };
    if baseline.project() != project {
        return Err(ApiError::coded(
            "baseline_not_found",
            format!("Baseline {baseline_id} does not belong to this project."),
        ));
    }
    if baseline.entries().len() > MAX_EXPORT_ARTIFACTS {
        return Err(ApiError::coded(
            "export_too_large",
            format!(
                "The baseline holds {} artifacts; the exportable maximum is {}.",
                baseline.entries().len(),
                MAX_EXPORT_ARTIFACTS
            ),
        ));
    }
    let entries = resolve_pinned(
        store,
        baseline.entries(),
        &|artifact| baseline.title_of(artifact).flatten().map(str::to_string),
        "baseline_dangling",
        "The baseline",
    )?;
    Ok((
        baseline.id().as_str().to_string(),
        baseline.at().as_str().to_string(),
        entries,
    ))
}

fn resolve_delivery_entries(
    store: &Store,
    project: &ProjectId,
    id: &DeliveryId,
) -> Result<(String, String, Vec<Entry>), ApiError> {
    let delivery_id = id.as_str();
    let Some(delivery) = store.delivery(id) else {
        return Err(ApiError::coded(
            "delivery_not_found",
            format!("Delivery {delivery_id} does not exist."),
        ));
    };
    if delivery.project() != project {
        return Err(ApiError::coded(
            "delivery_not_found",
            format!("Delivery {delivery_id} does not belong to this project."),
        ));
    }
    if delivery.entries().len() > MAX_EXPORT_ARTIFACTS {
        return Err(ApiError::coded(
            "export_too_large",
            format!(
                "The delivery holds {} artifacts; the exportable maximum is {}.",
                delivery.entries().len(),
                MAX_EXPORT_ARTIFACTS
            ),
        ));
    }
    let entries = resolve_pinned(
        store,
        delivery.entries(),
        &|artifact| delivery.title_of(artifact).flatten().map(str::to_string),
        "delivery_dangling",
        "The delivery",
    )?;
    Ok((
        delivery.id().as_str().to_string(),
        delivery.at().as_str().to_string(),
        entries,
    ))
}

/// Resolves pinned versions against the domain, with size limits.
/// Shared by baselines and deliveries: same package for the same
/// versions, except each kind's own notices.
fn resolve_pinned(
    store: &Store,
    pairs: &[(ArtifactId, VersionId)],
    title_of: &dyn Fn(&ArtifactId) -> Option<String>,
    dangling_kind: &'static str,
    dangling_label: &'static str,
) -> Result<Vec<Entry>, ApiError> {
    let mut entries = Vec::with_capacity(pairs.len());
    let mut total: usize = 0;
    for (artifact, version) in pairs {
        let (Some(known), Some(pinned)) = (store.artifact(artifact), store.version(version)) else {
            // The core forbids deleting history: this should not happen.
            return Err(ApiError::coded(
                dangling_kind,
                format!(
                    "{dangling_label} references {} {}, which is no longer in the domain.",
                    artifact.as_str(),
                    version.as_str()
                ),
            ));
        };
        let content = pinned.content().as_str().to_string();
        if content.len() > MAX_EXPORT_FILE_BYTES {
            return Err(ApiError::coded(
                "export_too_large",
                format!(
                    "The content of {} exceeds the maximum of {} bytes.",
                    artifact.as_str(),
                    MAX_EXPORT_FILE_BYTES
                ),
            ));
        }
        total += content.len();
        if total > MAX_EXPORT_TOTAL_BYTES {
            return Err(ApiError::coded(
                "export_too_large",
                format!(
                    "The total content exceeds the maximum of {} bytes.",
                    MAX_EXPORT_TOTAL_BYTES
                ),
            ));
        }
        let stem = safe_stem(artifact.as_str());
        let ext = match known.artifact_type() {
            ArtifactType::Requirement => "txt",
            ArtifactType::Flow | ArtifactType::DataModel | ArtifactType::Mockup => "json",
        };
        let mut stale_sources = Vec::new();
        for source in pinned.sources() {
            let outdated = store
                .version(source)
                .and_then(|v| store.current_version(v.artifact()))
                .map(|c| c.id() != source)
                .unwrap_or(false);
            if outdated {
                stale_sources.push(source.as_str().to_string());
            }
        }
        stale_sources.sort();
        entries.push(Entry {
            artifact_id: artifact.as_str().to_string(),
            kind: known.artifact_type(),
            module: known.module().as_str().to_string(),
            title: title_of(artifact),
            version_id: version.as_str().to_string(),
            number: pinned.number(),
            content,
            provenance: provenance_dto(pinned.provenance()),
            approvals: store
                .approvals_of(pinned.id())
                .iter()
                .map(|a| approval_dto(a))
                .collect(),
            sources: pinned
                .sources()
                .iter()
                .map(|s| s.as_str().to_string())
                .collect(),
            stale_sources,
            artifact_file: format!("artifacts/{}-{stem}.{ext}", kind_str(known.artifact_type())),
            design: None,
            mockup: None,
            diagram_file: None,
            diagram_ok: false,
        });
    }
    Ok(entries)
}

/// Package file: safe relative path and exact content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

fn render_designs(entries: &mut [Entry], allowed: &[String]) -> Vec<ExportFile> {
    let mut diagrams = Vec::new();
    for entry in entries.iter_mut() {
        // Mockups produce no diagrams: they revalidate against their citations
        // for the spec's structured summary.
        if entry.kind == ArtifactType::Mockup {
            if let Ok(spec) = serde_json::from_str::<serde_json::Value>(&entry.content) {
                let cited = crate::mockup::mockup_cited_refs(&spec);
                if let Ok(mockup) = validate_mockup_value(&spec, &cited) {
                    entry.mockup = Some(mockup);
                }
            }
            continue;
        }
        let Some(kind) = design_kind(entry.kind) else {
            continue;
        };
        let stem = safe_stem(&entry.artifact_id);
        let path = format!("diagrams/{}-{stem}.mmd", kind_str(entry.kind));
        match parse_design_output(&entry.content, kind, allowed) {
            Ok(design) => {
                diagrams.push(ExportFile {
                    path: path.clone(),
                    bytes: to_mermaid(&design).into_bytes(),
                });
                entry.design = Some(design);
                entry.diagram_ok = true;
            }
            Err(_) => {
                // Legacy unstructured content: no diagram is invented;
                // a comment pointing to the original is left instead.
                diagrams.push(ExportFile {
                    path: path.clone(),
                    bytes: format!(
                        "%% Design {}: unstructured content; see {}.\n",
                        entry.artifact_id, entry.artifact_file
                    )
                    .into_bytes(),
                });
                entry.diagram_ok = false;
            }
        }
        entry.diagram_file = Some(path);
    }
    diagrams
}

fn plural(count: usize, one: &'static str, many: &'static str) -> &'static str {
    if count == 1 {
        one
    } else {
        many
    }
}

/// A one-line title for Markdown headings: no breaks that would
/// break the structure (the full title lives in the manifest).
fn one_line(title: &str) -> String {
    title
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
}

fn kind_label(kind: ArtifactType) -> &'static str {
    match kind {
        ArtifactType::Requirement => "requirement",
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data model",
        ArtifactType::Mockup => "mockup",
    }
}

fn provenance_label(provenance: &ProvenanceDto) -> String {
    match provenance.kind.as_str() {
        "human" => format!("human ({})", provenance.by),
        _ => format!("AI proposal ({})", provenance.by),
    }
}

/// Exported delivery kind. The approved baseline keeps its exact
/// bytes; the work delivery adds honest identification of
/// pendings (never called coherent or verified).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExportKind {
    ApprovedBaseline,
    WorkDelivery,
}

fn build_readme(
    name: &str,
    id: &str,
    at: &str,
    project: &str,
    scope: Option<&str>,
    entries: &[Entry],
    total_bytes: usize,
    kind: ExportKind,
) -> String {
    let reqs = entries
        .iter()
        .filter(|e| e.kind == ArtifactType::Requirement)
        .count();
    let designs = entries.len() - reqs;
    let id_label = match kind {
        ExportKind::ApprovedBaseline => "Baseline",
        ExportKind::WorkDelivery => "Work delivery",
    };
    let context_line = match kind {
        ExportKind::ApprovedBaseline => "context for implementing the approved scope",
        ExportKind::WorkDelivery => "context for continuing the work",
    };
    let mut out = format!(
        "# {name}\n\
         \n\
         Specification exported by Ruth IDE (exporter v{EXPORTER_VERSION}).\n\
         \n\
         - {id_label}: {id} ({at})\n\
         - Project: {project}\n\
         - Scope: {}\n\
         - Content: {reqs} requirements, {designs} designs, {total_bytes} bytes\n\
         \n\
         ## How to read this package\n\
         \n\
         - `specification.md`: included requirements and designs, with sources and approvals.\n\
         - `artifacts/`: original content of each included version.\n\
         - `diagrams/`: Mermaid sources derived from the designs (regenerated; do not edit).\n\
         - `manifest.json`: inventory with SHA-256 hashes for checking integrity.\n\
         - `implementation-context.md`: {context_line}.\n\
         \n\
         ## Limits\n\
         \n\
         - SHA-256 hashes verify integrity; they are not a digital signature.\n\
         - Valid Mermaid syntax does not guarantee design correctness.\n\
         - Open questions and assumptions live in `implementation-context.md`.\n\
         - This delivery is immutable: it never changes as the project advances.\n",
        scope
            .map(|m| format!("module {m}"))
            .unwrap_or_else(|| "manual selection (see manifest.json)".to_string())
    );
    if kind == ExportKind::WorkDelivery {
        let unreviewed = entries.iter().filter(|e| e.approvals.is_empty()).count();
        let stale = entries
            .iter()
            .filter(|e| !e.stale_sources.is_empty())
            .count();
        out.push_str(&format!(
            "\n## Work status\n\
             \n\
             Work delivery (draft): snapshot of saved versions without requiring review.\n\
             - Unreviewed entries: {unreviewed} of {}\n\
             - Entries with stale sources: {stale} of {}\n\
             \n\
             Not a coherent or verified delivery: sync and review before\n\
             taking it as a stable reference.\n",
            entries.len(),
            entries.len(),
        ));
    }
    out
}

fn build_specification(
    name: &str,
    id: &str,
    at: &str,
    entries: &[Entry],
    kind: ExportKind,
) -> String {
    let id_label = match kind {
        ExportKind::ApprovedBaseline => "Baseline",
        ExportKind::WorkDelivery => "Work delivery",
    };
    let mut out = format!("# Specification — {name}\n\n{id_label} {id} ({at}).\n");
    for entry in entries {
        // The heading shows the baseline-pinned title (when any)
        // without ever hiding the ID: identity is the ID, not the title.
        let heading = match &entry.title {
            Some(title) => format!(
                "{} — {} ({}, version {}, no. {})",
                one_line(title),
                entry.artifact_id,
                kind_label(entry.kind),
                entry.version_id,
                entry.number
            ),
            None => format!(
                "{} — {} (version {}, no. {})",
                entry.artifact_id,
                kind_label(entry.kind),
                entry.version_id,
                entry.number
            ),
        };
        out.push_str(&format!(
            "\n## {heading}\n\n\
             - Provenance: {}\n",
            provenance_label(&entry.provenance),
        ));
        for approval in &entry.approvals {
            out.push_str(&format!(
                "- Approval: {} ({})\n",
                approval.approved_by, approval.at
            ));
        }
        if entry.sources.is_empty() {
            out.push_str("- Sources: none\n");
        } else {
            out.push_str(&format!("- Sources: {}\n", entry.sources.join(", ")));
        }
        if kind == ExportKind::WorkDelivery {
            if entry.stale_sources.is_empty() {
                out.push_str("- Stale sources: none\n");
            } else {
                out.push_str(&format!(
                    "- Stale sources: {}\n",
                    entry.stale_sources.join(", ")
                ));
            }
        }
        out.push_str(&format!("- Original: `{}`\n", entry.artifact_file));
        if entry.kind == ArtifactType::Requirement {
            out.push_str("\n### Content\n\n");
            out.push_str(&entry.content);
            out.push('\n');
        } else if let Some(design) = &entry.design {
            if let Some(diagram) = &entry.diagram_file {
                out.push_str(&format!("- Diagram: `{diagram}`\n"));
            }
            out.push_str(&format!(
                "\n### {}\n\n{}\n",
                design.title, design.explanation
            ));
            match (&design.flow, &design.er) {
                (Some(flow), _) => out.push_str(&format!(
                    "\nElements: {} {}, {} {}.\n",
                    flow.nodes.len(),
                    plural(flow.nodes.len(), "node", "nodes"),
                    flow.edges.len(),
                    plural(flow.edges.len(), "edge", "edges"),
                )),
                (_, Some(er)) => out.push_str(&format!(
                    "\nElements: {} {}, {} {}.\n",
                    er.entities.len(),
                    plural(er.entities.len(), "entity", "entities"),
                    er.relations.len(),
                    plural(er.relations.len(), "relation", "relations"),
                )),
                (None, None) => {}
            }
            if !design.questions.is_empty() {
                out.push_str("\nOpen questions:\n\n");
                for question in &design.questions {
                    out.push_str(&format!("- {question}\n"));
                }
            }
        } else if let Some(mockup) = &entry.mockup {
            out.push_str(&format!(
                "\n### {}\n\n{}\n",
                mockup.title,
                summarize_mockup(mockup)
            ));
        } else {
            out.push_str("\nUnstructured content: see the original file.\n");
        }
    }
    out.push('\n');
    out
}

fn build_context(name: &str, id: &str, entries: &[Entry], kind: ExportKind) -> String {
    let mut modules: Vec<&str> = entries.iter().map(|e| e.module.as_str()).collect();
    modules.sort();
    modules.dedup();
    let (scope_line, rules_title) = match kind {
        ExportKind::ApprovedBaseline => (
            format!(
                "Approved scope of baseline {id}: modules {}.",
                modules.join(", ")
            ),
            "Approved rules",
        ),
        ExportKind::WorkDelivery => (
            format!(
                "Work scope of delivery {id}: modules {}.",
                modules.join(", ")
            ),
            "Included rules",
        ),
    };
    let work_line = match kind {
        ExportKind::ApprovedBaseline => {
            "Implement only what is described here; the rest is out of the delivery."
        }
        ExportKind::WorkDelivery => {
            "Continue the work only on what is described here; the rest is out of the delivery."
        }
    };
    let mut out = format!(
        "# Implementation context — {name}\n\
         \n\
         {scope_line}\n\
         {work_line}\n\
         \n\
         ## {rules_title}\n",
    );
    for entry in entries
        .iter()
        .filter(|e| e.kind == ArtifactType::Requirement)
    {
        let heading = match &entry.title {
            Some(title) => format!(
                "{} — {} (version {})",
                one_line(title),
                entry.artifact_id,
                entry.version_id
            ),
            None => format!("{} (version {})", entry.artifact_id, entry.version_id),
        };
        out.push_str(&format!("\n### {heading}\n\n{}\n", entry.content));
    }
    let designs_title = match kind {
        ExportKind::ApprovedBaseline => "Approved designs",
        ExportKind::WorkDelivery => "Included designs",
    };
    out.push_str(&format!(
        "\n## {designs_title}\n\
         \n\
         The source diagrams live in `diagrams/` and their structured content\n\
         in `artifacts/`; `specification.md` details each one.\n",
    ));
    for entry in entries
        .iter()
        .filter(|e| e.kind != ArtifactType::Requirement)
    {
        // `design.title` is the inner title of the JSON spec;
        // the artifact's pinned title precedes it when present.
        let head = match &entry.title {
            Some(title) => format!(
                "{} — {} ({})",
                one_line(title),
                entry.artifact_id,
                entry.version_id
            ),
            None => format!("{} ({})", entry.artifact_id, entry.version_id),
        };
        match (&entry.design, &entry.mockup) {
            (Some(design), _) => out.push_str(&format!(
                "\n- {head}: {} — {}\n",
                design.title, design.explanation
            )),
            (_, Some(mockup)) => {
                let total: usize = mockup.screens.iter().map(|s| s.components.len()).sum();
                out.push_str(&format!(
                    "\n- {head}: {} — {} {}, {} {} (ver `specification.md`).\n",
                    mockup.title,
                    mockup.screens.len(),
                    plural(mockup.screens.len(), "screen", "screens"),
                    total,
                    plural(total, "component", "components"),
                ));
            }
            (None, None) => out.push_str(&format!(
                "\n- {head}: unstructured content; see `{}`.\n",
                entry.artifact_file
            )),
        }
    }
    out.push_str(
        "\n## Process constraints\n\
         \n\
         The exporter adds them; they are not the project's recorded decisions:\n\
         \n\
         - Do not invent stack, architecture, decisions or already implemented code.\n\
         - Do not implement open assumptions as if they were approved.\n\
         - On ambiguity, ask instead of deciding.\n\
         \n\
         ## Open questions and assumptions\n",
    );
    let mut any = false;
    for entry in entries.iter().filter_map(|e| {
        e.design
            .as_ref()
            .filter(|d| !d.questions.is_empty())
            .map(|d| (e, d))
    }) {
        any = true;
        for question in &entry.1.questions {
            out.push_str(&format!("- [{}] {question}\n", entry.0.artifact_id));
        }
    }
    if !any {
        out.push_str("\nNone recorded in this delivery.\n");
    } else {
        out.push('\n');
    }
    out
}

/// Manifest header: delivery identity and human metadata.
struct ManifestHead<'a> {
    id: &'a str,
    at: &'a str,
    project: &'a str,
    name: Option<&'a str>,
    description: Option<&'a str>,
    scope: Option<&'a str>,
    kind: ExportKind,
}

fn build_manifest(head: &ManifestHead<'_>, entries: &[Entry], files: &[ExportFile]) -> String {
    let mut root = serde_json::Map::new();
    root.insert("format".to_string(), serde_json::json!(EXPORT_FORMAT));
    root.insert(
        "format_version".to_string(),
        serde_json::json!(EXPORTER_VERSION),
    );
    root.insert(
        "exporter".to_string(),
        serde_json::json!(format!("ruth-export/{EXPORTER_VERSION}")),
    );
    let mut head_obj = serde_json::Map::new();
    head_obj.insert("id".to_string(), serde_json::json!(head.id));
    head_obj.insert("project".to_string(), serde_json::json!(head.project));
    head_obj.insert("created_at".to_string(), serde_json::json!(head.at));
    if head.kind == ExportKind::WorkDelivery {
        head_obj.insert("kind".to_string(), serde_json::json!("work_draft"));
    }
    if let Some(name) = head.name {
        head_obj.insert("name".to_string(), serde_json::json!(name));
    }
    if let Some(description) = head.description {
        head_obj.insert("description".to_string(), serde_json::json!(description));
    }
    if let Some(scope) = head.scope {
        head_obj.insert("scope_module".to_string(), serde_json::json!(scope));
    } else {
        head_obj.insert("scope_module".to_string(), serde_json::Value::Null);
    }
    let head_key = match head.kind {
        ExportKind::ApprovedBaseline => "baseline",
        ExportKind::WorkDelivery => "delivery",
    };
    root.insert(head_key.to_string(), serde_json::Value::Object(head_obj));
    let entry_values: Vec<serde_json::Value> = entries
        .iter()
        .map(|e| {
            let mut entry = serde_json::Map::new();
            entry.insert("artifact".to_string(), serde_json::json!(e.artifact_id));
            entry.insert("kind".to_string(), serde_json::json!(kind_str(e.kind)));
            entry.insert("module".to_string(), serde_json::json!(e.module));
            entry.insert("title".to_string(), serde_json::json!(e.title));
            entry.insert("version".to_string(), serde_json::json!(e.version_id));
            entry.insert("number".to_string(), serde_json::json!(e.number));
            entry.insert(
                "provenance".to_string(),
                serde_json::json!({
                    "kind": e.provenance.kind,
                    "by": e.provenance.by,
                }),
            );
            entry.insert(
                "approvals".to_string(),
                serde_json::json!(e
                    .approvals
                    .iter()
                    .map(|a| {
                        serde_json::json!({
                            "version": a.version_id,
                            "approved_by": a.approved_by,
                            "at": a.at,
                        })
                    })
                    .collect::<Vec<_>>()),
            );
            entry.insert("sources".to_string(), serde_json::json!(e.sources));
            // Work deliveries only: baselines keep their bytes.
            if head.kind == ExportKind::WorkDelivery {
                entry.insert(
                    "stale_sources".to_string(),
                    serde_json::json!(e.stale_sources),
                );
            }
            entry.insert(
                "content_sha256".to_string(),
                serde_json::json!(sha256_hex(e.content.as_bytes())),
            );
            entry.insert(
                "content_bytes".to_string(),
                serde_json::json!(e.content.len()),
            );
            entry.insert(
                "artifact_file".to_string(),
                serde_json::json!(e.artifact_file),
            );
            entry.insert(
                "diagram_file".to_string(),
                serde_json::json!(e.diagram_file),
            );
            entry.insert("diagram_ok".to_string(), serde_json::json!(e.diagram_ok));
            serde_json::Value::Object(entry)
        })
        .collect();
    root.insert(
        "entries".to_string(),
        serde_json::Value::Array(entry_values),
    );
    // The manifest excludes itself to avoid self-reference.
    let file_values: Vec<serde_json::Value> = files
        .iter()
        .filter(|f| f.path != "manifest.json")
        .map(|f| {
            serde_json::json!({
                "path": f.path,
                "sha256": sha256_hex(&f.bytes),
                "bytes": f.bytes.len(),
            })
        })
        .collect();
    root.insert("files".to_string(), serde_json::Value::Array(file_values));
    let mut counts = serde_json::Map::new();
    counts.insert("entries".to_string(), serde_json::json!(entries.len()));
    counts.insert("files".to_string(), serde_json::json!(files.len()));
    counts.insert(
        "total_bytes".to_string(),
        serde_json::json!(files.iter().map(|f| f.bytes.len()).sum::<usize>()),
    );
    // Work deliveries only: honest pendings in the manifest.
    if head.kind == ExportKind::WorkDelivery {
        counts.insert(
            "unreviewed_entries".to_string(),
            serde_json::json!(entries.iter().filter(|e| e.approvals.is_empty()).count()),
        );
        counts.insert(
            "stale_entries".to_string(),
            serde_json::json!(entries
                .iter()
                .filter(|e| !e.stale_sources.is_empty())
                .count()),
        );
    }
    root.insert("counts".to_string(), serde_json::Value::Object(counts));
    format!(
        "{}\n",
        serde_json::to_string_pretty(&root).expect("the manifest serializes")
    )
}

/// Builds the package files ordered by path. Pure query:
/// touches neither the domain nor the database.
pub fn build_export_files(
    store: &Store,
    metalog: &BaselineMetaLog,
    project_id: &str,
    baseline_id: &str,
) -> Result<Vec<ExportFile>, ApiError> {
    let project = ProjectId::new(project_id).map_err(|_| {
        ApiError::coded(
            "baseline_not_found",
            format!("Baseline {baseline_id} does not exist."),
        )
    })?;
    let baseline_ref = BaselineId::new(baseline_id).map_err(|_| {
        ApiError::coded(
            "baseline_not_found",
            format!("Baseline {baseline_id} does not exist."),
        )
    })?;
    let (id, at, mut entries) = resolve_entries(store, &project, &baseline_ref)?;
    let meta = metalog.get(baseline_ref.as_str());
    let (name, description, scope) = match meta {
        Some(m) => (
            Some(m.name.as_str()),
            m.description.as_deref(),
            m.scope_module.as_deref(),
        ),
        None => (None, None, None),
    };
    let display = name.unwrap_or(id.as_str());
    Ok(assemble_package(
        display,
        &id,
        &at,
        project_id,
        name,
        description,
        scope,
        &mut entries,
        ExportKind::ApprovedBaseline,
    ))
}

/// Builds a work delivery's files: same safe, reproducible package,
/// with honest identification of pendings (never presented as
/// coherent or verified). Pure query.
pub fn build_delivery_files(
    store: &Store,
    project_id: &str,
    delivery_id: &str,
) -> Result<Vec<ExportFile>, ApiError> {
    let project = ProjectId::new(project_id).map_err(|_| {
        ApiError::coded(
            "delivery_not_found",
            format!("Delivery {delivery_id} does not exist."),
        )
    })?;
    let delivery_ref = DeliveryId::new(delivery_id).map_err(|_| {
        ApiError::coded(
            "delivery_not_found",
            format!("Delivery {delivery_id} does not exist."),
        )
    })?;
    let (id, at, mut entries) = resolve_delivery_entries(store, &project, &delivery_ref)?;
    let Some(delivery) = store.delivery(&delivery_ref) else {
        return Err(ApiError::coded(
            "delivery_not_found",
            format!("Delivery {delivery_id} does not exist."),
        ));
    };
    Ok(assemble_package(
        delivery.name(),
        &id,
        &at,
        project_id,
        Some(delivery.name()),
        delivery.description(),
        delivery.scope_module().map(|m| m.as_str()),
        &mut entries,
        ExportKind::WorkDelivery,
    ))
}

/// Assembles artifacts, diagrams, README, spec, context and
/// manifest, ordered by path. The kind decides only the notices.
#[allow(clippy::too_many_arguments)]
fn assemble_package(
    display: &str,
    id: &str,
    at: &str,
    project_id: &str,
    name: Option<&str>,
    description: Option<&str>,
    scope: Option<&str>,
    entries: &mut [Entry],
    kind: ExportKind,
) -> Vec<ExportFile> {
    let allowed: Vec<String> = entries
        .iter()
        .filter(|e| e.kind == ArtifactType::Requirement)
        .map(|e| e.artifact_id.clone())
        .collect();
    let mut diagrams = render_designs(entries, &allowed);
    let mut files: Vec<ExportFile> = entries
        .iter()
        .map(|e| ExportFile {
            path: e.artifact_file.clone(),
            bytes: e.content.clone().into_bytes(),
        })
        .collect();
    files.append(&mut diagrams);
    let total: usize = entries.iter().map(|e| e.content.len()).sum();
    files.push(ExportFile {
        path: "README.md".to_string(),
        bytes: build_readme(display, id, at, project_id, scope, entries, total, kind).into_bytes(),
    });
    files.push(ExportFile {
        path: "specification.md".to_string(),
        bytes: build_specification(display, id, at, entries, kind).into_bytes(),
    });
    files.push(ExportFile {
        path: "implementation-context.md".to_string(),
        bytes: build_context(display, id, entries, kind).into_bytes(),
    });
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let head = ManifestHead {
        id,
        at,
        project: project_id,
        name,
        description,
        scope,
        kind,
    };
    let manifest = build_manifest(&head, entries, &files);
    files.push(ExportFile {
        path: "manifest.json".to_string(),
        bytes: manifest.into_bytes(),
    });
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

/// Preview for the UI: paths, sizes and hashes without the content.
pub fn export_preview(
    store: &Store,
    metalog: &BaselineMetaLog,
    project_id: &str,
    baseline_id: &str,
) -> Result<ExportPreviewDto, ApiError> {
    let files = build_export_files(store, metalog, project_id, baseline_id)?;
    let dtos = preview_files(&files);
    let total = dtos.iter().map(|f| f.bytes).sum();
    Ok(ExportPreviewDto {
        baseline_id: baseline_id.to_string(),
        exporter_version: EXPORTER_VERSION,
        files: dtos,
        total_bytes: total,
    })
}

/// A work delivery's preview, with its own identity.
pub fn export_delivery_preview(
    store: &Store,
    project_id: &str,
    delivery_id: &str,
) -> Result<DeliveryExportPreviewDto, ApiError> {
    let files = build_delivery_files(store, project_id, delivery_id)?;
    let dtos = preview_files(&files);
    let total = dtos.iter().map(|f| f.bytes).sum();
    Ok(DeliveryExportPreviewDto {
        delivery_id: delivery_id.to_string(),
        exporter_version: EXPORTER_VERSION,
        files: dtos,
        total_bytes: total,
    })
}

fn preview_files(files: &[ExportFile]) -> Vec<ExportFileDto> {
    files
        .iter()
        .map(|f| ExportFileDto {
            path: f.path.clone(),
            bytes: f.bytes.len() as u64,
            sha256: sha256_hex(&f.bytes),
        })
        .collect()
}

/// Packages the files into a deterministic ZIP: fixed order, fixed date,
/// fixed permissions and the same compression. The same package produces
/// the same bytes.
pub fn package_to_zip(files: &[ExportFile]) -> Result<Vec<u8>, ApiError> {
    use std::io::Cursor;
    let mut ordered: Vec<&ExportFile> = files.iter().collect();
    ordered.sort_by(|a, b| a.path.cmp(&b.path));
    let mut out = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut out);
    let stamp = zip::DateTime::from_date_and_time(2024, 1, 1, 0, 0, 0)
        .map_err(|_| ApiError::coded("export_failed", "Could not pin the ZIP date."))?;
    for file in ordered {
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(stamp)
            .unix_permissions(0o644);
        zip.start_file(&file.path, options).map_err(|e| {
            ApiError::coded(
                "export_failed",
                format!("Could not package {}: {e}", file.path),
            )
        })?;
        zip.write_all(&file.bytes).map_err(|e| {
            ApiError::coded(
                "export_failed",
                format!("Could not package {}: {e}", file.path),
            )
        })?;
    }
    zip.finish()
        .map_err(|e| ApiError::coded("export_failed", format!("Could not close the ZIP: {e}")))?;
    Ok(out.into_inner())
}

/// Hash of the resulting ZIP, for showing after saving.
pub fn zip_sha256(zip: &[u8]) -> String {
    sha256_hex(zip)
}
