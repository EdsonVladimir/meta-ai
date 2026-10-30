// @vitest-environment jsdom
// Rename dialog: confirms trimmed, validates empty and length, Enter
// saves, Escape cancels, authorship is only required for
// requirement/design, and busy blocks everything.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RenameDialog } from "./RenameDialog";
import type { RenameTarget } from "./names";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PROJECT: RenameTarget = {
  kind: "project",
  projectId: "proy-1",
  current: "Store",
  expected: "Store",
};

const REQUIREMENT: RenameTarget = {
  kind: "requirement",
  projectId: "proy-1",
  moduleId: "mod-1",
  artifactId: "req-1",
  current: "",
  expected: null,
  derived: "Confirm sale",
};

function renderDialog(
  args: {
    target?: RenameTarget;
    busy?: boolean;
    error?: string | null;
    author?: string;
  } = {},
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <RenameDialog
      target={args.target ?? PROJECT}
      busy={args.busy ?? false}
      error={args.error ?? null}
      author={args.author ?? ""}
      onConfirm={onConfirm}
      onClose={onClose}
    />,
  );
  return { onConfirm, onClose };
}

function nameInput(): HTMLInputElement {
  return screen.getByLabelText("Name") as HTMLInputElement;
}

describe("RenameDialog", () => {
  it("confirms the trimmed name", () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(nameInput(), { target: { value: "  Store 2  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith("Store 2", "");
  });

  it("empty or too long blocks with a warning", () => {
    renderDialog();
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    fireEvent.change(nameInput(), { target: { value: "   " } });
    expect(save().disabled).toBe(true);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(nameInput(), { target: { value: "x".repeat(200) } });
    expect(save().disabled).toBe(true);
  });

  it("Enter saves and Escape cancels", () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.keyDown(nameInput(), { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledWith("Store", "");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("on requirements requires authorship and explains the derived title", () => {
    const { onConfirm } = renderDialog({ target: REQUIREMENT });
    expect(screen.getByText(/first line/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Charge" } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Your name"), { target: { value: "ana" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onConfirm).toHaveBeenCalledWith("Charge", "ana");
  });

  it("busy blocks and shows the Rust error", () => {
    const { onConfirm, onClose } = renderDialog({ busy: true, error: "name in use" });
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("name in use")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
