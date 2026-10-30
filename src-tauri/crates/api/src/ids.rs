//! Identifiers and dates generated outside the domain.
//!
//! The domain receives both as inputs; it never generates them nor reads the clock.

use std::time::{SystemTime, UNIX_EPOCH};

use ruth_core::domain::{ArtifactId, BaselineId, DeliveryId, ModuleId, ProjectId, VersionId};

/// Sequential readable-identifier generator (`proy-1`, `mod-2`...).
/// Lives next to the `Store` in the Tauri-managed state.
#[derive(Debug, Clone, Default)]
pub struct IdGen {
    next: u64,
}

impl IdGen {
    pub fn new() -> Self {
        Self::default()
    }

    /// Current counter value, for persisting it with the snapshot.
    pub fn checkpoint(&self) -> u64 {
        self.next
    }

    /// Restores the counter read from the database. Only persistence uses it.
    pub fn restore(next: u64) -> Self {
        Self { next }
    }

    fn take(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    pub fn project(&mut self) -> ProjectId {
        ProjectId::new(format!("proy-{}", self.take())).expect("generated id never empty")
    }

    /// Definitive identity of an assisted generation (`gen-N`). Shares the
    /// persisted counter: never collides nor gets reused.
    pub fn generation(&mut self) -> String {
        format!("gen-{}", self.take())
    }

    pub fn module(&mut self) -> ModuleId {
        ModuleId::new(format!("mod-{}", self.take())).expect("generated id never empty")
    }

    pub fn requirement(&mut self) -> ArtifactId {
        ArtifactId::new(format!("req-{}", self.take())).expect("generated id never empty")
    }

    /// Definitive identity of an operation flow (`flujo-N`).
    pub fn flow(&mut self) -> ArtifactId {
        ArtifactId::new(format!("flujo-{}", self.take())).expect("generated id never empty")
    }

    /// Definitive identity of an entity-relationship model (`mer-N`).
    pub fn data_model(&mut self) -> ArtifactId {
        ArtifactId::new(format!("mer-{}", self.take())).expect("generated id never empty")
    }

    /// Stable identity of a code root (`root-N`). Shares the
    /// persisted counter: never collides nor gets reused.
    pub fn code_root(&mut self) -> String {
        format!("root-{}", self.take())
    }

    /// Stable identity of a code↔knowledge link (`link-N`).
    pub fn code_link(&mut self) -> String {
        format!("link-{}", self.take())
    }

    /// Stable identity of a structure snapshot (`snap-N`).
    pub fn snapshot(&mut self) -> String {
        format!("snap-{}", self.take())
    }

    /// Stable identity of a code generation (`cgen-N`).
    pub fn code_generation(&mut self) -> String {
        format!("cgen-{}", self.take())
    }

    /// Stable identity of a saved workspace (`ws-N`). Shares the
    /// persisted counter: never collides nor gets reused.
    pub fn workspace(&mut self) -> String {
        format!("ws-{}", self.take())
    }

    /// Definitive identity of a mockup (`mockup-N`).
    pub fn mockup(&mut self) -> ArtifactId {
        ArtifactId::new(format!("mockup-{}", self.take())).expect("generated id never empty")
    }

    pub fn baseline(&mut self) -> BaselineId {
        BaselineId::new(format!("base-{}", self.take())).expect("generated id never empty")
    }

    /// Definitive identity of a work delivery (`entrega-N`).
    pub fn delivery(&mut self) -> DeliveryId {
        DeliveryId::new(format!("entrega-{}", self.take())).expect("generated id never empty")
    }

    /// Stable version identifier from its artifact and number.
    pub fn version(artifact: &ArtifactId, number: u32) -> VersionId {
        VersionId::new(format!("{}-v{number}", artifact.as_str()))
            .expect("generated id never empty")
    }
}

/// Current UTC date in `YYYY-MM-DDTHH:MM:SSZ` format, no dependencies.
pub fn now_utc_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso8601_from_unix_secs(secs)
}

/// Pure, testable part of the boundary clock.
pub fn iso8601_from_unix_secs(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let time = secs % 86_400;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        time / 3600,
        (time % 3600) / 60,
        time % 60
    )
}

/// Days since 1970-01-01 to civil date (Howard Hinnant's algorithm).
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_sequential_ids() {
        let mut ids = IdGen::new();
        assert_eq!(ids.project().as_str(), "proy-1");
        assert_eq!(ids.module().as_str(), "mod-2");
        assert_eq!(ids.requirement().as_str(), "req-3");
    }

    #[test]
    fn version_id_combines_artifact_and_number() {
        let artifact = ArtifactId::new("req-3").expect("id");
        assert_eq!(IdGen::version(&artifact, 2).as_str(), "req-3-v2");
    }

    #[test]
    fn epoch_starts_at_1970() {
        assert_eq!(iso8601_from_unix_secs(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso8601_from_unix_secs(86_400), "1970-01-02T00:00:00Z");
        assert_eq!(
            iso8601_from_unix_secs(1_791_129_600),
            "2026-10-04T16:00:00Z"
        );
    }

    #[test]
    fn now_has_stable_shape() {
        let now = now_utc_iso8601();
        assert_eq!(now.len(), 20);
        assert!(now.ends_with('Z'));
        assert_eq!(&now[10..11], "T");
    }
}
