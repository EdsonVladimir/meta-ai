// Selección compartida de la interfaz (Zustand). Solo UI: proyecto, módulo,
// artefacto seleccionado (requisito o diseño), vista central y visibilidad
// de paneles. Los borradores quedan en estado local de React y los datos de
// dominio en instantáneas de Rust, fuera del store.
import { create } from "zustand";

export interface Selection {
  projectId: string | null;
  moduleId: string | null;
  requirementId: string | null;
  designId: string | null;
}

export type PanelName = "navigator" | "review";

export type CenterView = "requirements" | "design";

interface RequirementsUiState {
  selection: Selection;
  centerView: CenterView;
  panels: Record<PanelName, boolean>;
  selectProject: (projectId: string | null) => void;
  selectModule: (moduleId: string | null) => void;
  selectRequirement: (requirementId: string | null) => void;
  selectDesign: (designId: string | null) => void;
  setCenterView: (view: CenterView) => void;
  togglePanel: (panel: PanelName) => void;
}

const EMPTY_SELECTION: Selection = {
  projectId: null,
  moduleId: null,
  requirementId: null,
  designId: null,
};

export const useRequirementsUi = create<RequirementsUiState>()((set) => ({
  selection: EMPTY_SELECTION,
  centerView: "requirements",
  panels: { navigator: true, review: true },
  selectProject: (projectId) =>
    set({ selection: { projectId, moduleId: null, requirementId: null, designId: null } }),
  selectModule: (moduleId) =>
    set((state) => ({
      selection: { ...state.selection, moduleId, requirementId: null, designId: null },
    })),
  selectRequirement: (requirementId) =>
    set((state) => ({
      selection: { ...state.selection, requirementId, designId: null },
    })),
  selectDesign: (designId) =>
    set((state) => ({
      selection: { ...state.selection, designId, requirementId: null },
    })),
  setCenterView: (centerView) => set({ centerView }),
  togglePanel: (panel) =>
    set((state) => ({ panels: { ...state.panels, [panel]: !state.panels[panel] } })),
}));
