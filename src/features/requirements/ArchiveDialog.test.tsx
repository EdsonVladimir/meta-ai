// @vitest-environment jsdom
// Archive/delete dialog for projects: lists modules, shows blockers
// without offering archive (projects are never archived) and confirms
// deleting an empty, loose project.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ArchiveDialog } from "./ArchiveDialog";
import type { ArchiveAction, ArchiveTarget } from "./archive";
import type { ArchivePreviewDto } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TARGET: ArchiveTarget = { kind: "project", projectId: "proy-1" };

function preview(overrides: Partial<ArchivePreviewDto> = {}): ArchivePreviewDto {
  return {
    projectId: "proy-1",
    kind: "project",
    id: "proy-1",
    archived: false,
    contents: [],
    modules: [],
    dependents: [],
    baselines: [],
    deliveries: [],
    generations: [],
    approvals: 0,
    versions: 0,
    canDelete: true,
    deleteBlockers: [],
    ...overrides,
  };
}

function renderDialog(args: {
  action?: ArchiveAction;
  preview?: ArchivePreviewDto | null;
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const onActionChange = vi.fn();
  const onConfirm = vi.fn();
  const onRetry = vi.fn();
  const onClose = vi.fn();
  render(
    <ArchiveDialog
      target={TARGET}
      action={args.action ?? "delete"}
      preview={args.preview ?? null}
      loading={args.loading ?? false}
      busy={args.busy ?? false}
      error={args.error ?? null}
      onActionChange={onActionChange}
      onConfirm={onConfirm}
      onRetry={onRetry}
      onClose={onClose}
    />,
  );
  return { onActionChange, onConfirm, onRetry, onClose };
}

describe("ArchiveDialog for projects", () => {
  it("when blocked, lists modules and blockers without offering archive", () => {
    renderDialog({
      preview: preview({
        modules: [
          { id: "mod-1", projectId: "proy-1", name: "Sales", archived: false },
          { id: "mod-2", projectId: "proy-1", name: "Old", archived: true },
        ],
        canDelete: false,
        deleteBlockers: [
          {
            code: "delete_project_not_empty",
            message: "Project proy-1 still holds 2 module(s): delete them first, one by one.",
          },
        ],
      }),
    });
    expect(screen.getByRole("dialog", { name: /Delete project .* permanently/ })).toBeTruthy();
    expect(screen.getByText("Modules (2)")).toBeTruthy();
    expect(screen.getByText("Sales")).toBeTruthy();
    expect(screen.getByText("archived")).toBeTruthy();
    expect(screen.getByText(/still holds 2 module/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive instead" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("when empty, confirms permanent deletion", () => {
    const { onConfirm } = renderDialog({ preview: preview() });
    expect(screen.getByText("Modules (0)")).toBeTruthy();
    expect(screen.getByText("Empty project.")).toBeTruthy();
    expect(screen.getByText(/empty project, no references/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Delete/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
