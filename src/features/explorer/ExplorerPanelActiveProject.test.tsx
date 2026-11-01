// @vitest-environment jsdom
// The Projects panel lists only the active project, with its modules,
// requirements, designs and mockups. Every other project is reached
// from Recents on the Welcome screen.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EMPTY_SELECTION, useRequirementsUi } from "../requirements/uiStore";
import { CodeWorkspaceProvider } from "../code/useCodeWorkspace";
import { ExplorerPanel } from "./ExplorerPanel";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "core_list_projects") {
      return [
        { id: "proy-1", name: "Shop" },
        { id: "proy-2", name: "Blog" },
      ];
    }
    if (cmd === "core_list_modules") return [];
    if (cmd === "code_project_links") return { moduleLinks: [], artifactLinks: [] };
    if (cmd === "code_list_roots") return [];
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));
vi.mock("../../lib/env", () => ({ isTauriEnvironment: () => true }));

function renderPanel(projectId: string | null) {
  const noop = () => {};
  render(
    <CodeWorkspaceProvider>
      <ExplorerPanel
        storageReady
        selection={{ ...EMPTY_SELECTION, projectId }}
        refreshToken={0}
        busy={false}
        globalError={null}
        meta={{}}
        hidden={false}
        onSelectProject={noop}
        onSelectModule={noop}
        onSelectRequirement={noop}
        onSelectDesign={noop}
        onSelectMockup={noop}
        onSelectScreen={noop}
        onCreateProject={noop}
        onCreateModule={noop}
        onNewRequirement={noop}
        onProposeRequirements={noop}
        onNewMockup={noop}
        onSelectedModuleData={noop}
        onSelectedGraph={noop}
        onArchiveAction={noop}
        onRename={noop}
      />
    </CodeWorkspaceProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useRequirementsUi.setState({ selection: { ...EMPTY_SELECTION } });
});

describe("ExplorerPanel under one active project", () => {
  it("lists only the active project", async () => {
    renderPanel("proy-1");
    await screen.findByText("Shop");
    expect(screen.queryByText("Blog")).toBeNull();
  });

  it("keeps Create project and Create from a code folder available", async () => {
    const onCreateProject = vi.fn();
    const onCreateProjectFromFolder = vi.fn();
    const noop = () => {};
    render(
      <CodeWorkspaceProvider>
        <ExplorerPanel
          storageReady
          selection={{ ...EMPTY_SELECTION, projectId: "proy-1" }}
          refreshToken={0}
          busy={false}
          globalError={null}
          meta={{}}
          hidden={false}
          onSelectProject={noop}
          onSelectModule={noop}
          onSelectRequirement={noop}
          onSelectDesign={noop}
          onSelectMockup={noop}
          onSelectScreen={noop}
          onCreateProject={onCreateProject}
          onCreateProjectFromFolder={onCreateProjectFromFolder}
          onCreateModule={noop}
          onNewRequirement={noop}
          onProposeRequirements={noop}
          onNewMockup={noop}
          onSelectedModuleData={noop}
          onSelectedGraph={noop}
          onArchiveAction={noop}
          onRename={noop}
        />
      </CodeWorkspaceProvider>,
    );
    await screen.findByText("Shop");
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Create a project from a code folder" }),
    ).toBeTruthy();
  });
});
