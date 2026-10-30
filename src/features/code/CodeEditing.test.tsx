// @vitest-environment jsdom
// Safe editing and saving: drafts, saving, errors, conflicts and
// confirmations. Monaco and Tauri are local doubles.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  roots: [{ id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null }],
  dirs: {
    "root-1::": [{ name: "main.ts", rel: "main.ts", kind: "file", size: 2 }],
  } as Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>>,
  files: {} as Record<string, { text: string; fingerprint: string; size: number }>,
  writes: [] as Array<Record<string, unknown>>,
  failNext: null as null | { kind: string; message: string },
  seq: 0,
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
    if (cmd === "code_remove_root") {
      const input = (args?.input ?? {}) as { rootId: string };
      backend.roots = backend.roots.filter((root) => root.id !== input.rootId);
      return { id: input.rootId, path: "", name: "", missing: false, projectId: null };
    }
    if (cmd === "code_write_file") {
      const input = (args?.input ?? {}) as Record<string, unknown>;
      backend.writes.push({ ...input });
      if (backend.failNext !== null) {
        const err = backend.failNext;
        backend.failNext = null;
        throw err;
      }
      const key = `${input.rootId}::${input.rel}`;
      const current = backend.files[key];
      if (input.force !== true && current.fingerprint !== input.expectedFingerprint) {
        throw { kind: "code_conflict", message: "Changed on disk" };
      }
      backend.seq += 1;
      const next = {
        text: input.content as string,
        fingerprint: `f${backend.seq}`,
        size: (input.content as string).length,
      };
      backend.files[key] = next;
      return { fingerprint: next.fingerprint, size: next.size };
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

import { CodeWorkspace, type CodeSaveApi } from "./CodeWorkspace";
import { createMonacoFake } from "./monacoFake";
import type { DocSaveState } from "../requirements/uiStore";

let fake: ReturnType<typeof createMonacoFake>;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  backend.roots = [{ id: "root-1", path: "/tmp/fe", name: "frontend", missing: false, projectId: null }];
  backend.files = { "root-1::main.ts": { text: "one", fingerprint: "f0", size: 3 } };
  backend.writes = [];
  backend.failNext = null;
  backend.seq = 0;
  fake = createMonacoFake();
});

async function openFile() {
  const saveApiRef: { current: CodeSaveApi | null } = { current: null };
  const docStatus: Array<Record<string, DocSaveState>> = [];
  render(
    <CodeWorkspace
      loader={fake.loader}
      saveApiRef={saveApiRef as React.MutableRefObject<CodeSaveApi | null>}
      onDocStatus={(next) => docStatus.push(next)}
    />,
  );
  expect(await screen.findByText("frontend")).toBeDefined();
  const tree = screen.getByRole("list", { name: "Workspace folders" });
  fireEvent.click(within(tree).getByRole("button", { name: "Expand frontend" }));
  expect(await within(tree).findByText("main.ts")).toBeDefined();
  fireEvent.click(within(tree).getByText("main.ts"));
  await screen.findByLabelText("Code editor");
  await waitFor(() => expect(fake.hasModel("root-1::main.ts")).toBe(true));
  return { saveApiRef, docStatus };
}

describe("editing and saving", () => {
  it("editing marks a draft and saving clears it with its fingerprint", async () => {
    const { saveApiRef, docStatus } = await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "one two");
    });
    expect(screen.getByRole("tab", { name: /unsaved changes/ })).toBeDefined();
    let ok = false;
    await act(async () => {
      ok = await saveApiRef.current!.saveActive();
    });
    expect(ok).toBe(true);
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0]).toMatchObject({
      rootId: "root-1",
      rel: "main.ts",
      expectedFingerprint: "f0",
      content: "one two",
      force: false,
    });
    expect(screen.queryByRole("tab", { name: /unsaved changes/ })).toBeNull();
    const last = docStatus[docStatus.length - 1];
    expect(last["code:root-1::main.ts"].dirty).toBe(false);
    expect(last["code:root-1::main.ts"].label).toBe("code frontend/main.ts");
  });

  it("a write failure keeps the draft and shows the error", async () => {
    const { saveApiRef } = await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "new");
    });
    backend.failNext = { kind: "code_io", message: "Disk full" };
    let ok = true;
    await act(async () => {
      ok = await saveApiRef.current!.saveActive();
    });
    expect(ok).toBe(false);
    expect(await screen.findByText("Disk full")).toBeDefined();
    expect(fake.valueOf("root-1::main.ts")).toBe("new");
    expect(screen.getByRole("tab", { name: /unsaved changes/ })).toBeDefined();
  });

  it("conflict: compare, reload and keep editing", async () => {
    const { saveApiRef } = await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "mine");
    });
    // External on-disk change.
    backend.files["root-1::main.ts"] = { text: "external", fingerprint: "fx", size: 8 };
    let ok = true;
    await act(async () => {
      ok = await saveApiRef.current!.saveActive();
    });
    expect(ok).toBe(false);
    expect(await screen.findByText("The file changed on disk")).toBeDefined();
    fireEvent.click(screen.getByText("Compare"));
    expect(
      await screen.findByRole("img", { name: /Comparison between the disk/ }),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Reload (discard draft)"));
    await waitFor(() => expect(screen.queryByText("The file changed on disk")).toBeNull());
    expect(fake.valueOf("root-1::main.ts")).toBe("external");
    expect(screen.queryByRole("tab", { name: /unsaved changes/ })).toBeNull();
    // After reloading one can edit and save with the new fingerprint.
    act(() => {
      fake.typeIn("root-1::main.ts", "external + mine");
    });
    await act(async () => {
      ok = await saveApiRef.current!.saveActive();
    });
    expect(ok).toBe(true);
    expect(backend.writes[backend.writes.length - 1]).toMatchObject({
      expectedFingerprint: "fx",
      force: false,
    });
  });

  it("conflict: replacing writes with explicit force", async () => {
    const { saveApiRef } = await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "mine");
    });
    backend.files["root-1::main.ts"] = { text: "external", fingerprint: "fx", size: 8 };
    await act(async () => {
      await saveApiRef.current!.saveActive();
    });
    expect(await screen.findByText("The file changed on disk")).toBeDefined();
    fireEvent.click(screen.getByText("Overwrite disk"));
    await waitFor(() => expect(screen.queryByText("The file changed on disk")).toBeNull());
    expect(backend.writes[backend.writes.length - 1]).toMatchObject({
      content: "mine",
      force: true,
    });
    expect(screen.queryByRole("tab", { name: /unsaved changes/ })).toBeNull();
  });

  it("closing with a draft: save, discard or cancel", async () => {
    await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "draft");
    });
    fireEvent.click(screen.getByRole("button", { name: "Close main.ts" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Close tab with changes" }),
    ).toBeDefined();
    // Cancelling keeps everything.
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog", { name: "Close tab with changes" })).toBeNull(),
    );
    expect(screen.getByRole("tab", { name: /unsaved changes/ })).toBeDefined();
    // Discarding closes without writing.
    fireEvent.click(screen.getByRole("button", { name: "Close main.ts" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Close tab with changes" }),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Discard"));
    await waitFor(() =>
      expect(screen.getByText(/Open a file from the explorer/)).toBeDefined(),
    );
    expect(backend.writes).toHaveLength(0);
  });

  it("removing a root with drafts offers saving first", async () => {
    await openFile();
    act(() => {
      fake.typeIn("root-1::main.ts", "draft");
    });
    const tree = screen.getByRole("list", { name: "Workspace folders" });
    const rootRow = within(tree).getByText("frontend").closest("li");
    const menuButton = rootRow!.querySelector('button[aria-label^="Options"]');
    fireEvent.click(menuButton!);
    fireEvent.click(screen.getByText("Remove folder from the workspace"));
    expect(await screen.findByText("Save all and remove")).toBeDefined();
    fireEvent.click(screen.getByText("Save all and remove"));
    await waitFor(() => expect(screen.queryByText("frontend")).toBeNull());
    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0]).toMatchObject({ content: "draft", force: false });
  });
});
