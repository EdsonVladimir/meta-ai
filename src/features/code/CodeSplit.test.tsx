// @vitest-environment jsdom
// Split code composition (the one the app uses): the tree and the
// editor live in different slots but share ONE session through the
// provider. Opening from the tree paints the tab in the center.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  roots: [{ id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null }],
  dirs: {
    "root-1::": [{ name: "main.ts", rel: "main.ts", kind: "file", size: 10 }],
  } as Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>>,
  files: {
    "root-1::main.ts": { text: "hola", fingerprint: "f1", size: 4 },
  } as Record<string, { text: string; fingerprint: string; size: number }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, Record<string, unknown>>) => {
    if (cmd === "code_list_roots") return [...backend.roots];
    if (cmd === "code_list_dir") {
      const input = (args?.input ?? {}) as { rootId: string; rel: string };
      return { entries: backend.dirs[`${input.rootId}::${input.rel}`] ?? [], truncated: false };
    }
    if (cmd === "code_read_file") {
      const input = (args?.input ?? {}) as { rootId: string; rel: string };
      const file = backend.files[`${input.rootId}::${input.rel}`];
      if (file === undefined) throw { kind: "code_not_found", message: "Does not exist" };
      return file;
    }
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

vi.mock("./monacoLoader", () => ({
  loadMonaco: () => Promise.reject(new Error("no monaco in tests")),
}));

import { CodeWorkspaceProvider } from "./useCodeWorkspace";
import { CodeTreePane } from "./CodeTreePane";
import { CodeMainPane } from "./CodeMainPane";
import { useRequirementsUi } from "../requirements/uiStore";
import { createMonacoFake } from "./monacoFake";

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  useRequirementsUi.getState().setCenterView("overview");
});

describe("CodeSplit", () => {
  it("tree and center share a session in different slots", async () => {
    const fake = createMonacoFake();
    render(
      <CodeWorkspaceProvider loader={fake.loader}>
        <nav aria-label="slot-izquierdo">
          <CodeTreePane />
        </nav>
        <div aria-label="slot-central">
          <CodeMainPane bare />
        </div>
      </CodeWorkspaceProvider>,
    );
    const left = within(screen.getByRole("navigation", { name: "slot-izquierdo" }));
    const center = within(screen.getByLabelText("slot-central"));

    // The tree loads the roots in its slot…
    expect(await left.findByText("frontend")).toBeDefined();
    // …and the center starts empty in its own.
    expect(center.getByText(/Open a file from the explorer/)).toBeDefined();

    // Opening from the tree paints the tab and the editor in the center.
    fireEvent.click(left.getByRole("button", { name: "Expand frontend" }));
    expect(await left.findByText("main.ts")).toBeDefined();
    fireEvent.click(left.getByText("main.ts"));
    await waitFor(() => expect(fake.hasModel("root-1::main.ts")).toBe(true));
    expect(center.getByRole("tablist", { name: "Open files" })).toBeDefined();
    expect(center.getByRole("tab", { name: /main\.ts from frontend/ })).toBeDefined();
  });
});
