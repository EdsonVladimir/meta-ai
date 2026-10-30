//! Update proposals for affected designs (milestone 8).
//!
//! Reuses the design-generation system: the snapshot pins the
//! target and the current versions of its same sources, generation
//! uses the same output schema and acceptance uses the same atomic,
//! idempotent cycle. What is new is the preview with blockers (unapproved
//! sources, stale intermediaries) and the structural diff.
//!
//! Rules:
//! - The design source set is preserved and their versions updated;
//!   nothing is added or removed silently.
//! - No skipped stages: when a design source is still stale, it must
//!   be updated first (the chain resolves in order).
//! - Generation and acceptance revalidate the snapshot; on change,
//!   the proposal stays stale and is generated again.

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, ProjectId, VersionId};
use ruth_meta::design::{diff_designs, DesignKind, OriginChange, UpdateSource};
use ruth_meta::generation::GenerationContextItem;

use crate::dto::{
    DesignDiffDto, DesignDiffInput, DiffItemDto, UpdateBlockerDto, UpdateContextInput,
    UpdateContextPreview, UpdateOriginDto, UpdateSourceDto,
};
use crate::error::ApiError;
use crate::impact::artifact_dto;

fn kind_str(kind: ArtifactType) -> &'static str {
    match kind {
        ArtifactType::Requirement => "requirement",
        ArtifactType::Flow => "flow",
        ArtifactType::DataModel => "data_model",
        ArtifactType::Mockup => "mockup",
    }
}

fn design_kind_of(kind: ArtifactType) -> Option<DesignKind> {
    match kind {
        ArtifactType::Flow => Some(DesignKind::Flow),
        ArtifactType::DataModel => Some(DesignKind::DataModel),
        ArtifactType::Requirement | ArtifactType::Mockup => None,
    }
}

fn target_in_project(
    store: &Store,
    project_id: &str,
    artifact_id: &str,
) -> Result<(ProjectId, ArtifactId), ApiError> {
    let project = ProjectId::new(project_id.to_string())?;
    let artifact = ArtifactId::new(artifact_id.to_string())?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let known = store
        .artifact(&artifact)
        .ok_or_else(|| CoreError::ArtifactNotFound {
            artifact: artifact.clone(),
        })?;
    if known.project() != &project {
        return Err(CoreError::ArtifactNotInProject {
            artifact: artifact.clone(),
            project: project.clone(),
        }
        .into());
    }
    Ok((project, artifact))
}

/// Advisory update-context preview. Generates nothing:
/// shows what would travel to Meta and what blocks it.
pub fn update_context_preview(
    store: &Store,
    input: UpdateContextInput,
) -> Result<UpdateContextPreview, ApiError> {
    let (project, target) = target_in_project(store, &input.project_id, &input.artifact_id)?;
    let known = store.artifact(&target).expect("validated target");
    let Some(kind) = design_kind_of(known.artifact_type()) else {
        return Err(ApiError::coded(
            "not_a_design",
            format!(
                "{} is not a flow or a model: only those update with proposals",
                target.as_str()
            ),
        ));
    };
    let current = store
        .current_version(&target)
        .ok_or_else(|| ApiError::internal(format!("{} has no versions", target.as_str())))?;
    let spec: serde_json::Value =
        serde_json::from_str(current.content().as_str()).map_err(|_| {
            ApiError::coded(
                "design_invalid",
                format!(
                    "The current content of {} is not valid design JSON.",
                    target.as_str()
                ),
            )
        })?;
    // Structural: the current design must stay valid of the kind.
    crate::design::validate_spec(kind.as_str(), &spec, None).map_err(|_| {
        ApiError::coded(
            "design_invalid",
            format!(
                "The current content of {} is not a valid design.",
                target.as_str()
            ),
        )
    })?;

    let validity = store.validity(current.id())?;
    let mut sources = Vec::with_capacity(current.sources().len());
    let mut blockers = Vec::new();
    // Nothing generates over archived items: neither the target nor its
    // sources may be archived. Since the authoritative snapshot fails with
    // blockers, this also protects programmatic generation.
    if store.is_effectively_archived(&target) {
        blockers.push(UpdateBlockerDto {
            code: "target_archived".to_string(),
            message: format!(
                "{} is archived: restore it to propose its update.",
                target.as_str()
            ),
            artifact_id: Some(target.as_str().to_string()),
        });
    }
    if validity.valid {
        blockers.push(UpdateBlockerDto {
            code: "target_up_to_date".to_string(),
            message: format!(
                "{} already uses the current sources: nothing to update.",
                target.as_str()
            ),
            artifact_id: Some(target.as_str().to_string()),
        });
    }
    for used in current.sources() {
        let Some(used_version) = store.version(used) else {
            blockers.push(UpdateBlockerDto {
                code: "source_missing".to_string(),
                message: format!(
                    "Source {} no longer exists: review the state before generating.",
                    used.as_str()
                ),
                artifact_id: None,
            });
            continue;
        };
        let source_artifact = used_version.artifact().clone();
        let Some(source_current) = store.current_version(&source_artifact) else {
            blockers.push(UpdateBlockerDto {
                code: "source_missing".to_string(),
                message: format!(
                    "{} has no current version: review the state before generating.",
                    source_artifact.as_str()
                ),
                artifact_id: Some(source_artifact.as_str().to_string()),
            });
            continue;
        };
        let Some(source_ref) = store.artifact(&source_artifact) else {
            blockers.push(UpdateBlockerDto {
                code: "source_missing".to_string(),
                message: format!(
                    "{} no longer exists: review the state before generating.",
                    source_artifact.as_str()
                ),
                artifact_id: None,
            });
            continue;
        };
        let current_valid = store.validity(source_current.id())?.valid;
        let current_approved = store.is_approved(source_current.id());
        if store.is_effectively_archived(&source_artifact) {
            blockers.push(UpdateBlockerDto {
                code: "source_archived".to_string(),
                message: format!(
                    "{} is archived: restore it before updating {}.",
                    source_artifact.as_str(),
                    target.as_str()
                ),
                artifact_id: Some(source_artifact.as_str().to_string()),
            });
        } else if !current_valid {
            blockers.push(UpdateBlockerDto {
                code: "source_stale".to_string(),
                message: format!(
                    "{} uses old sources: update {} first before {}.",
                    source_artifact.as_str(),
                    source_artifact.as_str(),
                    target.as_str()
                ),
                artifact_id: Some(source_artifact.as_str().to_string()),
            });
        }
        // No blocker for missing review (living design): `current_approved`
        // travels as information on each source, not as a veto.
        sources.push(UpdateSourceDto {
            artifact_id: source_artifact.as_str().to_string(),
            kind: kind_str(source_ref.artifact_type()).to_string(),
            used_version_id: used.as_str().to_string(),
            used_content: used_version.content().as_str().to_string(),
            current_version_id: source_current.id().as_str().to_string(),
            current_content: source_current.content().as_str().to_string(),
            changed: used != source_current.id(),
            current_approved,
            current_valid,
        });
    }
    sources.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));

    let mut origin = None;
    let mut paths = Vec::new();
    if let Some(origin_id) = input.origin_artifact_id {
        let origin_artifact = ArtifactId::new(origin_id)?;
        let origin_ref =
            store
                .artifact(&origin_artifact)
                .ok_or_else(|| CoreError::ArtifactNotFound {
                    artifact: origin_artifact.clone(),
                })?;
        if origin_ref.project() != &project {
            return Err(CoreError::ArtifactNotInProject {
                artifact: origin_artifact,
                project,
            }
            .into());
        }
        let versions = store.versions_of(&origin_artifact);
        let current_origin = versions.last().ok_or_else(|| CoreError::VersionNotFound {
            version: VersionId::new("current").expect("literal id"),
        })?;
        let from = match input.origin_from_version_id {
            None => versions
                .get(versions.len().saturating_sub(2))
                .copied()
                .unwrap_or(*current_origin),
            Some(raw) => {
                let wanted = VersionId::new(raw)?;
                versions
                    .iter()
                    .find(|v| v.id() == &wanted)
                    .copied()
                    .ok_or(CoreError::VersionNotFound { version: wanted })?
            }
        };
        origin = Some(UpdateOriginDto {
            artifact_id: origin_artifact.as_str().to_string(),
            from_version_id: from.id().as_str().to_string(),
            from_content: from.content().as_str().to_string(),
            current_version_id: current_origin.id().as_str().to_string(),
            current_content: current_origin.content().as_str().to_string(),
        });
        let report = store.impact(&project, std::slice::from_ref(&origin_artifact))?;
        paths = report
            .affected
            .iter()
            .find(|item| item.artifact == target)
            .map(|item| {
                item.paths
                    .iter()
                    .map(|p| p.iter().map(|a| a.as_str().to_string()).collect())
                    .collect()
            })
            .unwrap_or_default();
    }

    Ok(UpdateContextPreview {
        target: artifact_dto(store, &target)?,
        kind: kind.as_str().to_string(),
        current_version_id: current.id().as_str().to_string(),
        current_number: current.number(),
        current_spec: spec,
        sources,
        origin,
        paths,
        can_generate: blockers.is_empty(),
        blockers,
    })
}

/// Authoritative snapshot for generating: same computation as the preview,
/// but blockers are errors (nothing generates halfway).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateSnapshot {
    pub kind: DesignKind,
    pub module_id: String,
    pub target_artifact_id: String,
    pub target_version_id: String,
    pub current_spec: String,
    pub context: Vec<GenerationContextItem>,
    pub sources: Vec<UpdateSource>,
    pub origin: Option<OriginChange>,
    pub paths: Vec<Vec<String>>,
}

pub fn snapshot_update_context(
    store: &Store,
    input: UpdateContextInput,
) -> Result<UpdateSnapshot, ApiError> {
    let preview = update_context_preview(store, input)?;
    if !preview.blockers.is_empty() {
        let joined = preview
            .blockers
            .iter()
            .map(|b| b.message.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        return Err(ApiError::coded("update_blocked", joined));
    }
    let kind = DesignKind::parse(&preview.kind).map_err(ApiError::from_meta)?;
    let target = ArtifactId::new(preview.target.id.clone())?;
    let known = store.artifact(&target).expect("validated target");
    let mut context: Vec<GenerationContextItem> = preview
        .sources
        .iter()
        .map(|s| GenerationContextItem {
            artifact_id: s.artifact_id.clone(),
            version_id: s.current_version_id.clone(),
            content: s.current_content.clone(),
        })
        .collect();
    context.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    let mut sources: Vec<UpdateSource> = preview
        .sources
        .iter()
        .map(|s| UpdateSource {
            artifact_id: s.artifact_id.clone(),
            used_version_id: s.used_version_id.clone(),
            used_content: s.used_content.clone(),
            current_version_id: s.current_version_id.clone(),
            current_content: s.current_content.clone(),
        })
        .collect();
    sources.sort_by(|a, b| a.artifact_id.cmp(&b.artifact_id));
    Ok(UpdateSnapshot {
        kind,
        module_id: known.module().as_str().to_string(),
        target_artifact_id: preview.target.id.clone(),
        target_version_id: preview.current_version_id.clone(),
        current_spec: preview.current_spec.to_string(),
        context,
        sources,
        origin: preview.origin.map(|o| OriginChange {
            artifact_id: o.artifact_id,
            from_version_id: o.from_version_id,
            from_content: o.from_content,
            current_version_id: o.current_version_id,
            current_content: o.current_content,
        }),
        paths: preview.paths,
    })
}

/// Structural diff between two specs of the same kind, both
/// validated with the existing contracts. Pure: touches no domain.
pub fn design_diff(input: DesignDiffInput) -> Result<DesignDiffDto, ApiError> {
    let old = crate::design::validate_spec(&input.kind, &input.old_spec, None)?;
    let new = crate::design::validate_spec(&input.kind, &input.new_spec, None)?;
    let diff = diff_designs(&old, &new).map_err(ApiError::from_meta)?;
    let map = |items: Vec<ruth_meta::design::DiffItem>| {
        items
            .into_iter()
            .map(|i| DiffItemDto {
                kind: i.kind,
                id: i.id,
                detail: i.detail,
            })
            .collect()
    };
    Ok(DesignDiffDto {
        added: map(diff.added),
        removed: map(diff.removed),
        modified: map(diff.modified),
    })
}
