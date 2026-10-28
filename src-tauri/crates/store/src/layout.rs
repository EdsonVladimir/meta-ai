//! Disposiciones visuales del editor de diseños (hito 10).
//!
//! Presentación pura: posiciones de elementos por artefacto y versión. No
//! forman parte del dominio (no influyen en validación, vigencia,
//! aprobaciones ni exportaciones) y el núcleo no las conoce. Se guardan junto
//! a la versión en la misma transacción para que reabrir conserve contenido
//! y disposición; si no hay disposición guardada, el editor usa su trazado
//! automático determinista.
//!
//! El adaptador guarda el JSON verbatim, sin interpretarlo (no depende de
//! serde): la higienización vive en `ruth-api`, que es quien acepta o
//! rechaza disposiciones candidatas. Las filas manipuladas a mano se cargan
//! igual y se interpretan al leer: una disposición ilegible equivale a "sin
//! disposición" y nunca rompe la apertura.

use std::collections::HashMap;

/// Registro en memoria, espejo del último commit confirmado.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LayoutLog {
    layouts: HashMap<(String, String), String>,
}

impl LayoutLog {
    pub fn new() -> Self {
        Self::default()
    }

    /// Disposición guardada para la versión, si existe.
    pub fn get(&self, artifact_id: &str, version_id: &str) -> Option<&str> {
        self.layouts
            .get(&(artifact_id.to_string(), version_id.to_string()))
            .map(String::as_str)
    }

    /// Fija la disposición ya persistida. Solo la llama el camino de
    /// guardado, después de confirmar la transacción.
    pub fn set(&mut self, artifact_id: &str, version_id: &str, layout_json: &str) {
        self.layouts.insert(
            (artifact_id.to_string(), version_id.to_string()),
            layout_json.to_string(),
        );
    }

    /// Rehidrata una fila cargada de la base, verbatim. Filas con claves
    /// vacías se ignoran; el contenido se interpreta al leer.
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
            "ni-siquiera-json".to_string(),
        );
        assert_eq!(log.get("a", "v"), Some("ni-siquiera-json"));
    }
}
