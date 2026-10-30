//! Impact command: pure query over memory.
//!
//! Mutates and persists nothing: locks briefly, checks availability and
//! translates the core analysis. Recomputing the report never touches
//! versions or approvals.

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
