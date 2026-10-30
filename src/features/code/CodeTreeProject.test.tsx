// @vitest-environment jsdom
// Root↔project linking in the code tree: badge with the project name
// and the link/unlink menu. No backend: nothing expands, only headers
// and the menu render.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CodeTree } from "./CodeTree";
import type { CodeRootDto } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function root(overrides: Partial<CodeRootDto> = {}): CodeRootDto {
  return {
    id: "root-1",
    path: "/tmp/fe",
    name: "frontend",
    missing: false,
    projectId: null,
    ...overrides,
  };
}

function renderTree(props: {
  roots?: CodeRootDto[];
  projectNames?: Record<string, string>;
  currentProjectId?: string | null;
  currentProjectName?: string | null;
  onSetRootProject?: (root: CodeRootDto, projectId: string | null) => void;
}) {
  const onSetRootProject = props.onSetRootProject ?? vi.fn();
  render(
    <CodeTree
      roots={props.roots ?? [root({})]}
      loading={false}
      error={null}
      onRetry={() => {}}
      onAddRoot={() => {}}
      adding={false}
      onRemoveRoot={() => {}}
      onOpenFile={() => {}}
      onTerminalAt={() => {}}
      projectNames={props.projectNames}
      currentProjectId={props.currentProjectId}
      currentProjectName={props.currentProjectName}
      onSetRootProject={onSetRootProject}
    />,
  );
  return { onSetRootProject };
}

function openRootMenu(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Options for ${name}` }));
  return within(screen.getByRole("menu"));
}

describe("CodeTree association", () => {
  it("shows the linked project badge", () => {
    renderTree({
      roots: [root({ projectId: "proj-1" })],
      projectNames: { "proj-1": "Ruth" },
      currentProjectId: "proj-1",
    });
    const badge = screen.getByText("◈ Ruth");
    expect(badge.getAttribute("title")).toBe("Project: Ruth");
  });

  it("without a known name shows the id (fetch is best-effort)", () => {
    renderTree({ roots: [root({ projectId: "proj-9" })], currentProjectId: "proj-1" });
    expect(screen.getByText("◈ proj-9")).toBeDefined();
  });

  it("a loose root has no badge and offers linking to the current one", () => {
    const { onSetRootProject } = renderTree({
      currentProjectId: "proj-1",
      currentProjectName: "Ruth",
    });
    expect(screen.queryByText(/◈/)).toBeNull();
    const menu = openRootMenu("frontend");
    fireEvent.click(menu.getByRole("menuitem", { name: "Link to project: Ruth" }));
    expect(onSetRootProject).toHaveBeenCalledWith(expect.objectContaining({ id: "root-1" }), "proj-1");
  });

  it("without a selected project linking is disabled and explains why", () => {
    renderTree({ currentProjectId: null });
    const menu = openRootMenu("frontend");
    const item = menu.getByRole("menuitem", { name: /Link to project/ });
    expect(item).toHaveProperty("disabled", true);
    expect(item.getAttribute("title")).toMatch(/Select a project/);
  });

  it("a linked root offers unlinking (files are untouched)", () => {
    const { onSetRootProject } = renderTree({
      roots: [root({ projectId: "proj-1" })],
      projectNames: { "proj-1": "Ruth" },
      currentProjectId: "proj-1",
    });
    const menu = openRootMenu("frontend");
    expect(menu.queryByRole("menuitem", { name: /Link to project/ })).toBeNull();
    const item = menu.getByRole("menuitem", { name: "Unlink from project" });
    expect(item.getAttribute("title")).toMatch(/untouched/);
    fireEvent.click(item);
    expect(onSetRootProject).toHaveBeenCalledWith(expect.objectContaining({ id: "root-1" }), null);
  });
});
