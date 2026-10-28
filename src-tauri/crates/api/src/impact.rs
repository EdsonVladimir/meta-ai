//! Informe de impacto: traduce el análisis del núcleo a DTOs.
//!
//! Consulta pura sobre `&Store`: no muta, no persiste, no genera nada. La
//! vigencia, los afectados y los caminos los calcula `ruth-core`; aquí solo
//! se resuelven versiones actuales frente a fijadas y se empaquetan.

use ruth_core::application::Store;
use ruth_core::domain::{ArtifactId, ArtifactType, CoreError, ProjectId, Version, VersionId};

use crate::dto::{
    ApprovalDto, ArtifactDto, ImpactOriginDto, ImpactQueryInput, ImpactReportDto, ImpactVersionDto,
    ImpactedDto, SourcePinDto,
};
use crate::error::ApiError;

pub(crate) fn artifact_dto(store: &Store, id: &ArtifactId) -> Result<ArtifactDto, ApiError> {
    let artifact = store
        .artifact(id)
        .ok_or_else(|| CoreError::ArtifactNotFound {
            artifact: id.clone(),
        })?;
    Ok(ArtifactDto {
        id: artifact.id().as_str().to_string(),
        project_id: artifact.project().as_str().to_string(),
        module_id: artifact.module().as_str().to_string(),
        kind: match artifact.artifact_type() {
            ArtifactType::Requirement => "requirement",
            ArtifactType::Flow => "flow",
            ArtifactType::DataModel => "data_model",
            ArtifactType::Mockup => "mockup",
        }
        .to_string(),
        title: artifact.title().map(str::to_string),
        archived: artifact.archived(),
    })
}

fn version_dto(version: &Version) -> ImpactVersionDto {
    ImpactVersionDto {
        id: version.id().as_str().to_string(),
        number: version.number(),
        content: version.content().as_str().to_string(),
    }
}

fn approval_dto(approval: &ruth_core::domain::Approval) -> ApprovalDto {
    ApprovalDto {
        version_id: approval.version().as_str().to_string(),
        approved_by: approval.approved_by().as_str().to_string(),
        at: approval.at().as_str().to_string(),
    }
}

/// Fuentes fijadas por una versión frente a las actuales de sus artefactos.
/// Compartido con el snapshot de actualización (mismo significado).
pub(crate) fn source_pins(
    store: &Store,
    current_version: &Version,
    stale_sources: &[VersionId],
) -> Vec<SourcePinDto> {
    let mut pins = Vec::with_capacity(current_version.sources().len());
    for used in current_version.sources() {
        let resolved = store.version(used).and_then(|source| {
            store
                .current_version(source.artifact())
                .map(|actual| (source.artifact().clone(), actual.id().clone()))
        });
        let stale = stale_sources.contains(used);
        let unknown = resolved.is_none();
        let (source_artifact_id, current_version_id) = match resolved {
            Some((artifact, actual)) => (
                Some(artifact.as_str().to_string()),
                Some(actual.as_str().to_string()),
            ),
            None => (None, None),
        };
        pins.push(SourcePinDto {
            used_version_id: used.as_str().to_string(),
            source_artifact_id,
            current_version_id,
            // Desconocida también cuenta como no vigente, como en el núcleo.
            stale: stale || unknown,
        });
    }
    pins
}

/// Informe de impacto desde un artefacto cambiado, con comparación de
/// versiones del origen y detalle por afectado. Determinista: mismo estado,
/// mismo informe.
pub fn impact_report(store: &Store, input: ImpactQueryInput) -> Result<ImpactReportDto, ApiError> {
    let project = ProjectId::new(input.project_id)?;
    let origin_id = ArtifactId::new(input.artifact_id)?;
    if store.project(&project).is_none() {
        return Err(CoreError::ProjectNotFound { project }.into());
    }
    let origin_ref = store
        .artifact(&origin_id)
        .ok_or_else(|| CoreError::ArtifactNotFound {
            artifact: origin_id.clone(),
        })?;
    if origin_ref.project() != &project {
        return Err(CoreError::ArtifactNotInProject {
            artifact: origin_id.clone(),
            project: project.clone(),
        }
        .into());
    }

    let versions = store.versions_of(&origin_id);
    let current = versions.last().ok_or_else(|| CoreError::VersionNotFound {
        version: VersionId::new("actual").expect("id literal"),
    })?;
    let from = match input.from_version_id {
        None => versions
            .get(versions.len().saturating_sub(2))
            .copied()
            .unwrap_or(*current),
        Some(raw) => {
            let wanted = VersionId::new(raw)?;
            versions
                .iter()
                .find(|v| v.id() == &wanted)
                .copied()
                .ok_or(CoreError::VersionNotFound { version: wanted })?
        }
    };

    let report = store.impact(&project, std::slice::from_ref(&origin_id))?;
    let mut affected = Vec::with_capacity(report.affected.len());
    for item in &report.affected {
        let current_version =
            store
                .current_version(&item.artifact)
                .ok_or_else(|| CoreError::ArtifactNotFound {
                    artifact: item.artifact.clone(),
                })?;
        let validity = store.validity(current_version.id())?;
        let pins = source_pins(store, current_version, &validity.stale_sources);
        let approvals: Vec<ApprovalDto> = store
            .approvals_of(current_version.id())
            .iter()
            .map(|a| approval_dto(a))
            .collect();
        let approved_before = store
            .versions_of(&item.artifact)
            .iter()
            .any(|v| store.is_approved(v.id()));
        affected.push(ImpactedDto {
            artifact: artifact_dto(store, &item.artifact)?,
            current_version_id: current_version.id().as_str().to_string(),
            current_number: current_version.number(),
            requires_review: !validity.valid,
            stale_sources: validity
                .stale_sources
                .iter()
                .map(|s| s.as_str().to_string())
                .collect(),
            pins,
            approvals,
            approved_before,
            paths: item
                .paths
                .iter()
                .map(|p| p.iter().map(|a| a.as_str().to_string()).collect())
                .collect(),
        });
    }

    Ok(ImpactReportDto {
        project_id: project.as_str().to_string(),
        origin: ImpactOriginDto {
            artifact: artifact_dto(store, &origin_id)?,
            from_version: version_dto(from),
            current_version: version_dto(current),
        },
        affected,
    })
}
