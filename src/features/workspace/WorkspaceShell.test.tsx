// @vitest-environment jsdom
// Selector and close gate: entries, recents, explicit choices.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { WorkspaceCloseDialog } from "./WorkspaceCloseDialog";
import type { RecentWorkspaceDto } from "./types";

afterEach(() => cleanup());

const RECENTS: RecentWorkspaceDto[] = [
  {
    id: "ws-1",
    label: "Shop",
    projectId: "proy-1",
    rootPaths: ["/repo/shop"],
    missingPaths: [],
    lastOpened: "2026-10-29T10:00:00Z",
    createdAt: "2026-10-28T10:00:00Z",
  },
];

describe("WorkspaceSelector", () => {
  it("shows the current workspace and switches to recents", () => {
    const onOpenRecent = vi.fn();
    render(
      <WorkspaceSelector
        label="Shop"
        sublabel="proy-1"
        recents={RECENTS}
        busy={false}
        onOpenProject={() => {}}
        onNewProject={() => {}}
        onOpenRecent={onOpenRecent}
        onSwitchWorkspace={() => {}}
        onCloseWorkspace={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Shop/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Shop" }));
    expect(onOpenRecent).toHaveBeenCalledWith(RECENTS[0]);
  });

  it("offers entries without a workspace and hides switch/close", () => {
    const handlers = { onOpenProject: vi.fn(), onNewProject: vi.fn(), onCloseWorkspace: vi.fn() };
    render(
      <WorkspaceSelector
        label={null}
        sublabel={null}
        recents={[]}
        busy={false}
        onOpenRecent={() => {}}
        onSwitchWorkspace={() => {}}
        {...handlers}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /No workspace/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open project…" }));
    expect(handlers.onOpenProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menuitem", { name: "Close workspace" })).toBeNull();
  });
});

describe("WorkspaceCloseDialog", () => {
  it("saves or discards dirty documents explicitly", () => {
    const onSaveAndClose = vi.fn();
    const onCloseWithoutSaving = vi.fn();
    render(
      <WorkspaceCloseDialog
        dirtyLabels={["req: Login", "code: a.ts"]}
        terminalCount={2}
        terminalCwds={["/repo/a", "/repo/b"]}
        saving={false}
        saveError={null}
        onSaveAndClose={onSaveAndClose}
        onCloseWithoutSaving={onCloseWithoutSaving}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("req: Login")).toBeTruthy();
    expect(screen.getByText(/2 active terminals will keep running/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close without saving" }));
    expect(onCloseWithoutSaving).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Save all and close" }));
    expect(onSaveAndClose).toHaveBeenCalledTimes(1);
  });

  it("closes cleanly without drafts", () => {
    const onCloseWithoutSaving = vi.fn();
    render(
      <WorkspaceCloseDialog
        dirtyLabels={[]}
        terminalCount={0}
        terminalCwds={[]}
        saving={false}
        saveError={null}
        onSaveAndClose={() => {}}
        onCloseWithoutSaving={onCloseWithoutSaving}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("No unsaved changes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close workspace" }));
    expect(onCloseWithoutSaving).toHaveBeenCalledTimes(1);
  });
});
