//! Exportación reproducible de baselines: el paquete de archivos y el ZIP
//! determinista se construyen exclusivamente desde la baseline indicada,
//! nunca desde las versiones actuales (`latest`). Para la misma baseline y
//! la misma versión del exportador, el contenido es idéntico.
//!
//! No exporta claves, bases SQLite, historiales de chat, respuestas crudas
//! de API, propuestas descartadas ni artefactos fuera de la baseline.

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

/// Versión del formato de exportación. Si cambia, los ZIP anteriores ya no
/// son comparables binariamente con los nuevos.
pub const EXPORTER_VERSION: u32 = 1;
pub const EXPORT_FORMAT: &str = "ruth-baseline-export";
/// Límites razonables: una entrega mayor debe dividirse en baselines.
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
        write!(out, "{byte:02x}").expect("hex en memoria");
    }
    out
}

/// Nombre de archivo derivado del ID, nunca de títulos libres: conserva
/// letras, dígitos, `-` y `_`; lo demás se vuelve `_`. Sin barras ni
/// secuencias de escape posibles.
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

/// Entrada de la baseline o entrega resuelta contra el dominio. Todo
/// sale de la versión exacta fijada, no de la actual; el título es el
/// fijado al crear, nunca el vigente (`latest`). `stale_sources` identifica
/// fuentes que ya no son actuales (las entregas de trabajo lo muestran;
/// las baselines aprobadas lo ignoran para conservar sus bytes).
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
            format!("No existe la baseline {baseline_id}."),
        ));
    };
    if baseline.project() != project {
        return Err(ApiError::coded(
            "baseline_not_found",
            format!("La baseline {baseline_id} no es de este proyecto."),
        ));
    }
    if baseline.entries().len() > MAX_EXPORT_ARTIFACTS {
        return Err(ApiError::coded(
            "export_too_large",
            format!(
                "La baseline tiene {} artefactos; el máximo exportable es {}.",
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
        "La baseline",
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
            format!("No existe la entrega {delivery_id}."),
        ));
    };
    if delivery.project() != project {
        return Err(ApiError::coded(
            "delivery_not_found",
            format!("La entrega {delivery_id} no es de este proyecto."),
        ));
    }
    if delivery.entries().len() > MAX_EXPORT_ARTIFACTS {
        return Err(ApiError::coded(
            "export_too_large",
            format!(
                "La entrega tiene {} artefactos; el máximo exportable es {}.",
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
        "La entrega",
    )?;
    Ok((
        delivery.id().as_str().to_string(),
        delivery.at().as_str().to_string(),
        entries,
    ))
}

/// Resuelve versiones fijadas contra el dominio, con límites de tamaño.
/// Compartido por baselines y entregas: mismo paquete para las mismas
/// versiones, salvo los avisos propios de cada clase.
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
            // El núcleo no permite borrar historial: no debería ocurrir.
            return Err(ApiError::coded(
                dangling_kind,
                format!(
                    "{dangling_label} hace referencia a {} {}, que ya no está en el dominio.",
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
                    "El contenido de {} supera el máximo de {} bytes.",
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
                    "El contenido total supera el máximo de {} bytes.",
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

/// Archivo del paquete: ruta relativa segura y contenido exacto.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

fn render_designs(entries: &mut [Entry], allowed: &[String]) -> Vec<ExportFile> {
    let mut diagrams = Vec::new();
    for entry in entries.iter_mut() {
        // Los mockups no producen diagramas: se revalidan contra sus citas
        // para el resumen estructurado de la especificación.
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
                // Contenido heredado no estructurado: no se inventa un
                // diagrama; se deja un comentario que apunta al original.
                diagrams.push(ExportFile {
                    path: path.clone(),
                    bytes: format!(
                        "%% Diseño {}: contenido no estructurado; ver {}.\n",
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

/// Un título en una línea para encabezados Markdown: sin saltos que
/// rompan la estructura (el título completo vive en el manifiesto).
fn one_line(title: &str) -> String {
    title
        .chars()
        .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
        .collect()
}

fn kind_label(kind: ArtifactType) -> &'static str {
    match kind {
        ArtifactType::Requirement => "requisito",
        ArtifactType::Flow => "flujo",
        ArtifactType::DataModel => "modelo de datos",
        ArtifactType::Mockup => "mockup",
    }
}

fn provenance_label(provenance: &ProvenanceDto) -> String {
    match provenance.kind.as_str() {
        "human" => format!("humana ({})", provenance.by),
        _ => format!("propuesta de IA ({})", provenance.by),
    }
}

/// Clase de entrega exportada. La baseline aprobada conserva sus bytes
/// exactos; la entrega de trabajo añade identificación honesta de
/// pendientes (nunca se llama coherente ni verificada).
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
        ExportKind::WorkDelivery => "Entrega de trabajo",
    };
    let context_line = match kind {
        ExportKind::ApprovedBaseline => "contexto para implementar lo aprobado",
        ExportKind::WorkDelivery => "contexto para continuar el trabajo",
    };
    let mut out = format!(
        "# {name}\n\
         \n\
         Especificación exportada por Ruth IDE (exportador v{EXPORTER_VERSION}).\n\
         \n\
         - {id_label}: {id} ({at})\n\
         - Proyecto: {project}\n\
         - Alcance: {}\n\
         - Contenido: {reqs} requisitos, {designs} diseños, {total_bytes} bytes\n\
         \n\
         ## Cómo leer este paquete\n\
         \n\
         - `specification.md`: requisitos y diseños incluidos, con fuentes y aprobaciones.\n\
         - `artifacts/`: contenido original de cada versión incluida.\n\
         - `diagrams/`: fuentes Mermaid derivadas de los diseños (se regeneran; no editar).\n\
         - `manifest.json`: inventario con hashes SHA-256 para comprobar integridad.\n\
         - `implementation-context.md`: {context_line}.\n\
         \n\
         ## Límites\n\
         \n\
         - Los hashes SHA-256 verifican integridad; no son una firma digital.\n\
         - Sintaxis Mermaid válida no garantiza corrección del diseño.\n\
         - Las preguntas y supuestos pendientes están en `implementation-context.md`.\n\
         - Esta entrega es inmutable: no cambia aunque el proyecto avance.\n",
        scope
            .map(|m| format!("módulo {m}"))
            .unwrap_or_else(|| "selección manual (ver manifest.json)".to_string())
    );
    if kind == ExportKind::WorkDelivery {
        let unreviewed = entries.iter().filter(|e| e.approvals.is_empty()).count();
        let stale = entries
            .iter()
            .filter(|e| !e.stale_sources.is_empty())
            .count();
        out.push_str(&format!(
            "\n## Estado del trabajo\n\
             \n\
             Entrega de trabajo (borrador): foto de versiones guardadas sin exigir revisión.\n\
             - Entradas sin revisión: {unreviewed} de {}\n\
             - Entradas con fuentes desactualizadas: {stale} de {}\n\
             \n\
             No es una entrega coherente ni verificada: sincroniza y revisa antes de\n\
             tomarla como referencia estable.\n",
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
        ExportKind::WorkDelivery => "Entrega de trabajo",
    };
    let mut out = format!("# Especificación — {name}\n\n{id_label} {id} ({at}).\n");
    for entry in entries {
        // El encabezado muestra el título fijado en la baseline (si lo hay)
        // sin ocultar nunca el ID: la identidad es el ID, no el título.
        let heading = match &entry.title {
            Some(title) => format!(
                "{} — {} ({}, versión {}, nº {})",
                one_line(title),
                entry.artifact_id,
                kind_label(entry.kind),
                entry.version_id,
                entry.number
            ),
            None => format!(
                "{} — {} (versión {}, nº {})",
                entry.artifact_id,
                kind_label(entry.kind),
                entry.version_id,
                entry.number
            ),
        };
        out.push_str(&format!(
            "\n## {heading}\n\n\
             - Procedencia: {}\n",
            provenance_label(&entry.provenance),
        ));
        for approval in &entry.approvals {
            out.push_str(&format!(
                "- Aprobación: {} ({})\n",
                approval.approved_by, approval.at
            ));
        }
        if entry.sources.is_empty() {
            out.push_str("- Fuentes: ninguna\n");
        } else {
            out.push_str(&format!("- Fuentes: {}\n", entry.sources.join(", ")));
        }
        if kind == ExportKind::WorkDelivery {
            if entry.stale_sources.is_empty() {
                out.push_str("- Fuentes desactualizadas: ninguna\n");
            } else {
                out.push_str(&format!(
                    "- Fuentes desactualizadas: {}\n",
                    entry.stale_sources.join(", ")
                ));
            }
        }
        out.push_str(&format!("- Original: `{}`\n", entry.artifact_file));
        if entry.kind == ArtifactType::Requirement {
            out.push_str("\n### Contenido\n\n");
            out.push_str(&entry.content);
            out.push('\n');
        } else if let Some(design) = &entry.design {
            if let Some(diagram) = &entry.diagram_file {
                out.push_str(&format!("- Diagrama: `{diagram}`\n"));
            }
            out.push_str(&format!(
                "\n### {}\n\n{}\n",
                design.title, design.explanation
            ));
            match (&design.flow, &design.er) {
                (Some(flow), _) => out.push_str(&format!(
                    "\nElementos: {} {}, {} {}.\n",
                    flow.nodes.len(),
                    plural(flow.nodes.len(), "nodo", "nodos"),
                    flow.edges.len(),
                    plural(flow.edges.len(), "arista", "aristas"),
                )),
                (_, Some(er)) => out.push_str(&format!(
                    "\nElementos: {} {}, {} {}.\n",
                    er.entities.len(),
                    plural(er.entities.len(), "entidad", "entidades"),
                    er.relations.len(),
                    plural(er.relations.len(), "relación", "relaciones"),
                )),
                (None, None) => {}
            }
            if !design.questions.is_empty() {
                out.push_str("\nPreguntas pendientes:\n\n");
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
            out.push_str("\nContenido no estructurado: ver el archivo original.\n");
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
                "Alcance aprobado de la baseline {id}: módulos {}.",
                modules.join(", ")
            ),
            "Reglas aprobadas",
        ),
        ExportKind::WorkDelivery => (
            format!(
                "Alcance de trabajo de la entrega {id}: módulos {}.",
                modules.join(", ")
            ),
            "Reglas incluidas",
        ),
    };
    let work_line = match kind {
        ExportKind::ApprovedBaseline => {
            "Implementar solo lo descrito aquí; lo demás está fuera de la entrega."
        }
        ExportKind::WorkDelivery => {
            "Continuar el trabajo solo sobre lo descrito aquí; lo demás está fuera de la entrega."
        }
    };
    let mut out = format!(
        "# Contexto de implementación — {name}\n\
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
                "{} — {} (versión {})",
                one_line(title),
                entry.artifact_id,
                entry.version_id
            ),
            None => format!("{} (versión {})", entry.artifact_id, entry.version_id),
        };
        out.push_str(&format!("\n### {heading}\n\n{}\n", entry.content));
    }
    let designs_title = match kind {
        ExportKind::ApprovedBaseline => "Diseños aprobados",
        ExportKind::WorkDelivery => "Diseños incluidos",
    };
    out.push_str(&format!(
        "\n## {designs_title}\n\
         \n\
         Los diagramas fuente están en `diagrams/` y su contenido estructurado\n\
         en `artifacts/`; `specification.md` detalla cada uno.\n",
    ));
    for entry in entries
        .iter()
        .filter(|e| e.kind != ArtifactType::Requirement)
    {
        // `design.title` es el título interno de la especificación JSON;
        // el título fijado del artefacto lo precede cuando existe.
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
                    plural(mockup.screens.len(), "pantalla", "pantallas"),
                    total,
                    plural(total, "componente", "componentes"),
                ));
            }
            (None, None) => out.push_str(&format!(
                "\n- {head}: contenido no estructurado; ver `{}`.\n",
                entry.artifact_file
            )),
        }
    }
    out.push_str(
        "\n## Restricciones del proceso\n\
         \n\
         Las añade el exportador; no son decisiones registradas del proyecto:\n\
         \n\
         - No inventar stack, arquitectura, decisiones ni código ya implementado.\n\
         - No implementar supuestos pendientes como si estuvieran aprobados.\n\
         - Ante una ambigüedad, preguntar en lugar de decidir.\n\
         \n\
         ## Preguntas y supuestos pendientes\n",
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
        out.push_str("\nNinguna registrada en esta entrega.\n");
    } else {
        out.push('\n');
    }
    out
}

/// Cabecera del manifiesto: identidad de la entrega y metadatos humanos.
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
            // Solo entregas de trabajo: las baselines conservan sus bytes.
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
    // El manifiesto se excluye a sí mismo para evitar autorreferencia.
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
    // Solo entregas de trabajo: pendientes honestos en el manifiesto.
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
        serde_json::to_string_pretty(&root).expect("el manifiesto serializa")
    )
}

/// Construye los archivos del paquete ordenados por ruta. Consulta pura:
/// no toca el dominio ni la base.
pub fn build_export_files(
    store: &Store,
    metalog: &BaselineMetaLog,
    project_id: &str,
    baseline_id: &str,
) -> Result<Vec<ExportFile>, ApiError> {
    let project = ProjectId::new(project_id).map_err(|_| {
        ApiError::coded(
            "baseline_not_found",
            format!("No existe la baseline {baseline_id}."),
        )
    })?;
    let baseline_ref = BaselineId::new(baseline_id).map_err(|_| {
        ApiError::coded(
            "baseline_not_found",
            format!("No existe la baseline {baseline_id}."),
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

/// Construye los archivos de una entrega de trabajo: mismo paquete seguro
/// y reproducible, con identificación honesta de pendientes (nunca se
/// presenta como coherente ni verificada). Consulta pura.
pub fn build_delivery_files(
    store: &Store,
    project_id: &str,
    delivery_id: &str,
) -> Result<Vec<ExportFile>, ApiError> {
    let project = ProjectId::new(project_id).map_err(|_| {
        ApiError::coded(
            "delivery_not_found",
            format!("No existe la entrega {delivery_id}."),
        )
    })?;
    let delivery_ref = DeliveryId::new(delivery_id).map_err(|_| {
        ApiError::coded(
            "delivery_not_found",
            format!("No existe la entrega {delivery_id}."),
        )
    })?;
    let (id, at, mut entries) = resolve_delivery_entries(store, &project, &delivery_ref)?;
    let Some(delivery) = store.delivery(&delivery_ref) else {
        return Err(ApiError::coded(
            "delivery_not_found",
            format!("No existe la entrega {delivery_id}."),
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

/// Ensambla artefactos, diagramas, README, especificación, contexto y
/// manifiesto, ordenados por ruta. La clase decide solo los avisos.
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

/// Vista previa para la UI: rutas, tamaños y hashes sin el contenido.
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

/// Vista previa de una entrega de trabajo, con su propia identidad.
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

/// Empaqueta los archivos en un ZIP determinista: orden fijo, fecha fija,
/// permisos fijos y la misma compresión. El mismo paquete produce los
/// mismos bytes.
pub fn package_to_zip(files: &[ExportFile]) -> Result<Vec<u8>, ApiError> {
    use std::io::Cursor;
    let mut ordered: Vec<&ExportFile> = files.iter().collect();
    ordered.sort_by(|a, b| a.path.cmp(&b.path));
    let mut out = Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(&mut out);
    let stamp = zip::DateTime::from_date_and_time(2024, 1, 1, 0, 0, 0)
        .map_err(|_| ApiError::coded("export_failed", "No se pudo fijar la fecha del ZIP."))?;
    for file in ordered {
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .last_modified_time(stamp)
            .unix_permissions(0o644);
        zip.start_file(&file.path, options).map_err(|e| {
            ApiError::coded(
                "export_failed",
                format!("No se pudo empaquetar {}: {e}", file.path),
            )
        })?;
        zip.write_all(&file.bytes).map_err(|e| {
            ApiError::coded(
                "export_failed",
                format!("No se pudo empaquetar {}: {e}", file.path),
            )
        })?;
    }
    zip.finish()
        .map_err(|e| ApiError::coded("export_failed", format!("No se pudo cerrar el ZIP: {e}")))?;
    Ok(out.into_inner())
}

/// Hash del ZIP resultante, para mostrarlo tras guardar.
pub fn zip_sha256(zip: &[u8]) -> String {
    sha256_hex(zip)
}
