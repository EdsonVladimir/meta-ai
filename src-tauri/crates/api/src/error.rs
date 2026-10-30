//! Stable boundary errors: machine-readable kind plus message.

use serde::Serialize;

use ruth_core::domain::CoreError;

/// Serializable error for the UI. `kind` is stable (the UI
/// branches on it, e.g. `stale_version`); `message` is for people.
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

    /// Local persistence (SQLite) failure, with a recoverable message.
    pub fn storage(err: ruth_store::StoreError) -> Self {
        Self::storage_message(err.to_string())
    }

    /// Storage error with a prebuilt message (degraded startup).
    pub fn storage_message(message: impl Into<String>) -> Self {
        Self {
            kind: "storage_error".to_string(),
            message: message.into(),
        }
    }

    /// Proposal/generation error with its own stable kind.
    pub fn coded(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.to_string(),
            message: message.into(),
        }
    }

    /// Translates a Meta failure to the stable boundary kind, keeping
    /// its message (already sanitized at origin). The UI distinguishes key,
    /// billing, rate limit, timeout, incomplete and invalid output.
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
            CoreError::DeleteProjectNotEmpty { .. } => "delete_project_not_empty",
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
        let err = ApiError::internal("poisoned lock");
        assert_eq!(err.kind, "internal");
    }
}
