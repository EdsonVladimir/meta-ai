//! Human baseline metadata: name, description and scope (milestone 9).
//!
//! Coherence (exact approved versions and dependency closure) is kept by the
//! core in the domain tables; only the labels a person puts on the delivery
//! travel here. No second systems: one row per baseline, immutable once created.

use crate::error::StoreError;

pub const MAX_BASELINE_NAME_CHARS: usize = 120;
pub const MAX_BASELINE_DESCRIPTION_CHARS: usize = 2000;

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

/// Human name and scope of a domain baseline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineMeta {
    pub baseline_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module: Option<String>,
    pub created_at: String,
}

/// In-memory metadata log, mirror of `baseline_meta`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BaselineMetaLog {
    metas: Vec<BaselineMeta>,
}

impl BaselineMetaLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, meta: BaselineMeta) -> Result<(), StoreError> {
        if meta.baseline_id.trim().is_empty() {
            return Err(invalid("the baseline needs an identity"));
        }
        if meta.name.trim().is_empty() || meta.name.chars().count() > MAX_BASELINE_NAME_CHARS {
            return Err(invalid(
                "the baseline name cannot be empty or exceed 120 characters",
            ));
        }
        if let Some(description) = &meta.description {
            if description.chars().count() > MAX_BASELINE_DESCRIPTION_CHARS {
                return Err(invalid("the description cannot exceed 2000 characters"));
            }
        }
        if let Some(scope) = &meta.scope_module {
            if scope.trim().is_empty() {
                return Err(invalid("the scope cannot be empty"));
            }
        }
        if meta.created_at.trim().is_empty() {
            return Err(invalid("the baseline needs a date"));
        }
        if self.metas.iter().any(|m| m.baseline_id == meta.baseline_id) {
            return Err(invalid(format!(
                "baseline {} already has metadata",
                meta.baseline_id
            )));
        }
        self.metas.push(meta);
        Ok(())
    }

    pub fn get(&self, baseline_id: &str) -> Option<&BaselineMeta> {
        self.metas.iter().find(|m| m.baseline_id == baseline_id)
    }

    pub fn all(&self) -> &[BaselineMeta] {
        &self.metas
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(id: &str) -> BaselineMeta {
        BaselineMeta {
            baseline_id: id.to_string(),
            name: "Delivery 1".to_string(),
            description: Some("Ventas".to_string()),
            scope_module: Some("mod-2".to_string()),
            created_at: "2026-10-28T12:00:00Z".to_string(),
        }
    }

    #[test]
    fn record_validates_name_and_rejects_duplicates() {
        let mut log = BaselineMetaLog::new();
        log.record(meta("base-1")).expect("valid");
        assert!(log.record(meta("base-1")).is_err());
        let mut nameless = meta("base-2");
        nameless.name = "   ".to_string();
        assert!(log.record(nameless).is_err());
        let mut long = meta("base-2");
        long.name = "x".repeat(MAX_BASELINE_NAME_CHARS + 1);
        assert!(log.record(long).is_err());
        assert_eq!(log.get("base-1").expect("id").name, "Delivery 1");
        assert!(log.get("base-9").is_none());
    }
}
