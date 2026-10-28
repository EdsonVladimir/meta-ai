//! Errores estables de la frontera: tipo legible por máquina más mensaje.

use serde::Serialize;

use ruth_core::domain::CoreError;

/// Error serializable hacia la interfaz. `kind` es estable (la interfaz
/// ramifica con él, p. ej. `stale_version`); `message` es para personas.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ApiError {
    pub kind: String,
    pub message: String,
}

impl ApiError {
    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            kind: "internal".to_string(),
            message: message.into(),
        }
    }

    /// Fallo de persistencia local (SQLite), con mensaje recuperable.
    pub fn storage(err: ruth_store::StoreError) -> Self {
        Self::storage_message(err.to_string())
    }

    /// Error de almacenamiento con mensaje ya construido (arranque degradado).
    pub fn storage_message(message: impl Into<String>) -> Self {
        Self {
            kind: "storage_error".to_string(),
            message: message.into(),
        }
    }

    /// Error de propuestas/generación con kind estable propio.
    pub fn coded(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
        }
    }

    /// Traduce un fallo de Meta al kind estable de la frontera, conservando
    /// su mensaje (ya saneado en origen). La interfaz distingue clave,
    /// facturación, rate limit, timeout, salida incompleta e inválida.
    pub fn from_meta(err: ruth_meta::MetaError) -> Self {
        use ruth_meta::MetaErrorKind as K;
        let kind = match err.kind {
            K::MissingKey => "missing_key",
            K::Busy => "generation_busy",
            K::Auth => "meta_auth",
            K::Billing => "meta_billing",
            K::Forbidden => "meta_forbidden",
            K::RateLimit => "meta_rate_limit",
            K::ModelNotFound => "meta_model_not_found",
            K::BadRequest => "meta_bad_request",
            K::Server => "meta_server",
            K::Network => "meta_network",
            K::Timeout => "meta_timeout",
            K::Incomplete => "generation_incomplete",
            K::Refusal => "meta_refusal",
            K::InvalidResponse => "generation_invalid",
            K::Unexpected => "meta_unexpected",
        };
        Self {
            kind: kind.to_string(),
            message: err.message,
        }
    }

    fn kind_of(err: &CoreError) -> &'static str {
        match err {
            CoreError::EmptyId { .. } => "empty_id",
            CoreError::EmptyDate => "empty_date",
            CoreError::EmptyContent => "empty_content",
            CoreError::ProjectNotFound { .. } => "project_not_found",
            CoreError::ModuleNotFound { .. } => "module_not_found",
            CoreError::ArtifactNotFound { .. } => "artifact_not_found",
            CoreError::VersionNotFound { .. } => "version_not_found",
            CoreError::BaselineNotFound { .. } => "baseline_not_found",
            CoreError::DeliveryNotFound { .. } => "delivery_not_found",
            CoreError::DuplicateProject { .. } => "duplicate_project",
            CoreError::DuplicateModule { .. } => "duplicate_module",
            CoreError::DuplicateArtifact { .. } => "duplicate_artifact",
            CoreError::DuplicateVersion { .. } => "duplicate_version",
            CoreError::DuplicateBaseline { .. } => "duplicate_baseline",
            CoreError::DuplicateDelivery { .. } => "duplicate_delivery",
            CoreError::ModuleNotInProject { .. } => "module_not_in_project",
            CoreError::ArtifactNotInProject { .. } => "artifact_not_in_project",
            CoreError::CrossProjectDependency { .. } => "cross_project_dependency",
            CoreError::DuplicateSource { .. } => "duplicate_source",
            CoreError::DependencyCycle { .. } => "dependency_cycle",
            CoreError::NonConsecutiveVersions { .. } => "non_consecutive_versions",
            CoreError::StaleVersion { .. } => "stale_version",
            CoreError::VersionNotValid { .. } => "version_not_valid",
            CoreError::VersionNotCurrent { .. } => "version_not_current",
            CoreError::VersionNotApproved { .. } => "version_not_approved",
            CoreError::DuplicateApproval { .. } => "duplicate_approval",
            CoreError::ApproverMustBeHuman { .. } => "approver_must_be_human",
            CoreError::EmptyBaseline => "empty_baseline",
            CoreError::BaselineDuplicateArtifact { .. } => "baseline_duplicate_artifact",
            CoreError::BaselineMismatch { .. } => "baseline_mismatch",
            CoreError::BaselineMissingSource { .. } => "baseline_missing_source",
            CoreError::EmptyDelivery => "empty_delivery",
            CoreError::DeliveryDuplicateArtifact { .. } => "delivery_duplicate_artifact",
            CoreError::DeliveryMismatch { .. } => "delivery_mismatch",
            CoreError::ArchivedModule { .. } => "archived_module",
            CoreError::ArchivedArtifact { .. } => "archived_artifact",
            CoreError::ArchivedSource { .. } => "archived_source",
            CoreError::DeleteHasApprovals { .. } => "delete_has_approvals",
            CoreError::DeleteHasDependents { .. } => "delete_has_dependents",
            CoreError::DeleteInBaseline { .. } => "delete_in_baseline",
            CoreError::DeleteInDelivery { .. } => "delete_in_delivery",
            CoreError::DeleteModuleNotEmpty { .. } => "delete_module_not_empty",
            CoreError::EmptyName => "empty_name",
            CoreError::NameTooLong { .. } => "name_too_long",
            CoreError::StaleName { .. } => "stale_name",
        }
    }
}

impl From<CoreError> for ApiError {
    fn from(err: CoreError) -> Self {
        Self {
            kind: Self::kind_of(&err).to_string(),
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ruth_core::domain::VersionId;

    #[test]
    fn maps_core_errors_to_stable_kinds() {
        let err = ApiError::from(CoreError::StaleVersion {
            expected: Some(VersionId::new("v1").expect("id")),
            actual: None,
        });
        assert_eq!(err.kind, "stale_version");
        assert!(!err.message.is_empty());
    }

    #[test]
    fn internal_errors_use_internal_kind() {
        let err = ApiError::internal("bloqueo envenenado");
        assert_eq!(err.kind, "internal");
    }
}
