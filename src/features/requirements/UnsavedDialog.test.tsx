// @vitest-environment jsdom
// Unsaved-changes dialog: save/discard/cancel, authorship only when a
// new version is coming, busy and error visible.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UnsavedDialog } from "./UnsavedDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDialog(overrides: {
  layoutOnly?: boolean;
  busy?: boolean;
  error?: string | null;
  author?: string;
} = {}) {
  const onAuthorChange = vi.fn();
  const onSave = vi.fn();
  const onDiscard = vi.fn();
  const onCancel = vi.fn();
  render(
    <UnsavedDialog
      subject="requirement req-1"
      layoutOnly={overrides.layoutOnly ?? false}
      author={overrides.author ?? ""}
      busy={overrides.busy ?? false}
      error={overrides.error ?? null}
      onAuthorChange={onAuthorChange}
      onSave={onSave}
      onDiscard={onDiscard}
      onCancel={onCancel}
    />,
  );
  return { onAuthorChange, onSave, onDiscard, onCancel };
}

describe("UnsavedDialog", () => {
  it("all three actions reach their handler", () => {
    const { onSave, onDiscard, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks authorship only when a new version is coming", () => {
    renderDialog();
    const author = screen.getByPlaceholderText("Your name");
    fireEvent.change(author, { target: { value: "ana" } });
    expect(screen.getByText(/as a new version/)).toBeTruthy();
    cleanup();
    renderDialog({ layoutOnly: true });
    expect(screen.queryByPlaceholderText("Your name")).toBeNull();
    expect(screen.getByText(/layout changes/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save layout and continue" }),
    ).toBeTruthy();
  });

  it("busy disables and shows the error", () => {
    renderDialog({ busy: true, error: "saving failed" });
    for (const name of ["Saving…", "Discard", "Cancel"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("saving failed")).toBeTruthy();
  });
});
