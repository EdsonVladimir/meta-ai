// @vitest-environment jsdom
// Editor presentation (phase 1): breadcrumbs, status bar, persisted
// preferences, tab keyboard and tree reveal.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  roots: [{ id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null }],
  dirs: {
    "root-1::": [
      { name: "src", rel: "src", kind: "dir", size: null },
      { name: "main.ts", rel: "main.ts", kind: "file", size: 7 },
    ],
    "root-1::src": [{ name: "app.ts", rel: "src/app.ts", kind: "file", size: 3 }],
  } as Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>>,
  files: {
    "root-1::main.ts": { text: "uno\ndos", fingerprint: "f1", size: 7 },
    "root-1::src/app.ts": { text: "app", fingerprint: "f2", size: 3 },
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
      return { ...file };
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

import { CodeWorkspace } from "./CodeWorkspace";
import { createMonacoFake } from "./monacoFake";
import { CODE_EDITOR_PREFS_KEY } from "./editorPrefs";

let fake: ReturnType<typeof createMonacoFake>;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  window.localStorage.clear();
  fake = createMonacoFake();
});

async function openMain() {
  render(<CodeWorkspace loader={fake.loader} />);
  expect(await screen.findByText("frontend")).toBeDefined();
  const tree = screen.getByRole("list", { name: "Workspace folders" });
  fireEvent.click(within(tree).getByRole("button", { name: "Expand frontend" }));
  expect(await within(tree).findByText("main.ts")).toBeDefined();
  fireEvent.click(within(tree).getByText("main.ts"));
  await screen.findByLabelText("Code editor");
  await waitFor(() => expect(fake.hasModel("root-1::main.ts")).toBe(true));
  return tree;
}

describe("editor presentation", () => {
  it("shows breadcrumbs and cursor in the status bar", async () => {
    await openMain();
    const crumbs = screen.getByRole("navigation", { name: "File path" });
    expect(within(crumbs).getByText("frontend")).toBeDefined();
    expect(within(crumbs).getByText("main.ts")).toBeDefined();
    expect(screen.getByText("UTF-8")).toBeDefined();
    act(() => {
      fake.moveCursor({ lineNumber: 2, column: 3 });
    });
    expect(await screen.findByText("Ln 2, Col 3")).toBeDefined();
    expect(screen.getByText("2 lines")).toBeDefined();
  });

  it("persists preferences and applies them hot", async () => {
    await openMain();
    fireEvent.click(screen.getByText("Presentation"));
    fireEvent.click(screen.getByLabelText("Minimap"));
    await waitFor(() =>
      expect(fake.calls.some((call) => call.includes('"minimap":{"enabled":true'))).toBe(true),
    );
    expect(window.localStorage.getItem(CODE_EDITOR_PREFS_KEY)).toContain('"minimap":true');
  });

  it("arrows move the active tab", async () => {
    const tree = await openMain();
    fireEvent.click(within(tree).getByRole("button", { name: "Expand src" }));
    expect(await within(tree).findByText("app.ts")).toBeDefined();
    fireEvent.click(within(tree).getByText("app.ts"));
    await waitFor(() => expect(fake.hasModel("root-1::src/app.ts")).toBe(true));
    const tabs = screen.getByRole("tablist", { name: "Open files" });
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(2);
    fireEvent.keyDown(tabs, { key: "ArrowLeft" });
    await waitFor(() =>
      expect(
        within(tabs).getByRole("tab", { name: /main\.ts from frontend/ }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  it("breadcrumbs reveal the folder in the tree", async () => {
    const tree = await openMain();
    fireEvent.click(within(tree).getByRole("button", { name: "Expand src" }));
    expect(await within(tree).findByText("app.ts")).toBeDefined();
    fireEvent.click(within(tree).getByText("app.ts"));
    await waitFor(() => expect(fake.hasModel("root-1::src/app.ts")).toBe(true));
    // Collapse the root and return through the breadcrumbs.
    fireEvent.click(within(tree).getByRole("button", { name: "Collapse frontend" }));
    await waitFor(() => expect(within(tree).queryByText("app.ts")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Show src in the tree" }));
    expect(await within(tree).findByText("app.ts")).toBeDefined();
  });
});
