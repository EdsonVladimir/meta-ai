// Estado del borrador visual, elevado al workspace para sobrevivir a
// cambios de pestaña. Puro: sin React. La especificación viaja como texto
// canónico (comparable por igualdad) y la disposición aparte: mover
// elementos o el zoom nunca ensucian la semántica.
//
// dirty semántico = spec ≠ base → guardar crea versión nueva.
// dirty de disposición = layout ≠ baseLayout → guardar solo dispone.
import type { DesignKind } from "../types";
import { createHistory, pushHistory, redoHistory, undoHistory, type SpecHistory } from "./specHistory";
import type { Layout } from "./specModel";

export interface VisualDraftState {
  /** `${artifactId}:${versionId}` de la versión editada. */
  key: string;
  kind: DesignKind;
  /** Especificación canónica de la versión actual (punto de partida). */
  base: string;
  history: SpecHistory;
  layout: Layout;
  baseLayout: Layout;
  /** Artefactos citables (fuentes declaradas). */
  allowed: string[];
  /** Versiones exactas declaradas para el guardado. */
  pins: string[];
}

export type VisualDraftAction =
  | {
      type: "init";
      key: string;
      kind: DesignKind;
      base: string;
      layout: Layout;
      allowed: string[];
      pins: string[];
    }
  | { type: "apply"; spec: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "layout"; layout: Layout }
  | { type: "pins"; pins: string[]; allowed: string[] }
  | { type: "saved"; present: string; pins: string[]; allowed: string[] }
  | { type: "savedLayout"; layout: Layout }
  | { type: "reset" };

/** Sin borrador (null) hasta que el editor lo inicia para una versión. */
export function visualDraftReducer(
  state: VisualDraftState | null,
  action: VisualDraftAction,
): VisualDraftState | null {
  switch (action.type) {
    case "init":
      if (state !== null && state.key === action.key) return state;
      return {
        key: action.key,
        kind: action.kind,
        base: action.base,
        history: createHistory(action.base),
        layout: action.layout,
        baseLayout: action.layout,
        allowed: action.allowed,
        pins: action.pins,
      };
    case "reset":
      return null;
    default:
      break;
  }
  if (state === null) return null;
  switch (action.type) {
    case "apply":
      return { ...state, history: pushHistory(state.history, action.spec) };
    case "undo":
      return { ...state, history: undoHistory(state.history) };
    case "redo":
      return { ...state, history: redoHistory(state.history) };
    case "move":
      if (state.layout[action.id]?.x === action.x && state.layout[action.id]?.y === action.y) {
        return state;
      }
      return { ...state, layout: { ...state.layout, [action.id]: { x: action.x, y: action.y } } };
    case "layout":
      return { ...state, layout: action.layout };
    case "pins":
      return { ...state, pins: action.pins, allowed: action.allowed };
    case "saved":
      // Solo limpia si nada cambió durante la petición: lo editado
      // mientras tanto se conserva (y el detalle avanzado lo marca como
      // separado para resolverlo en el panel de conflicto, no a ciegas).
      if (
        state.history.present !== action.present ||
        !sameList(state.pins, action.pins) ||
        !sameList(state.allowed, action.allowed)
      ) {
        return state;
      }
      return null;
    case "savedLayout":
      // Igual para la disposición: solo adopta la base si sigue siendo la
      // que se guardó; lo movido durante la petición sigue pendiente.
      if (layoutKey(state.layout) !== layoutKey(action.layout)) return state;
      return { ...state, baseLayout: state.layout };
  }
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * ¿Hay que confirmar antes de navegar? Borrador visual con cambios y el
 * destino abandona el diseño (otro diseño, módulo o proyecto).
 */
export function needsVisualConfirm(
  state: VisualDraftState | null,
  currentDesignId: string | null,
  targetDesignId: string | null,
): boolean {
  if (state === null) return false;
  if (!visualSemanticDirty(state) && !visualLayoutDirty(state)) return false;
  return currentDesignId !== targetDesignId;
}

/** ¿Cambió la semántica respecto a la versión guardada? */
export function visualSemanticDirty(state: VisualDraftState | null): boolean {
  return state !== null && state.history.present !== state.base;
}

function layoutKey(layout: Layout): string {
  return Object.keys(layout)
    .sort()
    .map((key) => {
      const entry = layout[key];
      return `${key}:${entry.x},${entry.y},${entry.w ?? ""},${entry.h ?? ""}`;
    })
    .join("|");
}

/** ¿Cambió solo la disposición? */
export function visualLayoutDirty(state: VisualDraftState | null): boolean {
  return state !== null && layoutKey(state.layout) !== layoutKey(state.baseLayout);
}

/** Borrador actual como texto canónico (o null sin borrador). */
export function visualSpec(state: VisualDraftState | null): string | null {
  return state?.history.present ?? null;
}
