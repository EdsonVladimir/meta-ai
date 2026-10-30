// @vitest-environment jsdom
// Code area acceptance (stage A): roots, on-demand tree,
// deduplicated tabs, contextual terminal and folder removal.
// Tauri and the dialog are local doubles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  roots: [
    { id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null },
    { id: "root-2", path: "/tmp/be", name: "backend", missing: false, projectId: null },
  ] as Array<{ id: string; path: string; name: string; missing: boolean; projectId: string | null }>,
  dirs: {
    "root-1::": [
      { name: "src", rel: "src", kind: "dir", size: null },
      { name: "main.ts", rel: "main.ts", kind: "file", size: 10 },
    ],
    "root-2::": [{ name: "main.ts", rel: "main.ts", kind: "file", size: 12 }],
    "root-1::src": [{ name: "app.ts", rel: "src/app.ts", kind: "file", size: 8 }],
  } as Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>>,
  files: {
    "root-1::main.ts": { text: "fe", fingerprint: "f1", size: 2 },
    "root-2::main.ts": { text: "be", fingerprint: "f2", size: 2 },
    "root-1::src/app.ts": { text: "app", fingerprint: "f3", size: 3 },
  } as Record<string, { text: string; fingerprint: string; size: number }>,
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, Record<string, unknown>>) => {
    backend.calls.push(cmd);
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
    if (cmd === "code_remove_root") {
      const input = (args?.input ?? {}) as { rootId: string };
      backend.roots = backend.roots.filter((root) => root.id !== input.rootId);
      return { id: input.rootId, path: "", name: "", missing: false, projectId: null };
    }
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

// The real loader imports the worker with `?worker` (Vite only): here
// each test injects its double through the `loader` prop.
vi.mock("./monacoLoader", () => ({
  loadMonaco: () => Promise.reject(new Error("no monaco in tests")),
}));

import { CodeWorkspace } from "./CodeWorkspace";
import { useRequirementsUi } from "../requirements/uiStore";
import { createMonacoFake } from "./monacoFake";

let fake: ReturnType<typeof createMonacoFake>;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  backend.roots = [
    { id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null },
    { id: "root-2", path: "/tmp/be", name: "backend", missing: false, projectId: null },
  ];
  backend.calls = [];
  fake = createMonacoFake();
  useRequirementsUi.getState().setCenterView("overview");
});

describe("CodeWorkspace", () => {
  it("lists roots and expands on demand", async () => {
    render(<CodeWorkspace loader={fake.loader} />);
    expect(await screen.findByText("frontend")).toBeDefined();
    expect(screen.getByText("backend")).toBeDefined();
    // Nothing listed until expanded (the background manifest scan aside).
    expect(screen.queryByText("main.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand frontend" }));
    expect(await screen.findByText("main.ts")).toBeDefined();
    expect(screen.getByText("src")).toBeDefined();
  });

  it("opens tabs without duplicating and disambiguates names", async () => {
    render(<CodeWorkspace loader={fake.loader} />);
    expect(await screen.findByText("frontend")).toBeDefined();
    const tree = screen.getByRole("list", { name: "Workspace folders" });
    fireEvent.click(within(tree).getByRole("button", { name: "Expand frontend" }));
    expect(await within(tree).findByText("main.ts")).toBeDefined();
    fireEvent.click(within(tree).getAllByText("main.ts")[0]);
    await screen.findByLabelText("Code editor");
    expect(fake.valueOf("root-1::main.ts")).toBe("fe");
    // Reopening does not duplicate.
    fireEvent.click(within(tree).getAllByText("main.ts")[0]);
    const tabs = screen.getByRole("tablist", { name: "Open files" });
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(1);
    // The same name on another root: another tab with its root visible.
    fireEvent.click(within(tree).getByRole("button", { name: "Expand backend" }));
    await waitFor(() => expect(within(tree).getAllByText("main.ts")).toHaveLength(2));
    fireEvent.click(within(tree).getAllByText("main.ts")[1]);
    await waitFor(() => expect(fake.hasModel("root-2::main.ts")).toBe(true));
    expect(fake.valueOf("root-2::main.ts")).toBe("be");
    expect(tabs.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect(within(tabs).getByText(/frontend/)).toBeDefined();
    expect(within(tabs).getByText(/backend/)).toBeDefined();
  });

  it("requests a terminal in the file folder", async () => {
    render(<CodeWorkspace loader={fake.loader} />);
    expect(await screen.findByText("frontend")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Expand frontend" }));
    expect(await screen.findByText("src")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Expand src" }));
    expect(await screen.findByText("app.ts")).toBeDefined();
    const row = screen.getByText("app.ts").closest("li");
    expect(row).not.toBeNull();
    const menuButton = row!.querySelector('button[aria-label^="Options"]');
    expect(menuButton).not.toBeNull();
    fireEvent.click(menuButton!);
    fireEvent.click(screen.getByText("Open terminal here"));
    const request = useRequirementsUi.getState().terminalRequest;
    expect(request?.cwd).toBe("/tmp/fe/src");
    expect(useRequirementsUi.getState().panels.terminal).toBe(true);
  });

  it("removing a root closes its tabs without deleting anything", async () => {
    render(<CodeWorkspace loader={fake.loader} />);
    expect(await screen.findByText("frontend")).toBeDefined();
    const tree = screen.getByRole("list", { name: "Workspace folders" });
    fireEvent.click(within(tree).getByRole("button", { name: "Expand frontend" }));
    expect(await within(tree).findByText("main.ts")).toBeDefined();
    fireEvent.click(within(tree).getByText("main.ts"));
    await screen.findByLabelText("Code editor");
    const rootRow = within(tree).getByText("frontend").closest("li");
    const menuButton = rootRow!.querySelector('button[aria-label^="Options"]');
    fireEvent.click(menuButton!);
    fireEvent.click(screen.getByText("Remove folder from the workspace"));
    expect(screen.getByText(/No file is deleted/)).toBeDefined();
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(screen.queryByText("frontend")).toBeNull());
    expect(screen.getByText(/Open a file from the explorer/)).toBeDefined();
  });
});
