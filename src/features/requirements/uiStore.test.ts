// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  LAYOUT_STORAGE_KEY,
  useRequirementsUi,
  validateLayoutPartial,
} from "./uiStore";

beforeEach(() => {
  localStorage.clear();
  useRequirementsUi.setState({
    centerView: "welcome",
    panels: { navigator: true, review: true, terminal: false, assistant: true },
    rightTab: "review",
    rightWidth: null,
    navigatorWidth: null,
    terminalHeight: null,
    terminalPaneWidths: null,
    docStatus: {},
    saveAllSignal: 0,
    saveAllResult: null,
    mapHiddenRoots: {},
    archScope: { kind: "all" },
    mapHiddenProjects: {},
    codeFolderSelection: null,
    centerDoc: null,
    discardSignal: 0,
    terminalMaximized: false,
    archInspectorWidth: null,
    archInspectorCollapsed: false,
    layerOverrides: {},
    archExternalFolders: [],
  });
});

describe("panels and shared saving", () => {
  it("shows and hides panels without touching the others", () => {
    const ui = useRequirementsUi.getState();
    ui.togglePanel("terminal");
    expect(useRequirementsUi.getState().panels.terminal).toBe(true);
    ui.togglePanel("assistant");
    const panels = useRequirementsUi.getState().panels;
    expect(panels).toEqual({ navigator: true, review: true, terminal: true, assistant: false });
  });

  it("switches the right tab and its width", () => {
    const ui = useRequirementsUi.getState();
    ui.setRightTab("assistant");
    ui.setRightWidth(400);
    expect(useRequirementsUi.getState().rightTab).toBe("assistant");
    expect(useRequirementsUi.getState().rightWidth).toBe(400);
    ui.setRightWidth(null);
    expect(useRequirementsUi.getState().rightWidth).toBeNull();
  });

  it("publishes per-document status and resolves save-all", () => {
    const ui = useRequirementsUi.getState();
    ui.setDocStatus({
      "req:r1": { label: "requirement r1", dirty: true, saving: false, error: null },
    });
    expect(useRequirementsUi.getState().docStatus["req:r1"]?.dirty).toBe(true);
    ui.requestSaveAll();
    expect(useRequirementsUi.getState().saveAllSignal).toBe(1);
    ui.resolveSaveAll({ ok: true, message: "Todo guardado.", at: 1 });
    expect(useRequirementsUi.getState().saveAllResult?.ok).toBe(true);
  });
});

describe("workspace navigation state", () => {
  it("starts on welcome without an open document", () => {
    expect(useRequirementsUi.getState().centerView).toBe("welcome");
    expect(useRequirementsUi.getState().centerDoc).toBeNull();
  });

  it("tracks the open document independently of the view", () => {
    const ui = useRequirementsUi.getState();
    ui.setCenterView("overview");
    ui.setCenterDoc("root-1::a.ts");
    expect(useRequirementsUi.getState().centerView).toBe("overview");
    expect(useRequirementsUi.getState().centerDoc).toBe("root-1::a.ts");
    ui.setCenterDoc(null);
    expect(useRequirementsUi.getState().centerDoc).toBeNull();
  });

  it("requests discard-all and toggles terminal maximize", () => {
    const ui = useRequirementsUi.getState();
    ui.requestDiscard();
    expect(useRequirementsUi.getState().discardSignal).toBe(1);
    ui.setTerminalMaximized(true);
    expect(useRequirementsUi.getState().terminalMaximized).toBe(true);
  });

  it("resets layout sizes without touching visibility", () => {
    const ui = useRequirementsUi.getState();
    ui.setNavigatorWidth(400);
    ui.setRightWidth(400);
    ui.setTerminalHeight(400);
    ui.setTerminalPaneWidths([0.5, 0.5]);
    ui.resetLayout();
    const state = useRequirementsUi.getState();
    expect(state.navigatorWidth).toBeNull();
    expect(state.rightWidth).toBeNull();
    expect(state.terminalHeight).toBeNull();
    expect(state.terminalPaneWidths).toBeNull();
    expect(state.panels).toEqual({
      navigator: true,
      review: true,
      terminal: false,
      assistant: true,
    });
  });
});

describe("map root visibility", () => {
  it("toggles one root without touching the others", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().mapHiddenRoots).toEqual({});
    ui.toggleMapRoot("root-1");
    expect(useRequirementsUi.getState().mapHiddenRoots).toEqual({ "root-1": true });
    ui.toggleMapRoot("root-2");
    ui.toggleMapRoot("root-1");
    expect(useRequirementsUi.getState().mapHiddenRoots).toEqual({
      "root-1": false,
      "root-2": true,
    });
  });
});

describe("architecture scope and project visibility", () => {
  it("defaults to the joint view and switches scope explicitly", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
    ui.setArchScope({ kind: "project", rootId: "r1", rel: "apps/fe" });
    expect(useRequirementsUi.getState().archScope).toEqual({
      kind: "project",
      rootId: "r1",
      rel: "apps/fe",
    });
    ui.setArchScope({ kind: "folder", rootId: "r1", rel: "docs" });
    expect(useRequirementsUi.getState().archScope.kind).toBe("folder");
    ui.setArchScope({ kind: "all" });
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
  });

  it("toggles one project without touching selection or the others", () => {
    const ui = useRequirementsUi.getState();
    ui.toggleMapProject("r1::apps/fe");
    expect(useRequirementsUi.getState().mapHiddenProjects).toEqual({ "r1::apps/fe": true });
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
    ui.toggleMapProject("r1::apps/be");
    ui.toggleMapProject("r1::apps/fe");
    expect(useRequirementsUi.getState().mapHiddenProjects).toEqual({
      "r1::apps/fe": false,
      "r1::apps/be": true,
    });
  });

  it("shows every project again with one action", () => {
    const ui = useRequirementsUi.getState();
    ui.toggleMapProject("r1::apps/fe");
    ui.toggleMapProject("r1::apps/be");
    ui.showAllMapProjects();
    expect(useRequirementsUi.getState().mapHiddenProjects).toEqual({});
  });

  it("selects an explorer folder without changing the scope", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().codeFolderSelection).toBeNull();
    ui.setCodeFolderSelection({ rootId: "r1", rel: "docs" });
    expect(useRequirementsUi.getState().codeFolderSelection).toEqual({ rootId: "r1", rel: "docs" });
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
    ui.setCodeFolderSelection(null);
    expect(useRequirementsUi.getState().codeFolderSelection).toBeNull();
  });

  it("sets and clears manual symbol layers", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().layerOverrides).toEqual({});
    ui.setLayerOverride("s1", { layer: "state", name: "Billing" });
    expect(useRequirementsUi.getState().layerOverrides).toEqual({
      s1: { layer: "state", name: "Billing" },
    });
    ui.setLayerOverride("s1", null);
    expect(useRequirementsUi.getState().layerOverrides).toEqual({});
  });

  it("filters by code module without touching the project scope", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().archModule).toBeNull();
    ui.setArchModule("declared:mod:s1");
    expect(useRequirementsUi.getState().archModule).toBe("declared:mod:s1");
    expect(useRequirementsUi.getState().archScope).toEqual({ kind: "all" });
    ui.setArchModule(null);
    expect(useRequirementsUi.getState().archModule).toBeNull();
  });

  it("toggles summarized external references", () => {
    const ui = useRequirementsUi.getState();
    expect(useRequirementsUi.getState().archShowExternalRefs).toBe(false);
    ui.setArchShowExternalRefs(true);
    expect(useRequirementsUi.getState().archShowExternalRefs).toBe(true);
  });
});

describe("persisted panel sizes", () => {
  it("writes only sizes to localStorage (no domain)", () => {
    const ui = useRequirementsUi.getState();
    ui.setNavigatorWidth(300);
    ui.setRightWidth(400);
    ui.setTerminalHeight(300);
    ui.setTerminalPaneWidths([0.4, 0.6]);
    ui.toggleMapProject("r1::apps/fe");
    ui.setArchScope({ kind: "project", rootId: "r1", rel: "apps/fe" });
    ui.setArchInspectorWidth(320);
    ui.setArchInspectorCollapsed(true);
    ui.setLayerOverride("s1", { layer: "state", name: "Billing" });
    ui.setArchModule("declared:mod:s1");
    ui.setArchShowExternalRefs(true);
    ui.addArchExternalFolder({ rootId: "r1", rel: "vendor" });
    ui.setCenterView("overview");
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "{}") as { state?: Record<string, unknown> };
    expect(stored.state).toEqual({
      navigatorWidth: 300,
      rightWidth: 400,
      terminalHeight: 300,
      terminalPaneWidths: [0.4, 0.6],
      mapHiddenProjects: { "r1::apps/fe": true },
      archInspectorWidth: 320,
      layerOverrides: { s1: { layer: "state", name: "Billing" } },
      archExternalFolders: [{ rootId: "r1", rel: "vendor" }],
    });
  });

  it("keeps only valid external folders and replaces repeats", () => {
    expect(
      validateLayoutPartial({
        archExternalFolders: [{ rootId: "r", rel: "vendor" }, { rootId: "r" }, 3],
      }).archExternalFolders,
    ).toEqual([{ rootId: "r", rel: "vendor" }]);
    const ui = useRequirementsUi.getState();
    ui.addArchExternalFolder({ rootId: "r", rel: "vendor" });
    ui.addArchExternalFolder({ rootId: "r", rel: "vendor" });
    expect(useRequirementsUi.getState().archExternalFolders).toHaveLength(1);
    ui.removeArchExternalFolder({ rootId: "r", rel: "vendor" });
    expect(useRequirementsUi.getState().archExternalFolders).toEqual([]);
  });

  it("resets sizes and exits maximized terminal", () => {
    const ui = useRequirementsUi.getState();
    ui.setNavigatorWidth(300);
    ui.setRightWidth(400);
    ui.setTerminalHeight(300);
    ui.setTerminalPaneWidths([0.4, 0.6]);
    ui.setTerminalMaximized(true);
    ui.setArchInspectorWidth(320);
    ui.resetLayout();
    const next = useRequirementsUi.getState();
    expect(next.navigatorWidth).toBeNull();
    expect(next.rightWidth).toBeNull();
    expect(next.terminalHeight).toBeNull();
    expect(next.terminalPaneWidths).toBeNull();
    expect(next.terminalMaximized).toBe(false);
    expect(next.archInspectorWidth).toBeNull();
  });

  it("accepts valid values and discards corrupt or out-of-range ones", () => {
    expect(
      validateLayoutPartial({
        navigatorWidth: 300,
        rightWidth: 400,
        terminalHeight: 300,
        terminalPaneWidths: [0.5, 0.5],
        mapHiddenProjects: { "r1::apps/fe": true },
        archInspectorWidth: 320,
        layerOverrides: { s1: { layer: "state", name: "Billing" } },
      }),
    ).toEqual({
      navigatorWidth: 300,
      rightWidth: 400,
      terminalHeight: 300,
      terminalPaneWidths: [0.5, 0.5],
      mapHiddenProjects: { "r1::apps/fe": true },
      archInspectorWidth: 320,
      layerOverrides: { s1: { layer: "state", name: "Billing" } },
      archExternalFolders: [],
    });
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
    expect(validateLayoutPartial(null)).toEqual(fallback);
    expect(validateLayoutPartial("basura")).toEqual(fallback);
    expect(validateLayoutPartial([1, 2])).toEqual(fallback);
    expect(
      validateLayoutPartial({
        navigatorWidth: Number.NaN,
        rightWidth: 99999,
        terminalHeight: -5,
        terminalPaneWidths: [0.5, "x"],
        archInspectorWidth: 10,
        layerOverrides: { s1: { layer: "state" }, broken: true },
      }),
    ).toEqual(fallback);
    expect(
      validateLayoutPartial({ navigatorWidth: 300, rightWidth: null }),
    ).toEqual({ ...fallback, navigatorWidth: 300 });
  });
});
