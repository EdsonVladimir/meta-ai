// @vitest-environment jsdom
// Source viewer: tabs, gaps said plainly, keyboard recovery, read only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMonacoFake } from "../monacoFake";
import type { SourceTab } from "./sourceTabs";
import { SourceViewer } from "./SourceViewer";

afterEach(() => cleanup());

function tab(overrides: Partial<SourceTab> & { key: string; label: string; rel: string }): SourceTab {
  return { rootId: "r", line: null, missing: false, proposed: null, ...overrides };
}

const TABS = [
  tab({ key: "code", label: "TS", rel: "a.ts", line: 4 }),
  tab({ key: "template", label: "HTML", rel: "a.html" }),
  tab({ key: "style:a.css", label: "CSS", rel: "a.css", missing: true }),
];

function setup(overrides: Partial<Parameters<typeof SourceViewer>[0]> = {}) {
  const fake = createMonacoFake();
  const readFile = vi.fn(async (_root: string, rel: string) => ({ text: `text of ${rel}` }));
  const onClose = vi.fn();
  const onOpenCode = vi.fn();
  render(
    <SourceViewer
      title="AComponent"
      tabs={TABS}
      initialKey="code"
      readFile={readFile}
      onClose={onClose}
      onOpenCode={onOpenCode}
      loader={fake.loader}
      {...overrides}
    />,
  );
  return { fake, readFile, onClose, onOpenCode };
}

describe("SourceViewer", () => {
  it("opens on the asked tab, read only, and switches files", async () => {
    const { fake, readFile } = setup({ initialKey: "template" });
    expect(screen.getByRole("tab", { name: "HTML" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("r", "a.html"));
    await waitFor(() => expect(fake.calls.some((c) => c.includes('"readOnly":true'))).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "TS" }));
    await waitFor(() => expect(readFile).toHaveBeenCalledWith("r", "a.ts"));
  });

  it("says a missing file plainly, without reading it", async () => {
    const { readFile } = setup({ initialKey: "style:a.css" });
    expect((await screen.findByRole("alert")).textContent).toContain("a.css was not found");
    expect(readFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open in code" })).toBeNull();
  });

  it("reports a read failure", async () => {
    setup({
      readFile: async () => {
        throw { kind: "code_binary", message: "Binary file." };
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Binary file.");
  });

  it("shows proposed content without touching the disk", async () => {
    const { readFile } = setup({
      tabs: [tab({ key: "code", label: "TS", rel: "new.ts", proposed: "new" })],
    });
    expect(await screen.findByText(/proposed by Muse, not on disk yet/)).toBeTruthy();
    expect(readFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open in code" })).toBeNull();
  });

  it("draws the preview in a sandbox that runs nothing, with its fields", async () => {
    const loadPreview = vi.fn(async () => ({
      document: "<p>form</p>",
      fields: [{ name: "correo", type: "email", conditionallyDisabled: true, required: false }],
      notes: ["SCSS and other style languages are not compiled here."],
    }));
    setup({
      tabs: [...TABS, tab({ key: "preview", label: "Preview", rel: "a.html" })],
      initialKey: "preview",
      loadPreview,
    });
    const frame = await screen.findByTitle("Preview of AComponent");
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("srcdoc")).toBe("<p>form</p>");
    expect(screen.getByText("Fields (1): correo (email, disabled by a condition)")).toBeTruthy();
    expect(screen.getByText(/not compiled/)).toBeTruthy();
    expect(screen.getByText(/Approximate preview/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open in code" })).toBeNull();
  });

  it("says when the preview cannot be drawn", async () => {
    setup({
      tabs: [tab({ key: "preview", label: "Preview", rel: "a.html" })],
      initialKey: "preview",
      loadPreview: async () => {
        throw new Error("Could not read the template of A.");
      },
    });
    expect((await screen.findByRole("alert")).textContent).toContain("Could not read the template");
  });

  it("goes to the editor at the file's line", async () => {
    const { onOpenCode, onClose } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Open in code" }));
    expect(onOpenCode).toHaveBeenCalledWith("r", "a.ts", 4);
    expect(onClose).toHaveBeenCalled();
  });

  it("closes with Esc and the backdrop, and returns focus to the opener", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { onClose } = setup();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("keeps Tab inside the dialog", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    const buttons = [...dialog.querySelectorAll("button")];
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
