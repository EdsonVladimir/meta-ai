// @vitest-environment jsdom
// ArchitectureView: opening the Architecture perspective mounts the
// project boards with a single working toolbar (owned by
// ProjectMapView) and never crashes on a missing toolbar contract.
// Workspace and Tauri are mocked; no disk, no network.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRequirementsUi } from "../../requirements/uiStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "code_project_links") return { moduleLinks: [], artifactLinks: [] };
    return command.includes("list") ? [] : null;
  }),
}));

vi.mock("../useCodeWorkspace", () => ({
  useCodeWorkspace: () => ({
    desktop: true,
    roots: [],
    tabs: [],
    analyzeTs: async () => {
      throw new Error("not used");
    },
    scope: [],
    setScope: () => {},
    handleAddActiveFile: () => {},
    handleAddActiveFolder: () => {},
    openFileByRef: () => {},
    notifyFileChanged: () => {},
    prefs: {},
    loader: null,
    selectedProjectId: "p1",
    selectedModuleId: null,
  }),
}));

vi.mock("../structure/StructureView", () => ({
  StructureView: () => <section aria-label="Manual scope stub" />,
  scopeKey: () => "",
}));

afterEach(() => cleanup());

describe("ArchitectureView", () => {
  it("opens with one working toolbar instead of crashing", async () => {
    useRequirementsUi.getState().setSelection({
      projectId: "p1",
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
    const { ArchitectureView } = await import("./ArchitectureView");
    render(<ArchitectureView />);
    // One search box: the toolbar is rendered once, by the boards.
    const search = screen.getAllByRole("searchbox");
    expect(search).toHaveLength(1);
    // Its controls are live (not frozen by outside props).
    fireEvent.change(search[0], { target: { value: "Sales" } });
    expect((search[0] as HTMLInputElement).value).toBe("Sales");
    // The manual scope analysis stays out of the way until asked for.
    expect(screen.queryByLabelText("Manual scope stub")).toBeNull();
  });

  it("opens the manual analysis on demand and keeps it mounted when hidden", async () => {
    const { ArchitectureView } = await import("./ArchitectureView");
    render(<ArchitectureView />);
    const toggle = screen.getByRole("button", { name: /Manual analysis/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Manual scope stub")).toBeTruthy();
    // Hiding keeps its state (selection, results): hidden, not unmounted.
    fireEvent.click(toggle);
    const panel = screen.getByLabelText("Manual scope stub", { selector: "section" });
    expect(panel.closest("[hidden]")).not.toBeNull();
  });

  it("offers Propose with Muse outside the manual panel", async () => {
    const { ArchitectureView } = await import("./ArchitectureView");
    render(<ArchitectureView />);
    expect(screen.getByRole("button", { name: "Propose with Muse" })).toBeTruthy();
  });
});
