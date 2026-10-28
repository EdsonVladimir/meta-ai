//! Comando de impacto: consulta pura sobre la memoria.
//!
//! No muta ni persiste: bloquea corto, comprueba disponibilidad y traduce el
//! análisis del núcleo. Recalcular el informe nunca toca versiones ni
//! aprobaciones.

use tauri::State;

use ruth_api::{ApiError, ImpactQueryInput, ImpactReportDto};

use super::{lock, ready};
use crate::state::AppState;

#[tauri::command]
pub fn core_impact_report(
    state: State<AppState>,
    input: ImpactQueryInput,
) -> Result<ImpactReportDto, ApiError> {
    let mut guard = lock(&state.inner)?;
    let ready = ready(&mut guard)?;
    ruth_api::impact_report(ready.store, input)
}
