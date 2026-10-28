// Selección compartida de la interfaz (Zustand). Solo UI: contexto
// seleccionado (proyecto, módulo, requisito y diseño independientes),
// perspectiva (vista central), visibilidad de paneles y ancho del
// explorador. Los borradores quedan en estado local de React y los datos
// de dominio en instantáneas de Rust, fuera del store.
//
// Selección y perspectiva están separadas: cambiar de pestaña nunca toca
// el contexto; navegar limpia únicamente selecciones incompatibles (ver
// `navigation.ts`).
import { create } from "zustand";

export interface Selection {
  projectId: string | null;
  moduleId: string | null;
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
}

export type PanelName = "navigator" | "review" | "terminal" | "assistant";

/** Pestaña de la columna derecha (revisión o asistente). */
export type RightTab = "review" | "assistant";

export type CenterView = "requirements" | "design" | "impact" | "mockups";

/** Ancho del explorador en px; null usa el valor CSS por defecto. */
export const DEFAULT_RIGHT_WIDTH = 336; // 21rem
export const MIN_RIGHT_WIDTH = 256;
export const MAX_RIGHT_WIDTH = 560;

export const DEFAULT_NAV_WIDTH = 272; // 17rem
export const MIN_NAV_WIDTH = 200;
export const MAX_NAV_WIDTH = 520;

/** Nombres vigentes del contexto, solo presentación (la clave es el ID). */
export interface ContextNames {
  project: string | null;
  module: string | null;
}

/** Resultado visible del último Guardar central (transitorio, solo UI). */
export interface LastSave {
  message: string;
  kind: "ok" | "info" | "error";
  at: number;
}

/**
 * Estado de guardado de UN documento (`req:{id}`, `design:{id}`,
 * `mockup:{id}`). Por documento, nunca un flag global: el encabezado
 * muestra el activo y cuenta los demás por separado.
 */
export interface DocSaveState {
  /** Etiqueta legible (`requisito …`, `diseño …`, `mockup …`). */
  label: string;
  dirty: boolean;
  saving: boolean;
  error: string | null;
}

/** Resultado de un Guardar-todo pedido desde el encabezado. */
export interface SaveAllResult {
  ok: boolean;
  message: string;
  at: number;
}

interface RequirementsUiState {
  selection: Selection;
  centerView: CenterView;
  panels: Record<PanelName, boolean>;
  rightTab: RightTab;
  navigatorWidth: number | null;
  rightWidth: number | null;
  contextNames: ContextNames;
  /** Contador de peticiones de Guardar (botón de cabecera → workspace). */
  saveSignal: number;
  lastSave: LastSave | null;
  /** Estado por documento, publicado por el workspace (solo lectura). */
  docStatus: Record<string, DocSaveState>;
  /** Contador de peticiones de Guardar-todo (exportación → workspace). */
  saveAllSignal: number;
  saveAllResult: SaveAllResult | null;
  setSelection: (selection: Selection) => void;
  setCenterView: (view: CenterView) => void;
  togglePanel: (panel: PanelName) => void;
  setRightTab: (tab: RightTab) => void;
  setNavigatorWidth: (width: number | null) => void;
  setRightWidth: (width: number | null) => void;
  setContextNames: (names: ContextNames) => void;
  requestSave: () => void;
  setLastSave: (save: LastSave | null) => void;
  setDocStatus: (next: Record<string, DocSaveState>) => void;
  requestSaveAll: () => void;
  resolveSaveAll: (result: SaveAllResult | null) => void;
}

const EMPTY_SELECTION: Selection = {
  projectId: null,
  moduleId: null,
  requirementId: null,
  designId: null,
  mockupId: null,
};

export const useRequirementsUi = create<RequirementsUiState>()((set) => ({
  selection: EMPTY_SELECTION,
  centerView: "requirements",
  panels: { navigator: true, review: true, terminal: false, assistant: true },
  rightTab: "review",
  navigatorWidth: null,
  rightWidth: null,
  contextNames: { project: null, module: null },
  saveSignal: 0,
  lastSave: null,
  docStatus: {},
  saveAllSignal: 0,
  saveAllResult: null,
  requestSave: () => set((state) => ({ saveSignal: state.saveSignal + 1 })),
  setLastSave: (lastSave) => set({ lastSave }),
  setDocStatus: (docStatus) => set({ docStatus }),
  requestSaveAll: () => set((state) => ({ saveAllSignal: state.saveAllSignal + 1 })),
  resolveSaveAll: (saveAllResult) => set({ saveAllResult }),
  setContextNames: (contextNames) => set({ contextNames }),
  setSelection: (selection) =>
    set({ selection, contextNames: { project: null, module: null } }),
  setCenterView: (centerView) => set({ centerView }),
  togglePanel: (panel) =>
    set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } })),
  setRightTab: (rightTab) => set({ rightTab }),
  setNavigatorWidth: (navigatorWidth) => set({ navigatorWidth }),
  setRightWidth: (rightWidth) => set({ rightWidth }),
}));
