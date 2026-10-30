// @vitest-environment jsdom
// The editor applies each range jump exactly once.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

afterEach(() => cleanup());

vi.mock("./monacoLoader", () => ({
  loadMonaco: () => Promise.reject(new Error("no monaco in tests")),
}));

import { CodeEditor, type EditorCursor } from "./CodeEditor";
import { DEFAULT_CODE_EDITOR_PREFS } from "./editorPrefs";
import { createMonacoFake } from "./monacoFake";

describe("CodeEditor reveal", () => {
  it("selects and centers the requested range only once", async () => {
    const fake = createMonacoFake();
    const { rerender } = render(
      <CodeEditor
        tabKey="root-1::a.ts"
        text="uno\ndos\ntres"
        language="plaintext"
        visible
        reveal={null}
        onChange={() => {}}
        loader={fake.loader}
      />,
    );
    await screen.findByLabelText("Code editor");
    await waitFor(() => expect(fake.hasModel("root-1::a.ts")).toBe(true));
    expect(fake.calls.filter((call) => call === "reveal")).toEqual([]);
    const reveal = { startLine: 2, startCol: 1, endLine: 2, endCol: 4, nonce: 1 };
    rerender(
      <CodeEditor
        tabKey="root-1::a.ts"
        text="uno\ndos\ntres"
        language="plaintext"
        visible
        reveal={reveal}
        onChange={() => {}}
        loader={fake.loader}
      />,
    );
    await waitFor(() => expect(fake.calls).toContain("reveal"));
    expect(fake.calls).toContain("focus");
    expect(fake.calls.find((call) => call.startsWith("select:"))).toContain(
      '"startLineNumber":2',
    );
    const count = fake.calls.length;
    // Repeating the same nonce does not re-apply.
    act(() => {
      rerender(
        <CodeEditor
          tabKey="root-1::a.ts"
          text="uno\ndos\ntres"
          language="plaintext"
          visible
          reveal={reveal}
          onChange={() => {}}
          loader={fake.loader}
        />,
      );
    });
    expect(fake.calls).toHaveLength(count);
  });

  it("applies the Ruth theme and the initial options", async () => {
    const fake = createMonacoFake();
    render(
      <CodeEditor
        tabKey="root-1::a.ts"
        text="uno"
        language="plaintext"
        visible
        reveal={null}
        onChange={() => {}}
        loader={fake.loader}
      />,
    );
    await screen.findByLabelText("Code editor");
    await waitFor(() => expect(fake.hasModel("root-1::a.ts")).toBe(true));
    expect(fake.calls).toContain("theme:ruth-dark");
    expect(fake.calls).toContain("set-theme:ruth-dark");
    expect(fake.calls.find((call) => call.startsWith("create:"))).toContain(
      '"theme":"ruth-dark"',
    );
  });

  it("updates options hot without recreating the editor", async () => {
    const fake = createMonacoFake();
    const { rerender } = render(
      <CodeEditor
        tabKey="root-1::a.ts"
        text="uno"
        language="plaintext"
        visible
        reveal={null}
        prefs={DEFAULT_CODE_EDITOR_PREFS}
        onChange={() => {}}
        loader={fake.loader}
      />,
    );
    await screen.findByLabelText("Code editor");
    await waitFor(() => expect(fake.hasModel("root-1::a.ts")).toBe(true));
    rerender(
      <CodeEditor
        tabKey="root-1::a.ts"
        text="uno"
        language="plaintext"
        visible
        reveal={null}
        prefs={{ ...DEFAULT_CODE_EDITOR_PREFS, minimap: true, fontSize: 15 }}
        onChange={() => {}}
        loader={fake.loader}
      />,
    );
    await waitFor(() =>
      expect(fake.calls.some((call) => call.startsWith("update:"))).toBe(true),
    );
    expect(fake.calls.filter((call) => call.startsWith("create:"))).toHaveLength(1);
    expect(fake.calls.find((call) => call.startsWith("update:"))).toContain(
      '"minimap":{"enabled":true',
    );
  });

  it("re-measures the editor on resize and frees on unmount", async () => {
    const seen: Array<() => void> = [];
    let disconnects = 0;
    const holder = globalThis as unknown as Record<string, unknown>;
    const realObserver = holder.ResizeObserver;
    holder.ResizeObserver = class {
      constructor(callback: () => void) {
        seen.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnects += 1;
      }
    };
    try {
      const fake = createMonacoFake();
      const { unmount } = render(
        <CodeEditor
          tabKey="root-1::a.ts"
          text="uno"
          language="plaintext"
          visible
          reveal={null}
          onChange={() => {}}
          loader={fake.loader}
        />,
      );
      const node = await screen.findByLabelText("Code editor");
      await waitFor(() => expect(fake.hasModel("root-1::a.ts")).toBe(true));
      await waitFor(() => expect(seen.length).toBe(1));
      // jsdom computes no sizes: zero is skipped (hidden).
      const resize = seen[0];
      act(() => {
        resize();
      });
      const layoutsHidden = fake.calls.filter((call) => call === "layout").length;
      // With a real size, the change triggers layout().
      Object.defineProperty(node, "clientWidth", { value: 800, configurable: true });
      Object.defineProperty(node, "clientHeight", { value: 600, configurable: true });
      act(() => {
        resize();
      });
      await waitFor(() =>
        expect(fake.calls.filter((call) => call === "layout").length).toBeGreaterThan(
          layoutsHidden,
        ),
      );
      unmount();
      expect(disconnects).toBe(1);
    } finally {
      if (realObserver === undefined) delete holder.ResizeObserver;
      else holder.ResizeObserver = realObserver;
    }
  });

  it("publishes the local cursor for the status bar", async () => {
    const fake = createMonacoFake();
    const cursors: EditorCursor[] = [];
    render(
      <CodeEditor
        tabKey="root-1::a.ts"
        text={"uno\ndos"}
        language="plaintext"
        visible
        reveal={null}
        onChange={() => {}}
        onCursor={(_key, cursor) => {
          cursors.push(cursor);
        }}
        loader={fake.loader}
      />,
    );
    await screen.findByLabelText("Code editor");
    await waitFor(() => expect(fake.hasModel("root-1::a.ts")).toBe(true));
    act(() => {
      fake.moveCursor(
        { lineNumber: 2, column: 2 },
        { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 3 },
      );
    });
    const last = cursors[cursors.length - 1];
    expect(last).toMatchObject({ line: 2, column: 2, selectedChars: 2, lineCount: 2 });
    expect(last?.selectionLabel).toBe("2:1–2:3");
  });
});
