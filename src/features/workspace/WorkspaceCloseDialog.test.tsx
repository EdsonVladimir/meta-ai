// @vitest-environment jsdom
// Close gate dialog: switch wording for switches, close wording
// for closes, pending Muse work reported, cancel always offered.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WorkspaceCloseDialog } from "./WorkspaceCloseDialog";

afterEach(() => cleanup());

function renderDialog(overrides: Partial<Parameters<typeof WorkspaceCloseDialog>[0]> = {}) {
  const handlers = {
    onSaveAndClose: vi.fn(),
    onCloseWithoutSaving: vi.fn(),
    onCancel: vi.fn(),
  };
  render(
    <WorkspaceCloseDialog
      mode="close"
      dirtyLabels={[]}
      terminalCount={0}
      terminalCwds={[]}
      saving={false}
      saveError={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("WorkspaceCloseDialog", () => {
  it("says Switch project with a matching button for a switch", () => {
    const handlers = renderDialog({ mode: "switch" });
    const dialog = within(screen.getByRole("alertdialog", { name: "Switch project?" }));
    expect(dialog.getByText("Switch project?")).toBeTruthy();
    fireEvent.click(dialog.getByRole("button", { name: "Switch project" }));
    expect(handlers.onCloseWithoutSaving).toHaveBeenCalledTimes(1);
  });

  it("keeps Close workspace for a real close", () => {
    renderDialog({ mode: "close" });
    const dialog = within(screen.getByRole("alertdialog", { name: "Close workspace?" }));
    expect(dialog.getByRole("button", { name: "Close workspace" })).toBeTruthy();
  });

  it("matches the dirty buttons to the mode", () => {
    renderDialog({ mode: "switch", dirtyLabels: ["Shop.md"] });
    expect(screen.getByRole("button", { name: "Save all and switch" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch without saving" })).toBeTruthy();
    cleanup();
    renderDialog({ mode: "close", dirtyLabels: ["Shop.md"] });
    expect(screen.getByRole("button", { name: "Save all and close" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close without saving" })).toBeTruthy();
  });

  it("reports pending Muse files and always offers cancel", () => {
    const handlers = renderDialog({
      mode: "switch",
      museNotice: "2 files are still pending. Closing removes these conversations.",
    });
    expect(screen.getByText(/2 files are still pending/)).toBeTruthy();
    // Nothing is saveable, so only switching away and cancelling show.
    expect(screen.queryByRole("button", { name: /Save all/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onSaveAndClose).not.toHaveBeenCalled();
    expect(handlers.onCloseWithoutSaving).not.toHaveBeenCalled();
  });
});
