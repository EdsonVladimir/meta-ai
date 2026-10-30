// Visual draft state, lifted to the workspace to survive tab switches.
// Pure: no React. The spec travels as canonical text (equality
// comparable) and the layout separately: moving elements or zooming
// never dirties semantics.
//
// semantic dirty = spec ≠ base → saving creates a new version.
// layout dirty = layout ≠ baseLayout → saving only lays out.
import type { DesignKind } from "../types";
import { createHistory, pushHistory, redoHistory, undoHistory, type SpecHistory } from "./specHistory";
import type { Layout } from "./specModel";

export interface VisualDraftState {
  /** `${artifactId}:${versionId}` of the edited version. */
  key: string;
  kind: DesignKind;
  /** Canonical spec of the current version (starting point). */
  base: string;
  history: SpecHistory;
  layout: Layout;
  baseLayout: Layout;
  /** Citable artifacts (declared sources). */
  allowed: string[];
  /** Exact versions declared for saving. */
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

/** No draft (null) until the editor starts one for a version. */
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
      // Only clears when nothing changed during the request: edits made
      // meanwhile are kept (and the moved-on detail marks them as
      // detached for conflict-panel resolution, not blindly).
      if (
        state.history.present !== action.present ||
        !sameList(state.pins, action.pins) ||
        !sameList(state.allowed, action.allowed)
      ) {
        return state;
      }
      return null;
    case "savedLayout":
      // Same for layout: only adopts the base when it is still the one
      // that was saved; moves made during the request stay pending.
      if (layoutKey(state.layout) !== layoutKey(action.layout)) return state;
      return { ...state, baseLayout: state.layout };
  }
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Must navigation confirm first? Visual draft with changes and the
 * target leaves the design (another design, module or project).
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

/** Did semantics change vs the saved version? */
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

/** Did only the layout change? */
export function visualLayoutDirty(state: VisualDraftState | null): boolean {
  return state !== null && layoutKey(state.layout) !== layoutKey(state.baseLayout);
}
