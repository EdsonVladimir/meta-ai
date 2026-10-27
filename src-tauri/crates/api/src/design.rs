//! Lógica de diseños vinculados a requisitos: contexto aprobado, registro,
//! caducidad, validación de especificaciones, aceptación y aprobación.
//!
//! Espeja `proposals`: sin Tauri ni red, todo testeable con un generador
//! falso. Diferencias: el contexto son requisitos APROBADOS seleccionados,
//! cada generación trae UNA propuesta con especificación JSON canónica, y
//! aceptar puede crear el artefacto o versionar uno elegido.
//!
//! Reglas:
//! - El JSON es el contenido autoritativo; Mermaid se deriva y nunca se
//!   almacena como fuente ni se edita.
//! - Las dependencias del diseño apuntan a las versiones exactas utilizadas
//!   (el núcleo las valida: existencia, cruce, ciclos).
//! - Aceptar es atómico e idempotente; aprobar revalida contenido, vigencia
//!   y versión actual en Rust, nunca por un flag de React.

use ruth_core::application::Store;
use ruth_core::domain::{
    AgentId, ArtifactType, Content, CoreError, ModuleId, ProjectId, VersionId,
};
use ruth_meta::design::{
    canonical_json, to_mermaid, validate_design_value, DesignKind, ValidatedDesign,
    DESIGN_TEMPLATE_VERSION,
};
use ruth_meta::generation::GenerationContextItem;
use ruth_store::{DbActor, DesignLog, ProposalState, StoredDesignGeneration, StoredDesignProposal};

use crate::dto::GetRequirementInput;
use crate::dto::{
    AcceptDesignInput, ApproveVersionInput, DesignContextInput, DesignContextPreview,
    DesignGenerationDto, DesignProposalDto, DiscardDesignInput, ListDesignsInput,
    RequirementDetail, UsageDto, ValidateDesignInput, ValidatedDesignDto,
};
use crate::error::ApiError;
use crate::ids::IdGen;
use crate::logic::{approve_version, get_requirement};

/// Agente registrado como procedencia de lo aceptado desde un diseño.
fn agent_for(model: &str) -> Result<AgentId, ApiError> {
    AgentId::new(format!("ruth-gen/{model}")).map_err(ApiError::from)
}

/// Foto del contexto: versión actual exacta de cada requisito seleccionado.
/// Todos deben existir en el módulo, ser requisitos y estar aprobados en su
/// versión actual. Selección vacía: error antes de consumir red.
pub fn snapshot_approved_context(
    store: &Store,
    project_id: &str,
    module_id: &str,
    selected: &[String],
) -> Result<Vec<GenerationContextItem>, ApiError> {
    if selected.is_empty() {
        return Err(ApiError::coded(
            "empty_selection",
            "Selecciona al menos un requisito aprobado como fuente.",
        ));
    }
    let project = ProjectId::new(project_id.to_string())?;
    let module = ModuleId::new(module_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::with_capacity(selected.len());
    for id in selected {
        if !seen.insert(id.clone()) {
            return Err(ApiError::coded(
                "duplicate_selection",
                format!("requisito repetido en la selección: {id}"),
            ));
        }
        let artifact = ruth_core::domain::ArtifactId::new(id.clone())?;
        let Some(known) = store.artifact(&artifact) else {
            return Err(CoreError::ArtifactNotFound { artifact }.into());
        };
        if known.project() != &project || known.module() != &module {
            return Err(ApiError::coded(
                "foreign_selection",
                format!("{id} no pertenece a este módulo"),
            ));
        }
        if known.artifact_type() != ArtifactType::Requirement {
            return Err(ApiError::coded(
                "not_a_requirement",
                format!("{id} no es un requisito"),
            ));
        }
        let Some(current) = store.current_version(&artifact) else {
            return Err(ApiError::internal(format!("{id} no tiene versiones")));
        };
        if !store.is_approved(current.id()) {
            return Err(ApiError::coded(
                "not_approved",
                format!("{id} no está aprobado en su versión actual"),
            ));
        }
        items.push(GenerationContextItem {
            artifact_id: id.clone(),
            version_id: current.id().as_str().to_string(),
            content: current.content().as_str().to_string(),
        });
    }
    items.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(items)
}

/// Vista previa del módulo para seleccionar fuentes: todos los requisitos
/// con su aprobación vigente.
pub fn design_context_preview(
    store: &Store,
    input: DesignContextInput,
) -> Result<Vec<DesignContextPreview>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    let mut out = Vec::new();
    for artifact in store.artifacts_of(&project, &module) {
        if artifact.artifact_type() != ArtifactType::Requirement {
            continue;
        }
        let Some(current) = store.current_version(artifact.id()) else {
            continue;
        };
        let content = current.content().as_str();
        out.push(DesignContextPreview {
            artifact_id: artifact.id().as_str().to_string(),
            version_id: current.id().as_str().to_string(),
            chars: content.chars().count(),
            excerpt: excerpt(content),
            approved: store.is_approved(current.id()),
        });
    }
    out.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(out)
}

fn excerpt(content: &str) -> String {
    const MAX: usize = 120;
    let flat: String = content.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= MAX {
        return flat;
    }
    let end = flat
        .char_indices()
        .nth(MAX)
        .map(|(i, _)| i)
        .unwrap_or(flat.len());
    format!("{}…", &flat[..end])
}

/// Entrada para registrar una generación de diseño recién validada.
pub struct RecordDesignInput {
    pub project_id: String,
    pub module_id: String,
    pub kind: DesignKind,
    pub model: String,
    pub context: Vec<GenerationContextItem>,
    pub validated: ValidatedDesign,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    pub created_at: String,
}

/// Registra la generación en disco y memoria, con Mermaid derivable.
pub fn record_design_generation(
    store: &Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: RecordDesignInput,
) -> Result<DesignGenerationDto, ApiError> {
    if input.validated.kind != input.kind {
        return Err(ApiError::internal(
            "el diseño no coincide con el tipo pedido",
        ));
    }
    let mut ids_draft = ids.clone();
    let id = ids_draft.generation();
    let generation = StoredDesignGeneration {
        id,
        project_id: input.project_id,
        module_id: input.module_id,
        kind: input.kind.as_str().to_string(),
        model: input.model,
        context_version_ids: input.context.iter().map(|c| c.version_id.clone()).collect(),
        template_version: DESIGN_TEMPLATE_VERSION,
        input_tokens: input.input_tokens,
        output_tokens: input.output_tokens,
        total_tokens: input.total_tokens,
        created_at: input.created_at,
        questions: input.validated.questions.clone(),
        proposal: StoredDesignProposal {
            title: input.validated.title.clone(),
            spec_json: canonical_json(&input.validated),
            explanation: input.validated.explanation.clone(),
            state: ProposalState::Pending,
        },
    };
    let mut log_draft = log.clone();
    log_draft
        .record(generation.clone())
        .map_err(ApiError::storage)?;
    db.record_design(&generation).map_err(ApiError::storage)?;
    *log = log_draft;
    *ids = ids_draft;
    to_dto(store, &generation)
}

/// Generaciones de diseño de un módulo con su caducidad calculada.
pub fn list_designs(
    store: &Store,
    log: &DesignLog,
    input: ListDesignsInput,
) -> Result<Vec<DesignGenerationDto>, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let module = ModuleId::new(input.module_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    if store.module(&module).is_none() {
        return Err(CoreError::ModuleNotFound { module }.into());
    }
    log.designs_of(module.as_str())
        .into_iter()
        .filter(|g| g.project_id == project.as_str())
        .map(|g| to_dto(store, g))
        .collect()
}

/// ¿Cambió alguna fuente desde la generación? Igual que en requisitos.
pub fn design_is_stale(store: &Store, generation: &StoredDesignGeneration) -> bool {
    for version_id in &generation.context_version_ids {
        let Ok(id) = VersionId::new(version_id.clone()) else {
            return true;
        };
        let Some(version) = store.version(&id) else {
            return true;
        };
        let current = store.current_version(version.artifact());
        if current.map(|c| c.id()) != Some(&id) {
            return true;
        }
    }
    false
}

/// Referencias citadas en una especificación: permite validar historial sin
/// conjunto enviado (todo lo demás se exige igual).
fn cited_refs(value: &serde_json::Value) -> Vec<String> {
    let mut out = Vec::new();
    collect(value, &mut out);
    out.sort();
    out.dedup();
    out
}

fn collect(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, val) in map {
                if key == "requirements" {
                    if let Some(items) = val.as_array() {
                        for item in items {
                            if let Some(text) = item.as_str() {
                                out.push(text.trim().to_string());
                            }
                        }
                    }
                } else {
                    collect(val, out);
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect(item, out);
            }
        }
        _ => {}
    }
}

/// Valida una especificación bajo demanda (editor JSON, historial).
/// Con conjunto permitido exige referencias dentro de él; sin él, validación
/// estructural completa (lo que se revalida al aprobar).
pub fn validate_spec(
    kind_str: &str,
    spec: &serde_json::Value,
    allowed: Option<&[String]>,
) -> Result<ValidatedDesign, ApiError> {
    let kind = DesignKind::parse(kind_str).map_err(ApiError::from_meta)?;
    match allowed {
        Some(set) => validate_design_value(kind, spec, set).map_err(ApiError::from_meta),
        None => {
            let cited = cited_refs(spec);
            validate_design_value(kind, spec, &cited).map_err(ApiError::from_meta)
        }
    }
}

/// Comando de validación: con generación, dentro de su contexto.
pub fn validate_design(
    store: &Store,
    log: &DesignLog,
    input: ValidateDesignInput,
) -> Result<ValidatedDesignDto, ApiError> {
    let allowed: Option<Vec<String>> = match &input.generation_id {
        Some(id) => {
            let generation = log.design(id).ok_or_else(|| {
                ApiError::coded("design_not_found", format!("generación desconocida: {id}"))
            })?;
            let mut artifacts = Vec::new();
            for version_id in &generation.context_version_ids {
                let vid = VersionId::new(version_id.clone())?;
                let Some(version) = store.version(&vid) else {
                    return Err(ApiError::coded(
                        "design_stale",
                        "La generación está desactualizada.",
                    ));
                };
                artifacts.push(version.artifact().as_str().to_string());
            }
            Some(artifacts)
        }
        None => None,
    };
    let validated = validate_spec(&input.kind, &input.spec, allowed.as_deref())?;
    Ok(ValidatedDesignDto {
        canonical: canonical_json(&validated),
        mermaid: to_mermaid(&validated),
    })
}

fn to_dto(
    store: &Store,
    generation: &StoredDesignGeneration,
) -> Result<DesignGenerationDto, ApiError> {
    let spec: serde_json::Value = serde_json::from_str(&generation.proposal.spec_json)
        .map_err(|_| ApiError::internal(format!("la propuesta de {} no es JSON", generation.id)))?;
    // Lo guardado se validó al escribir; aquí se revalida estructuralmente
    // para derivar Mermaid. Si falla, los datos se corrompieron a mano.
    let validated = validate_spec(&generation.kind, &spec, None)?;
    let (state, artifact_id) = match &generation.proposal.state {
        ProposalState::Pending => ("pending".to_string(), None),
        ProposalState::Discarded => ("discarded".to_string(), None),
        ProposalState::Accepted { artifact_id, .. } => {
            ("accepted".to_string(), Some(artifact_id.clone()))
        }
    };
    Ok(DesignGenerationDto {
        id: generation.id.clone(),
        project_id: generation.project_id.clone(),
        module_id: generation.module_id.clone(),
        kind: generation.kind.clone(),
        model: generation.model.clone(),
        context_version_ids: generation.context_version_ids.clone(),
        template_version: generation.template_version,
        usage: UsageDto {
            input_tokens: generation.input_tokens,
            output_tokens: generation.output_tokens,
            total_tokens: generation.total_tokens,
        },
        created_at: generation.created_at.clone(),
        stale: design_is_stale(store, generation),
        questions: generation.questions.clone(),
        proposal: DesignProposalDto {
            title: generation.proposal.title.clone(),
            spec,
            mermaid: to_mermaid(&validated),
            explanation: generation.proposal.explanation.clone(),
            state,
            artifact_id,
        },
    })
}

/// Acepta un diseño como borrador con procedencia IA, sin aprobarlo.
/// Crea el artefacto o versiona el elegido (con versión esperada), con las
/// versiones exactas del contexto como dependencias. Atómica e idempotente;
/// bloqueada si está desactualizada o no pendiente.
pub fn accept_design(
    store: &mut Store,
    ids: &mut IdGen,
    log: &mut DesignLog,
    db: &DbActor,
    input: AcceptDesignInput,
) -> Result<RequirementDetail, ApiError> {
    if let Some(artifact) = log.accepted_artifact(&input.generation_id) {
        return get_requirement(
            store,
            GetRequirementInput {
                artifact_id: artifact,
            },
        );
    }
    let generation = log
        .design(&input.generation_id)
        .ok_or_else(|| {
            ApiError::coded(
                "design_not_found",
                format!("generación desconocida: {}", input.generation_id),
            )
        })?
        .clone();
    match generation.proposal.state {
        ProposalState::Discarded => {
            return Err(ApiError::coded(
                "design_discarded",
                "La propuesta está descartada y no puede aceptarse.",
            ));
        }
        ProposalState::Accepted { .. } => {
            return Err(ApiError::coded(
                "design_accepted",
                "La propuesta ya se aceptó.",
            ));
        }
        ProposalState::Pending => {}
    }
    if design_is_stale(store, &generation) {
        return Err(ApiError::coded(
            "design_stale",
            "La generación está desactualizada: cambió un requisito usado como \
             contexto. Genera de nuevo con el contexto actual.",
        ));
    }
    // Conjunto permitido: artefactos del contexto registrado.
    let mut allowed = Vec::with_capacity(generation.context_version_ids.len());
    let mut sources = Vec::with_capacity(generation.context_version_ids.len());
    for version_id in &generation.context_version_ids {
        let vid = VersionId::new(version_id.clone())?;
        let Some(version) = store.version(&vid) else {
            return Err(ApiError::coded(
                "design_stale",
                "La generación está desactualizada.",
            ));
        };
        allowed.push(version.artifact().as_str().to_string());
        sources.push(vid);
    }
    let validated = validate_spec(&generation.kind, &input.spec, Some(&allowed))?;
    let content = canonical_json(&validated);
    let project = ProjectId::new(generation.project_id.clone())?;
    let module = ModuleId::new(generation.module_id.clone())?;
    let agent = agent_for(&generation.model)?;
    let artifact_type = match validated.kind {
        DesignKind::Flow => ArtifactType::Flow,
        DesignKind::DataModel => ArtifactType::DataModel,
    };

    let mut store_draft = store.clone();
    let mut ids_draft = ids.clone();
    let artifact_id = match &input.target_artifact_id {
        None => {
            let id = match validated.kind {
                DesignKind::Flow => ids_draft.flow(),
                DesignKind::DataModel => ids_draft.data_model(),
            };
            store_draft.create_artifact(&project, &module, id.clone(), artifact_type)?;
            let version_id = IdGen::version(&id, 1);
            store_draft.accept_ai_draft(
                &project,
                &id,
                None,
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
        Some(target) => {
            let id = ruth_core::domain::ArtifactId::new(target.clone())?;
            let Some(known) = store_draft.artifact(&id) else {
                return Err(CoreError::ArtifactNotFound { artifact: id }.into());
            };
            if known.artifact_type() != artifact_type {
                return Err(ApiError::coded(
                    "design_type_mismatch",
                    format!("{} no es del tipo {}", target, generation.kind),
                ));
            }
            let Some(expected_raw) = &input.expected_version_id else {
                return Err(ApiError::coded(
                    "missing_expected",
                    "Versionar exige la versión esperada.",
                ));
            };
            let expected = VersionId::new(expected_raw.clone())?;
            let number = store_draft.versions_of(&id).len() as u32 + 1;
            let version_id = IdGen::version(&id, number);
            store_draft.accept_ai_draft(
                &project,
                &id,
                Some(&expected),
                version_id,
                Content::new(content.clone())?,
                &agent,
                &sources,
            )?;
            id
        }
    };
    db.accept_design(
        &store_draft,
        ids_draft.checkpoint(),
        &generation.id,
        artifact_id.as_str(),
        &content,
    )
    .map_err(ApiError::storage)?;
    *store = store_draft;
    *ids = ids_draft;
    log.mark_accepted(&generation.id, artifact_id.as_str(), &content)
        .map_err(ApiError::storage)?;
    get_requirement(
        store,
        GetRequirementInput {
            artifact_id: artifact_id.as_str().to_string(),
        },
    )
}

/// Descarta una propuesta de diseño pendiente. Idempotente.
pub fn discard_design(
    log: &mut DesignLog,
    db: &DbActor,
    input: DiscardDesignInput,
) -> Result<(), ApiError> {
    if log.design(&input.generation_id).is_none() {
        return Err(ApiError::coded(
            "design_not_found",
            format!("generación desconocida: {}", input.generation_id),
        ));
    }
    db.discard_design(&input.generation_id)
        .map_err(ApiError::storage)?;
    log.mark_discarded(&input.generation_id)
        .map_err(ApiError::storage)?;
    Ok(())
}

/// Aprueba la versión actual de un diseño: exige artefacto de diseño,
/// contenido válido del tipo y delega vigencia, versión actual y humanidad
/// en el núcleo. Nada se decide por flags de React.
pub fn approve_design_version(
    store: &mut Store,
    input: ApproveVersionInput,
    now: &str,
) -> Result<RequirementDetail, ApiError> {
    let artifact = ruth_core::domain::ArtifactId::new(input.artifact_id.clone())?;
    let Some(known) = store.artifact(&artifact) else {
        return Err(CoreError::ArtifactNotFound { artifact }.into());
    };
    let kind = match known.artifact_type() {
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Requirement => {
            return Err(ApiError::coded(
                "not_a_design",
                "Este comando solo aprueba versiones de diseño.",
            ));
        }
    };
    let Some(current) = store.current_version(&artifact) else {
        return Err(ApiError::internal("el diseño no tiene versiones"));
    };
    let spec: serde_json::Value =
        serde_json::from_str(current.content().as_str()).map_err(|_| {
            ApiError::coded(
                "design_invalid",
                "El contenido no es JSON de diseño válido.",
            )
        })?;
    validate_spec(kind, &spec, None)
        .map_err(|_| ApiError::coded("design_invalid", "El contenido no es un diseño válido."))?;
    approve_version(store, input, now)
}
