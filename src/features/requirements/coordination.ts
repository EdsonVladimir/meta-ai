// Coordinación pura del espacio de requisitos: qué respuesta aplicar, cuándo
// pedir confirmación por borrador sin guardar y cuándo se puede aprobar.
// Sin React ni Tauri: se prueba con vitest sin DOM.

export interface ResponseMeta {
  key: string;
  epoch: number;
}

/**
 * Una respuesta solo se aplica si sigue siendo la última pedida para la
 * selección actual. Así una respuesta tardía jamás reemplaza la selección
 * o el contenido de otro requisito.
 */
export function shouldApplyResponse(
  current: ResponseMeta,
  incoming: ResponseMeta,
): boolean {
  return incoming.key === current.key && incoming.epoch === current.epoch;
}

/** ¿Hay que ofrecer guardar/descartar/cancelar antes de cambiar de objetivo? */
export function needsConfirm(
  dirty: boolean,
  currentRequirementId: string | null,
  targetRequirementId: string | null,
): boolean {
  if (!dirty) return false;
  return currentRequirementId !== targetRequirementId;
}

export interface DraftState {
  requirementId: string | null;
  content: string;
  /** Contenido guardado contra el que se compara: re-escribirlo limpia. */
  base: string;
  /** Generación de edición: un `saved` tardío solo vale para su `rev`. */
  rev: number;
  dirty: boolean;
}

export const EMPTY_DRAFT: DraftState = {
  requirementId: null,
  content: "",
  base: "",
  rev: 0,
  dirty: false,
};

export type DraftAction =
  | { type: "edit"; content: string }
  | { type: "snapshot"; requirementId: string; content: string }
  | { type: "saved"; requirementId: string; content: string; rev: number }
  | { type: "saveFailed" }
  | { type: "discard"; requirementId: string; content: string }
  | { type: "select"; requirementId: string | null };

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "edit":
      return { ...state, content: action.content, rev: state.rev + 1, dirty: action.content !== state.base };
    case "snapshot":
      // Un refresco nunca sobrescribe un borrador con cambios sin guardar.
      if (state.dirty) return state;
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "saved":
      // Solo el resultado de ESTA petición limpia: si se editó durante el
      // guardado (rev distinto) o el borrador es de otro requisito, el
      // contenido nuevo se conserva sucio y guardará como otra versión.
      if (action.rev !== state.rev || action.requirementId !== state.requirementId) {
        return state;
      }
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "saveFailed":
      // Un error (p. ej. concurrencia) conserva el borrador intacto.
      return state;
    case "discard":
      // Descarte explícito de la persona: resincroniza sin condiciones.
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "select":
      return { requirementId: action.requirementId, content: "", base: "", rev: 0, dirty: false };
  }
}

export interface ReviewState {
  reviewedVersionId: string | null;
}

export const EMPTY_REVIEW: ReviewState = { reviewedVersionId: null };

export type ReviewAction =
  | { type: "toggle"; versionId: string; checked: boolean }
  | { type: "reset" };

export function reviewReducer(_state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "toggle":
      return { reviewedVersionId: action.checked ? action.versionId : null };
    case "reset":
      return EMPTY_REVIEW;
  }
}

/**
 * Estado de guardado visible: borrador local, guardando, guardado o error.
 * Sin requisito seleccionado no hay nada que guardar (`idle`).
 */
export type SaveState = "idle" | "draft" | "saving" | "saved" | "error";

export function saveState(input: {
  hasSelection: boolean;
  saving: boolean;
  error: string | null;
  dirty: boolean;
}): SaveState {
  if (!input.hasSelection) return "idle";
  if (input.saving) return "saving";
  if (input.error !== null) return "error";
  if (input.dirty) return "draft";
  return "saved";
}

export interface ApprovalGate {
  reviewedVersionId: string | null;
  currentVersionId: string;
  dirty: boolean;
  approver: string;
  busy: boolean;
}

/**
 * La interfaz solo facilita la operación: exige confirmación de esa versión
 * concreta, borrador limpio y autor. Rust vuelve a validar las invariantes.
 */
export function canApprove(gate: ApprovalGate): boolean {
  if (gate.busy || gate.dirty) return false;
  if (gate.approver.trim() === "") return false;
  return gate.reviewedVersionId === gate.currentVersionId;
}

/** Documento al que Ctrl+S debe dirigirse, o ninguno. */
export type SaveTarget = "requirement" | "design" | "mockup";

/**
 * Resuelve el objetivo de Guardar (Ctrl+S o botón) desde la vista activa,
 * la selección y qué borradores tienen cambios semánticos. Puro y
 * probado: sin cambios no hay guardado (nunca versiones idénticas).
 */
export function resolveSaveTarget(input: {
  centerView: "requirements" | "design" | "impact" | "mockups";
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
  requirementDirty: boolean;
  designDirty: boolean;
  designKeyOk: boolean;
  mockupDirty: boolean;
  mockupKeyOk: boolean;
}): SaveTarget | null {
  if (input.centerView === "requirements") {
    if (input.requirementId !== null && input.requirementDirty) return "requirement";
    return null;
  }
  if (input.centerView === "design") {
    if (input.designId !== null && input.designDirty && input.designKeyOk) return "design";
    return null;
  }
  if (input.centerView === "mockups") {
    if (input.mockupId !== null && input.mockupDirty && input.mockupKeyOk) return "mockup";
    return null;
  }
  return null;
}
