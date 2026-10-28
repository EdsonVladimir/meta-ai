import { beforeEach, describe, expect, it } from "vitest";
import { useRequirementsUi } from "./uiStore";

beforeEach(() => {
  useRequirementsUi.setState({
    panels: { navigator: true, review: true, terminal: false, assistant: true },
    rightTab: "review",
    rightWidth: null,
    docStatus: {},
    saveAllSignal: 0,
    saveAllResult: null,
  });
});

describe("paneles y guardado compartido", () => {
  it("abre y oculta paneles sin tocar a los demás", () => {
    const ui = useRequirementsUi.getState();
    ui.togglePanel("terminal");
    expect(useRequirementsUi.getState().panels.terminal).toBe(true);
    ui.togglePanel("assistant");
    const panels = useRequirementsUi.getState().panels;
    expect(panels).toEqual({ navigator: true, review: true, terminal: true, assistant: false });
  });

  it("cambia la pestaña derecha y su ancho", () => {
    const ui = useRequirementsUi.getState();
    ui.setRightTab("assistant");
    ui.setRightWidth(400);
    expect(useRequirementsUi.getState().rightTab).toBe("assistant");
    expect(useRequirementsUi.getState().rightWidth).toBe(400);
    ui.setRightWidth(null);
    expect(useRequirementsUi.getState().rightWidth).toBeNull();
  });

  it("publica estado por documento y resuelve guardar-todo", () => {
    const ui = useRequirementsUi.getState();
    ui.setDocStatus({
      "req:r1": { label: "requisito r1", dirty: true, saving: false, error: null },
    });
    expect(useRequirementsUi.getState().docStatus["req:r1"]?.dirty).toBe(true);
    ui.requestSaveAll();
    expect(useRequirementsUi.getState().saveAllSignal).toBe(1);
    ui.resolveSaveAll({ ok: true, message: "Todo guardado.", at: 1 });
    expect(useRequirementsUi.getState().saveAllResult?.ok).toBe(true);
  });
});
