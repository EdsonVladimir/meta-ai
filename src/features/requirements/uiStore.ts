// Shared UI selection (Zustand). UI only: selected context (project,
// module, requirement and design independently), perspective (center
// view), panel visibility and explorer width. Drafts stay in local React
// state and domain data in Rust snapshots, outside the store.
//
// Selection and perspective are separate: switching tabs never touches
// the context; navigating only clears incompatible selections (see
// `navigation.ts`).
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ExternalFolder } from "../code/archmap/externalLibraries";
import type { LayerOverrides } from "../code/archmap/mapFilter";

export interface Selection {
  projectId: string | null;
  moduleId: string | null;
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
  /** Active mockup screen (perspectives keep it). */
  screenId: string | null;
}

/**
 * Active Architecture scope: the joint view, one detected code
 * project, or one explicitly chosen folder. Independent from the
 * Ruth selection above (business modules are not code projects)
 * and from tree expansion.
 */
export type ArchScope =
  | { kind: "all" }
  | { kind: "project"; rootId: string; rel: string }
  | { kind: "folder"; rootId: string; rel: string };

/** Folder picked in the code tree for exploring (never a scope). */
export interface CodeFolderSelection {
  rootId: string;
  rel: string;
}

export type PanelName = "navigator" | "review" | "terminal" | "assistant";

/** Right-column tab (review or assistant). */
export type RightTab = "review" | "assistant";

/** Central views: welcome first, then the open workspace. Files open as
 * document tabs above every view, so no "code" view is required. */
export type CenterView =
  | "welcome"
  | "overview"
  | "requirements"
  | "design"
  | "impact"
  | "mockups"
  | "architecture"
  | "traceability";

/** "Open terminal here" request from the code tree. */
export interface TerminalCwdRequest {
  cwd: string;
  nonce: number;
}

/** Active code tab with a readable label (for linking modules). */
export interface CodeActiveFile {
  rootId: string;
  rootName: string;
  rel: string;
}

/** File-open request (a link → code tab). */
export interface CodeOpenRequest {
  rootId: string;
  rel: string;
  nonce: number;
}

/** Explorer width in px; null uses the CSS default. */
export const DEFAULT_RIGHT_WIDTH = 336; // 21rem
export const MIN_RIGHT_WIDTH = 256;
export const MAX_RIGHT_WIDTH = 560;

export const DEFAULT_NAV_WIDTH = 272; // 17rem
export const MIN_NAV_WIDTH = 200;
export const MAX_NAV_WIDTH = 520;

/** Terminal panel height in px; null uses the default. */
export const DEFAULT_TERMINAL_HEIGHT = 260;
export const MIN_TERMINAL_HEIGHT = 160;
export const MAX_TERMINAL_HEIGHT = 560;

/** Architecture board inspector width in px; null uses the CSS default. */
export const DEFAULT_ARCH_INSPECTOR_WIDTH = 304; // 19rem
export const MIN_ARCH_INSPECTOR_WIDTH = 240;
export const MAX_ARCH_INSPECTOR_WIDTH = 560;

/** Keyboard step for the resize handles (px or fraction). */
export const RESIZE_KEYBOARD_STEP_PX = 16;
export const RESIZE_KEYBOARD_STEP_FRAC = 0.05;

/** Current context names, presentation only (the key is the ID). */
export interface ContextNames {
  project: string | null;
  module: string | null;
}

/** Visible result of the last central Save (transient, UI only). */
export interface LastSave {
  message: string;
  kind: "ok" | "info" | "error";
  at: number;
}

/**
 * Save state of ONE document (`req:{id}`, `design:{id}`, `mockup:{id}`).
 * Per document, never a global flag: the header shows the active one and
 * counts the rest separately.
 */
export interface DocSaveState {
  /** Readable label (`requirement …`, `design …`, `mockup …`). */
  label: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/** Result of a Save-all requested from the header. */
export interface SaveAllResult {
  ok: boolean;
  message: string;
  at: number;
}

interface RequirementsUiState {
  selection: Selection;
  centerView: CenterView;
  /** Open document shown in the center (`root::rel`); null shows the view. */
  centerDoc: string | null;
  /** Code library version (roots, links, snapshots). */
  codeLibraryToken: number;
  /** Project tree version (replicas and external changes). */
  explorerToken: number;
  terminalRequest: TerminalCwdRequest | null;
  /** Same tab with a readable label (for linking modules). */
  codeActiveFile: CodeActiveFile | null;
  codeOpenRequest: CodeOpenRequest | null;
  panels: Record<PanelName, boolean>;
  rightTab: RightTab;
  navigatorWidth: number | null;
  rightWidth: number | null;
  /** null = default height; null fractions = even split. */
  terminalHeight: number | null;
  terminalPaneWidths: number[] | null;
  contextNames: ContextNames;
  /** Save request counter (header button → workspace). */
  saveSignal: number;
  lastSave: LastSave | null;
  /** Per-document status, published by the workspace (read-only). */
  docStatus: Record<string, DocSaveState>;
  /** Save-all request counter (export → workspace). */
  saveAllSignal: number;
  saveAllResult: SaveAllResult | null;
  /** Discard-all request counter (workspace close → draft owners). */
  discardSignal: number;
  /** Terminal takes the center height temporarily (session-only). */
  terminalMaximized: boolean;
  /** Roots hidden from the project maps (session-only, never persisted). */
  mapHiddenRoots: Record<string, boolean>;
  /** Active Architecture scope (session-only). */
  archScope: ArchScope;
  /** Detected projects hidden from the joint view, by scope key. */
  mapHiddenProjects: Record<string, boolean>;
  /** Folder picked in the code tree for exploring (session-only). */
  codeFolderSelection: CodeFolderSelection | null;
  /** Board inspector width (null = CSS default); collapse is session-only. */
  archInspectorWidth: number | null;
  archInspectorCollapsed: boolean;
  /** Manual symbol layers by symbol id (validated + capped when persisted). */
  layerOverrides: LayerOverrides;
  /** Architecture module filter key, null = all modules (session-only). */
  archModule: string | null;
  /** Show summarized external references of the module (session-only). */
  archShowExternalRefs: boolean;
  /** Project folders treated as external libraries (validated + capped). */
  archExternalFolders: ExternalFolder[];
  setSelection: (selection: Selection) => void;
  setCenterView: (view: CenterView) => void;
  setCenterDoc: (key: string | null) => void;
  bumpCodeLibrary: () => void;
  bumpExplorer: () => void;
  setCodeActiveFile: (file: CodeActiveFile | null) => void;
  requestCodeOpen: (rootId: string, rel: string) => void;
  setPanel: (panel: PanelName, visible: boolean) => void;
  requestTerminalAt: (cwd: string) => void;
  togglePanel: (panel: PanelName) => void;
  setRightTab: (tab: RightTab) => void;
  setNavigatorWidth: (width: number | null) => void;
  setRightWidth: (width: number | null) => void;
  setTerminalHeight: (height: number | null) => void;
  setTerminalPaneWidths: (widths: number[] | null) => void;
  setContextNames: (names: ContextNames) => void;
  requestSave: () => void;
  setLastSave: (save: LastSave | null) => void;
  setDocStatus: (next: Record<string, DocSaveState>) => void;
  requestSaveAll: () => void;
  resolveSaveAll: (result: SaveAllResult | null) => void;
  requestDiscard: () => void;
  setTerminalMaximized: (maximized: boolean) => void;
  /** Clears persisted sizes back to CSS defaults (visibility untouched). */
  resetLayout: () => void;
  toggleMapRoot: (rootId: string) => void;
  setArchScope: (scope: ArchScope) => void;
  toggleMapProject: (key: string) => void;
  showAllMapProjects: () => void;
  setCodeFolderSelection: (selection: CodeFolderSelection | null) => void;
  setArchInspectorWidth: (width: number | null) => void;
  setArchInspectorCollapsed: (collapsed: boolean) => void;
  /** Sets (or clears, with null) the manual layer of one symbol. */
  setLayerOverride: (id: string, value: LayerOverrides[string] | null) => void;
  setArchModule: (key: string | null) => void;
  setArchShowExternalRefs: (show: boolean) => void;
  addArchExternalFolder: (folder: ExternalFolder) => void;
  removeArchExternalFolder: (folder: ExternalFolder) => void;
}

export const EMPTY_SELECTION: Selection = {
  projectId: null,
  moduleId: null,
  requirementId: null,
  designId: null,
  mockupId: null,
  screenId: null,
};

/** Size storage key (WebView, never SQLite). */
export const LAYOUT_STORAGE_KEY = "ruth-ide:layout";

/** Bound on persisted per-project visibility entries. */
export const MAX_PERSISTED_HIDDEN_PROJECTS = 200;

/** Bound on persisted manual layer overrides. */
export const MAX_PERSISTED_LAYER_OVERRIDES = 200;

/** Bound on persisted external folders. */
export const MAX_PERSISTED_EXTERNAL_FOLDERS = 50;

/** localStorage blind to odd environments: corrupt or missing = default. */
const layoutStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
    } catch {
      // Without persistence (private/full): the session keeps working.
    }
  },
  removeItem: (key: string): void => {
    try {
      if (typeof localStorage !== "undefined") localStorage.removeItem(key);
    } catch {
      // Same: nothing critical depends on deleting.
    }
  },
};

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validates the persisted fragment: corrupt or out-of-range values go
 * back to null (= default). Pure and tested.
 */
function validateHiddenProjects(persisted: unknown): Record<string, boolean> {
  if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(persisted)) {
    if (typeof value !== "boolean" || key.length === 0 || key.length > 512) continue;
    out[key] = value;
    if (Object.keys(out).length >= MAX_PERSISTED_HIDDEN_PROJECTS) break;
  }
  return out;
}

/**
 * Structural check only (shape + cap): semantic validity (known layer,
 * matching symbol name) is enforced where overrides apply, so stale
 * entries degrade to the automatic verdict instead of corrupting.
 */
function validateLayerOverrides(persisted: unknown): LayerOverrides {
  if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) return {};
  const out: LayerOverrides = {};
  for (const [key, value] of Object.entries(persisted)) {
    if (key.length === 0 || key.length > 512) continue;
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.layer !== "string" ||
      entry.layer.length === 0 ||
      entry.layer.length > 64 ||
      typeof entry.name !== "string" ||
      entry.name.length === 0 ||
      entry.name.length > 512
    ) {
      continue;
    }
    out[key] = { layer: entry.layer as LayerOverrides[string]["layer"], name: entry.name };
    if (Object.keys(out).length >= MAX_PERSISTED_LAYER_OVERRIDES) break;
  }
  return out;
}

function validateExternalFolders(persisted: unknown): ExternalFolder[] {
  if (!Array.isArray(persisted)) return [];
  const out: ExternalFolder[] = [];
  for (const value of persisted as unknown[]) {
    if (typeof value !== "object" || value === null) continue;
    const { rootId, rel } = value as Record<string, unknown>;
    if (typeof rootId !== "string" || rootId.length === 0 || rootId.length > 512) continue;
    if (typeof rel !== "string" || rel.length === 0 || rel.length > 512) continue;
    out.push({ rootId, rel });
    if (out.length >= MAX_PERSISTED_EXTERNAL_FOLDERS) break;
  }
  return out;
}

export function validateLayoutPartial(persisted: unknown): {
  navigatorWidth: number | null;
  rightWidth: number | null;
  terminalHeight: number | null;
  terminalPaneWidths: number[] | null;
  mapHiddenProjects: Record<string, boolean>;
  archInspectorWidth: number | null;
  layerOverrides: LayerOverrides;
  archExternalFolders: ExternalFolder[];
} {
  const fallback = {
    navigatorWidth: null,
    rightWidth: null,
    terminalHeight: null,
    terminalPaneWidths: null,
    mapHiddenProjects: {},
    archInspectorWidth: null,
    layerOverrides: {},
    archExternalFolders: [],
  };
  if (typeof persisted !== "object" || persisted === null) return fallback;
  const partial = persisted as Record<string, unknown>;
  const widths = partial.terminalPaneWidths;
  return {
    navigatorWidth: inRange(partial.navigatorWidth, MIN_NAV_WIDTH, MAX_NAV_WIDTH)
      ? (partial.navigatorWidth as number)
      : null,
    rightWidth: inRange(partial.rightWidth, MIN_RIGHT_WIDTH, MAX_RIGHT_WIDTH)
      ? (partial.rightWidth as number)
      : null,
    terminalHeight: inRange(partial.terminalHeight, MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT)
      ? (partial.terminalHeight as number)
      : null,
    terminalPaneWidths:
      Array.isArray(widths) &&
      widths.length > 0 &&
      widths.length <= 8 &&
      widths.every((w): w is number => typeof w === "number" && Number.isFinite(w) && w > 0 && w < 1)
        ? [...widths]
        : null,
    mapHiddenProjects: validateHiddenProjects(partial.mapHiddenProjects),
    archInspectorWidth: inRange(
      partial.archInspectorWidth,
      MIN_ARCH_INSPECTOR_WIDTH,
      MAX_ARCH_INSPECTOR_WIDTH,
    )
      ? (partial.archInspectorWidth as number)
      : null,
    layerOverrides: validateLayerOverrides(partial.layerOverrides),
    archExternalFolders: validateExternalFolders(partial.archExternalFolders),
  };
}

export const useRequirementsUi = create<RequirementsUiState>()(
  persist(
    (set) => ({
  selection: EMPTY_SELECTION,
  centerView: "welcome",
  centerDoc: null,
  codeLibraryToken: 0,
  explorerToken: 0,
  terminalRequest: null,
  codeActiveFile: null,
  codeOpenRequest: null,
  panels: { navigator: true, review: true, terminal: false, assistant: true },
  rightTab: "review",
  navigatorWidth: null,
  rightWidth: null,
  terminalHeight: null,
  terminalPaneWidths: null,
  contextNames: { project: null, module: null },
  saveSignal: 0,
  lastSave: null,
  docStatus: {},
  saveAllSignal: 0,
  saveAllResult: null,
  discardSignal: 0,
  terminalMaximized: false,
  mapHiddenRoots: {},
  archScope: { kind: "all" },
  mapHiddenProjects: {},
  codeFolderSelection: null,
  archInspectorWidth: null,
  archInspectorCollapsed: true,
  layerOverrides: {},
  archModule: null,
  archShowExternalRefs: false,
  archExternalFolders: [],
  toggleMapRoot: (rootId) =>
    set((state) => ({
      mapHiddenRoots: { ...state.mapHiddenRoots, [rootId]: !state.mapHiddenRoots[rootId] },
    })),
  setArchScope: (archScope) => set({ archScope }),
  toggleMapProject: (key) =>
    set((state) => ({
      mapHiddenProjects: { ...state.mapHiddenProjects, [key]: !state.mapHiddenProjects[key] },
    })),
  showAllMapProjects: () => set({ mapHiddenProjects: {} }),
  setCodeFolderSelection: (codeFolderSelection) => set({ codeFolderSelection }),
  setArchInspectorWidth: (archInspectorWidth) => set({ archInspectorWidth }),
  setArchInspectorCollapsed: (archInspectorCollapsed) => set({ archInspectorCollapsed }),
  setLayerOverride: (id, value) =>
    set((state) => {
      const layerOverrides = { ...state.layerOverrides };
      if (value === null) delete layerOverrides[id];
      else layerOverrides[id] = value;
      return { layerOverrides };
    }),
  setArchModule: (archModule) => set({ archModule }),
  setArchShowExternalRefs: (archShowExternalRefs) => set({ archShowExternalRefs }),
  addArchExternalFolder: (folder) =>
    set((state) => ({
      archExternalFolders: [
        ...state.archExternalFolders.filter(
          (entry) => entry.rootId !== folder.rootId || entry.rel !== folder.rel,
        ),
        folder,
      ].slice(-MAX_PERSISTED_EXTERNAL_FOLDERS),
    })),
  removeArchExternalFolder: (folder) =>
    set((state) => ({
      archExternalFolders: state.archExternalFolders.filter(
        (entry) => entry.rootId !== folder.rootId || entry.rel !== folder.rel,
      ),
    })),
  requestSave: () => set((state) => ({ saveSignal: state.saveSignal + 1 })),
  setLastSave: (lastSave) => set({ lastSave }),
  setDocStatus: (docStatus) => set({ docStatus }),
  requestSaveAll: () => set((state) => ({ saveAllSignal: state.saveAllSignal + 1 })),
  resolveSaveAll: (saveAllResult) => set({ saveAllResult }),
  requestDiscard: () => set((state) => ({ discardSignal: state.discardSignal + 1 })),
  setTerminalMaximized: (terminalMaximized) => set({ terminalMaximized }),
  resetLayout: () =>
    set({
      navigatorWidth: null,
      rightWidth: null,
      terminalHeight: null,
      terminalPaneWidths: null,
      terminalMaximized: false,
      archInspectorWidth: null,
    }),
  setContextNames: (contextNames) => set({ contextNames }),
  setSelection: (selection) =>
    set({ selection, contextNames: { project: null, module: null } }),
  setCenterView: (centerView) => set({ centerView }),
  setCenterDoc: (centerDoc) => set({ centerDoc }),
  bumpCodeLibrary: () => set((state) => ({ codeLibraryToken: state.codeLibraryToken + 1 })),
  bumpExplorer: () => set((state) => ({ explorerToken: state.explorerToken + 1 })),
  setCodeActiveFile: (codeActiveFile) => set({ codeActiveFile }),
  requestCodeOpen: (rootId, rel) =>
    set((state) => ({
      codeOpenRequest: { rootId, rel, nonce: (state.codeOpenRequest?.nonce ?? 0) + 1 },
    })),
  setPanel: (panel, visible) =>
    set((state) => ({ panels: { ...state.panels, [panel]: visible } })),
  requestTerminalAt: (cwd) =>
    set((state) => ({
      terminalRequest: { cwd, nonce: (state.terminalRequest?.nonce ?? 0) + 1 },
    })),
  togglePanel: (panel) =>
    set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } })),
  setRightTab: (rightTab) => set({ rightTab }),
  setNavigatorWidth: (navigatorWidth) => set({ navigatorWidth }),
  setRightWidth: (rightWidth) => set({ rightWidth }),
  setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
  setTerminalPaneWidths: (terminalPaneWidths) => set({ terminalPaneWidths }),
    }),
    {
      /** Panel sizes and project visibility: no domain, drafts or keys. */
      name: "ruth-ide:layout",
      version: 1,
      storage: createJSONStorage(() => layoutStorage),
      partialize: (state) => ({
        navigatorWidth: state.navigatorWidth,
        rightWidth: state.rightWidth,
        terminalHeight: state.terminalHeight,
        terminalPaneWidths: state.terminalPaneWidths,
        mapHiddenProjects: state.mapHiddenProjects,
        archInspectorWidth: state.archInspectorWidth,
        layerOverrides: state.layerOverrides,
        archExternalFolders: state.archExternalFolders,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...validateLayoutPartial(persisted),
      }),
    },
  ),
);
