// Mockup draft state, lifted to the workspace to survive tab switches.
// Pure: no React. Mirrors the visual design draft: the spec travels as
// canonical text (comparable) and the layout separately (position and
// size): moving or resizing never dirties semantics.
//
// semantic dirty = spec ≠ base → saving creates a new version.
// layout dirty = layout ≠ baseLayout → saving only lays out.
import { createHistory, pushHistory, redoHistory, undoHistory, type SpecHistory } from "../design/editing/specHistory";
import type { Layout } from "../design/editing/specModel";

export interface MockupDraftState {
  /** `${artifactId}:${versionId}` of the edited version. */
  key: string;
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

export type MockupDraftAction =
  | {
      type: "init";
      key: string;
      base: string;
      layout: Layout;
      allowed: string[];
      pins: string[];
    }
  | { type: "apply"; spec: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "resize"; id: string; w: number; h: number }
  | { type: "layout"; layout: Layout }
  | { type: "remap"; oldId: string; newId: string }
  | { type: "pins"; pins: string[]; allowed: string[] }
  | { type: "saved"; present: string; pins: string[]; allowed: string[] }
  | { type: "savedLayout"; layout: Layout }
  | { type: "reset" };

/** No draft (null) until the editor starts one for a version. */
export function mockupDraftReducer(
  state: MockupDraftState | null,
  action: MockupDraftAction,
): MockupDraftState | null {
  switch (action.type) {
    case "init":
      if (state !== null && state.key === action.key) return state;
      return {
        key: action.key,
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
    case "move": {
      const prev = state.layout[action.id];
      if (prev?.x === action.x && prev?.y === action.y) return state;
      return {
        ...state,
        layout: { ...state.layout, [action.id]: { ...prev, x: action.x, y: action.y } },
      };
    }
    case "resize": {
      const prev = state.layout[action.id];
      if (prev?.w === action.w && prev?.h === action.h) return state;
      return {
        ...state,
        layout: { ...state.layout, [action.id]: { x: prev?.x ?? 0, y: prev?.y ?? 0, w: action.w, h: action.h } },
      };
    }
    case "layout":
      return { ...state, layout: action.layout };
    case "remap": {
      if (action.oldId === action.newId || state.layout[action.oldId] === undefined) return state;
      const layout = { ...state.layout };
      layout[action.newId] = layout[action.oldId];
      delete layout[action.oldId];
      return { ...state, layout };
    }
    case "pins":
      return { ...state, pins: action.pins, allowed: action.allowed };
    case "saved":
      // Only clears when nothing changed during the request: edits made
      // meanwhile are kept for conflict resolution.
      if (
        state.history.present !== action.present ||
        !sameMockupList(state.pins, action.pins) ||
        !sameMockupList(state.allowed, action.allowed)
      ) {
        return state;
      }
      return null;
    case "savedLayout":
      if (layoutKey(state.layout) !== layoutKey(action.layout)) return state;
      return { ...state, baseLayout: state.layout };
  }
}

function sameMockupList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * Must navigation confirm first? Draft with changes and the target
 * leaves the mockup (another mockup, module or project).
 */
export function needsMockupConfirm(
  state: MockupDraftState | null,
  currentMockupId: string | null,
  targetMockupId: string | null,
): boolean {
  if (state === null) return false;
  if (!mockupSemanticDirty(state) && !mockupLayoutDirty(state)) return false;
  return currentMockupId !== targetMockupId;
}

/** Did semantics change vs the saved version? */
export function mockupSemanticDirty(state: MockupDraftState | null): boolean {
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
export function mockupLayoutDirty(state: MockupDraftState | null): boolean {
  return state !== null && layoutKey(state.layout) !== layoutKey(state.baseLayout);
}

/** Current draft as canonical text (or null without a draft). */
export function mockupSpec(state: MockupDraftState | null): string | null {
  return state?.history.present ?? null;
}
