// @vitest-environment jsdom
// Tree context menu: the project offers Delete (it reaches the handler);
// designs and mockups only offer Rename (with no individual archiving in
// the backend, nothing unbuilt is promised).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ExplorerTree } from "./ExplorerTree";
import type { FlatNode } from "./explorerModel";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function node(overrides: Partial<FlatNode>): FlatNode {
  return {
    id: "p:proy-1",
    kind: "project",
    label: "Tienda",
    secondary: "proy-1",
    title: "Tienda",
    depth: 0,
    expandable: false,
    expanded: false,
    selected: false,
    approved: null,
    artifactKind: null,
    linkKind: null,
    staleLink: false,
    archived: false,
    archivedOwn: false,
    projectId: "proy-1",
    moduleId: null,
    artifactId: null,
    screenId: null,
    loadState: null,
    count: null,
    hiddenArchived: null,
    children: [],
    ...overrides,
  };
}

function renderTree(forest: FlatNode[]) {
  const onArchiveAction = vi.fn();
  const onRename = vi.fn();
  const noop = () => {};
  render(
    <ExplorerTree
      forest={forest}
      followId={null}
      busy={false}
      onToggle={noop}
      onActivate={noop}
      onRetryProject={noop}
      onRetryModule={noop}
      onRetryGraph={noop}
      onCreateModule={noop}
      onNewRequirement={noop}
      onPropose={noop}
      onNewMockup={noop}
      onArchiveAction={onArchiveAction}
      onRename={onRename}
    />,
  );
  return { onArchiveAction, onRename };
}

function openMenu(label: string) {
  fireEvent.click(screen.getByRole("button", { name: `Actions for ${label}` }));
  return within(screen.getByRole("menu"));
}

describe("tree context menu", () => {
  it("the project offers Delete and it reaches the handler", () => {
    const { onArchiveAction } = renderTree([node({})]);
    const menu = openMenu("Tienda");
    expect(menu.getByRole("menuitem", { name: "Rename project" })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: /Archive/ })).toBeNull();
    fireEvent.click(menu.getByRole("menuitem", { name: "Delete permanently…" }));
    expect(onArchiveAction).toHaveBeenCalledTimes(1);
    const [gotNode, action] = onArchiveAction.mock.calls[0] as [FlatNode, string];
    expect(gotNode.projectId).toBe("proy-1");
    expect(action).toBe("delete");
  });

  it("designs and mockups only offer Rename", () => {
    const { onArchiveAction } = renderTree([
      node({
        id: "a:proy-1/mod-1/flujo-1",
        kind: "design",
        label: "Flujo",
        title: "Flujo",
        depth: 2,
        moduleId: "mod-1",
        artifactId: "flujo-1",
      }),
      node({
        id: "a:proy-1/mod-1/mock-1",
        kind: "mockup",
        label: "Pantallas",
        title: "Pantallas",
        depth: 2,
        moduleId: "mod-1",
        artifactId: "mock-1",
      }),
    ]);
    for (const label of ["flujo-1", "mock-1"]) {
      const menu = openMenu(label);
      expect(menu.getByRole("menuitem", { name: /Rename/ })).toBeTruthy();
      expect(menu.queryByRole("menuitem", { name: /Archive|Restore/ })).toBeNull();
      expect(menu.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });
    }
    expect(onArchiveAction).not.toHaveBeenCalled();
  });
});
