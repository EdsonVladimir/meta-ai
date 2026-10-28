//! Metadatos humanos de baselines: nombre, descripción y alcance (hito 9).
//!
//! La coherencia (versiones exactas aprobadas y cierre de dependencias) la
//! guarda el núcleo en las tablas de dominio; aquí solo viajan las etiquetas
//! que una persona pone a la entrega. Sin segundos sistemas: una fila por
//! baseline, inmutable tras crearla.

use crate::error::StoreError;

pub const MAX_BASELINE_NAME_CHARS: usize = 120;
pub const MAX_BASELINE_DESCRIPTION_CHARS: usize = 2000;

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::InvalidData {
        message: message.into(),
    }
}

/// Nombre y alcance humanos de una baseline del dominio.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineMeta {
    pub baseline_id: String,
    pub name: String,
    pub description: Option<String>,
    pub scope_module: Option<String>,
    pub created_at: String,
}

/// Registro en memoria de metadatos, espejo de `baseline_meta`.
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
            return Err(invalid("la baseline necesita identidad"));
        }
        if meta.name.trim().is_empty() || meta.name.chars().count() > MAX_BASELINE_NAME_CHARS {
            return Err(invalid(
                "el nombre de la baseline no puede estar vacío ni pasar de 120 caracteres",
            ));
        }
        if let Some(description) = &meta.description {
            if description.chars().count() > MAX_BASELINE_DESCRIPTION_CHARS {
                return Err(invalid("la descripción no puede pasar de 2000 caracteres"));
            }
        }
        if let Some(scope) = &meta.scope_module {
            if scope.trim().is_empty() {
                return Err(invalid("el alcance no puede estar vacío"));
            }
        }
        if meta.created_at.trim().is_empty() {
            return Err(invalid("la baseline necesita fecha"));
        }
        if self.metas.iter().any(|m| m.baseline_id == meta.baseline_id) {
            return Err(invalid(format!(
                "la baseline {} ya tiene metadatos",
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
            name: "Entrega 1".to_string(),
            description: Some("Ventas".to_string()),
            scope_module: Some("mod-2".to_string()),
            created_at: "2026-10-28T12:00:00Z".to_string(),
        }
    }

    #[test]
    fn record_validates_name_and_rejects_duplicates() {
        let mut log = BaselineMetaLog::new();
        log.record(meta("base-1")).expect("válidos");
        assert!(log.record(meta("base-1")).is_err());
        let mut nameless = meta("base-2");
        nameless.name = "   ".to_string();
        assert!(log.record(nameless).is_err());
        let mut long = meta("base-2");
        long.name = "x".repeat(MAX_BASELINE_NAME_CHARS + 1);
        assert!(log.record(long).is_err());
        assert_eq!(log.get("base-1").expect("id").name, "Entrega 1");
        assert!(log.get("base-9").is_none());
    }
}
