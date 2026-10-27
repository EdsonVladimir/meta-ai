//! Identificadores y fechas generados fuera del dominio.
//!
//! El dominio recibe ambos como entradas; nunca los genera ni lee el reloj.

use std::time::{SystemTime, UNIX_EPOCH};

use ruth_core::domain::{ArtifactId, ModuleId, ProjectId, VersionId};

/// Generador secuencial de identificadores legibles (`proy-1`, `mod-2`…).
/// Vive junto al `Store` en el estado gestionado por Tauri.
#[derive(Debug, Clone, Default)]
pub struct IdGen {
    next: u64,
}

impl IdGen {
    pub fn new() -> Self {
        Self::default()
    }

    /// Valor actual del contador, para persistirlo junto a la instantánea.
    pub fn checkpoint(&self) -> u64 {
        self.next
    }

    /// Restaura el contador leído de la base. Solo lo usa la persistencia.
    pub fn restore(next: u64) -> Self {
        Self { next }
    }

    fn take(&mut self) -> u64 {
        self.next += 1;
        self.next
    }

    pub fn project(&mut self) -> ProjectId {
        ProjectId::new(format!("proy-{}", self.take())).expect("id generado nunca vacío")
    }

    /// Identidad definitiva de una generación asistida (`gen-N`). Comparte el
    /// contador persistido: nunca colisiona ni se reutiliza.
    pub fn generation(&mut self) -> String {
        format!("gen-{}", self.take())
    }

    pub fn module(&mut self) -> ModuleId {
        ModuleId::new(format!("mod-{}", self.take())).expect("id generado nunca vacío")
    }

    pub fn requirement(&mut self) -> ArtifactId {
        ArtifactId::new(format!("req-{}", self.take())).expect("id generado nunca vacío")
    }

    /// Identidad definitiva de un flujo de operación (`flujo-N`).
    pub fn flow(&mut self) -> ArtifactId {
        ArtifactId::new(format!("flujo-{}", self.take())).expect("id generado nunca vacío")
    }

    /// Identidad definitiva de un modelo entidad-relación (`mer-N`).
    pub fn data_model(&mut self) -> ArtifactId {
        ArtifactId::new(format!("mer-{}", self.take())).expect("id generado nunca vacío")
    }

    /// Identificador estable de versión a partir de su artefacto y número.
    pub fn version(artifact: &ArtifactId, number: u32) -> VersionId {
        VersionId::new(format!("{}-v{number}", artifact.as_str())).expect("id generado nunca vacío")
    }
}

/// Fecha actual en UTC con formato `YYYY-MM-DDTHH:MM:SSZ`, sin dependencias.
pub fn now_utc_iso8601() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    iso8601_from_unix_secs(secs)
}

/// Parte pura y testeable del reloj de frontera.
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

/// Días desde 1970-01-01 a fecha civil (algoritmo de Howard Hinnant).
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
