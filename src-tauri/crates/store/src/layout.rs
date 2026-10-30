//! Visual layouts of the design editor (milestone 10).
//!
//! Pure presentation: element positions per artifact and version. Not
//! part of the domain (no influence on validation, currency, approvals
//! or exports) and unknown to the core. Saved with the version in the
//! same transaction so reopening preserves content and layout; with no
//! saved layout, the editor uses its deterministic automatic placement.
//!
//! The adapter stores the JSON verbatim, without interpreting it (no
//! serde dependency): sanitization lives in `ruth-api`, which accepts or
//! rejects candidate layouts. Hand-tampered rows load the same and are
//! interpreted on read: an illegible layout equals "no layout" and never
//! breaks opening.

use std::collections::HashMap;

/// In-memory log, mirror of the last confirmed commit.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LayoutLog {
    layouts: HashMap<(String, String), String>,
}

impl LayoutLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Saved layout for the version, if any.
    pub fn get(&self, artifact_id: &str, version_id: &str) -> Option<&str> {
        self.layouts
            .get(&(artifact_id.to_string(), version_id.to_string()))
            .map(String::as_str)
    }

    /// Pins the already persisted layout. Only called by the save path,
    /// after committing the transaction.
    pub fn set(&mut self, artifact_id: &str, version_id: &str, layout_json: &str) {
        self.layouts.insert(
            (artifact_id.to_string(), version_id.to_string()),
            layout_json.to_string(),
        );
    }

    /// Rehydrates a row loaded from the database, verbatim. Rows with empty
    /// keys are ignored; content is interpreted on read.
    pub fn rehydrate(&mut self, artifact_id: String, version_id: String, layout_json: String) {
        if artifact_id.trim().is_empty() || version_id.trim().is_empty() {
            return;
        }
        self.layouts.insert((artifact_id, version_id), layout_json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_roundtrip() {
        let mut log = LayoutLog::new();
        assert_eq!(log.get("flujo-1", "flujo-1-v1"), None);
        log.set("flujo-1", "flujo-1-v1", r#"{"a":{"x":1.0,"y":2.0}}"#);
        assert_eq!(
            log.get("flujo-1", "flujo-1-v1"),
            Some(r#"{"a":{"x":1.0,"y":2.0}}"#)
        );
    }

    #[test]
    fn rehydrate_ignores_empty_keys() {
        let mut log = LayoutLog::new();
        log.rehydrate(String::new(), "v".to_string(), "{}".to_string());
        log.rehydrate("a".to_string(), String::new(), "{}".to_string());
        log.rehydrate(
            "a".to_string(),
            "v".to_string(),
            "not-even-json".to_string(),
        );
        assert_eq!(log.get("a", "v"), Some("not-even-json"));
    }
}
