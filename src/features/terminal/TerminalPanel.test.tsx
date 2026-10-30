// @vitest-environment jsdom
// Tabs/side-by-side acceptance with a real DOM: structure, visibility,
// no remounts, single output and per-session controls. xterm and Tauri
// are local doubles (the logic under test is the React wiring, not them).
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  sessions: [] as Array<{
    id: string;
    shell: string;
    cwd: string;
    cols: number;
    rows: number;
    running: boolean;
    exitCode: number | null;
  }>,
  calls: [] as Array<{ cmd: string; args?: unknown }>,
  next: 1,
}));

const events = vi.hoisted(() => ({
  handlers: new Map<string, Set<(payload: unknown) => void>>(),
  listens: 0,
}));

function emit(name: string, payload: unknown) {
  events.handlers.get(name)?.forEach((run) => run(payload));
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, Record<string, unknown>>) => {
    backend.calls.push({ cmd, args });
    if (cmd === "term_list") return [...backend.sessions];
    if (cmd === "term_create") {
      const input = (args?.input ?? {}) as { cwd?: string | null; cols: number; rows: number };
      const info = {
        id: `term-${backend.next}`,
        shell: "/bin/sh",
        cwd: "/home/u",
        cols: input.cols,
        rows: input.rows,
        running: true,
        exitCode: null,
      };
      backend.next += 1;
      backend.sessions.push(info);
      return info;
    }
    if (cmd === "term_write") {
      const input = (args?.input ?? {}) as { id: string; data: string };
      emit("ruth-terminal-output", { id: input.id, data: input.data });
      return null;
    }
    if (cmd === "term_resize") {
      const input = (args?.input ?? {}) as { id: string; cols: number; rows: number };
      const found = backend.sessions.find((s) => s.id === input.id);
      if (!found) throw { kind: "unknown_session", message: "no existe" };
      found.cols = input.cols;
      found.rows = input.rows;
      return { ...found };
    }
    if (cmd === "term_close") {
      const input = (args?.input ?? {}) as { id: string };
      backend.sessions = backend.sessions.filter((s) => s.id !== input.id);
      return null;
    }
    throw { kind: "unknown", message: `comando ${cmd} no simulado` };
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    events.listens += 1;
    let set = events.handlers.get(name);
    if (!set) {
      set = new Set();
      events.handlers.set(name, set);
    }
    const wrapped = (payload: unknown) => cb({ payload });
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

const xtermDims = vi.hoisted(() => ({ cols: 80, rows: 24 }));

interface FakeTerminalShape {
  marker: HTMLElement | null;
  text: string;
  disposed: boolean;
  cols: number;
  rows: number;
  onDataCb: ((data: string) => void) | null;
  open(el: HTMLElement): void;
  write(data: string): void;
  clear(): void;
  onData(cb: (data: string) => void): { dispose(): void };
  resize(cols: number, rows: number): void;
  focus(): void;
  dispose(): void;
}

const fakeXterm = vi.hoisted(() => {
  const instances: FakeTerminalShape[] = [];
  class Terminal implements FakeTerminalShape {
    marker: HTMLElement | null = null;
    text = "";
    disposed = false;
    cols = 80;
    rows = 24;
    onDataCb: ((data: string) => void) | null = null;
    constructor(public options: unknown) {
      instances.push(this);
    }
    loadAddon(_addon: unknown) {}
    open(el: HTMLElement) {
      const marker = document.createElement("div");
      marker.className = "fake-xterm";
      el.appendChild(marker);
      this.marker = marker;
      this.render();
    }
    write(data: string) {
      this.text += data;
      this.render();
    }
    clear() {
      this.text = "";
      this.render();
    }
    render() {
      if (this.marker) this.marker.textContent = this.text;
    }
    onData(cb: (data: string) => void) {
      this.onDataCb = cb;
      return { dispose() {} };
    }
    attachCustomKeyEventHandler(_handler: unknown) {}
    resize(cols: number, rows: number) {
      this.cols = cols;
      this.rows = rows;
    }
    focus() {}
    getSelection() {
      return "";
    }
    dispose() {
      this.disposed = true;
      this.marker?.remove();
      this.marker = null;
    }
  }
  return { Terminal, instances };
});

function liveTerminals(): FakeTerminalShape[] {
  return fakeXterm.instances.filter((t) => !t.disposed);
}

function terminalFor(id: string): FakeTerminalShape {
  const found = liveTerminals().find((t) =>
    t.marker?.closest(".terminal-view")?.getAttribute("aria-label")?.includes(id),
  );
  if (!found) throw new Error(`no live view for ${id}`);
  return found;
}

vi.mock("@xterm/xterm", () => ({ Terminal: fakeXterm.Terminal }));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
    proposeDimensions() {
      return { cols: xtermDims.cols, rows: xtermDims.rows };
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const observers: Array<{ cb: () => void }> = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(cb: () => void) {
      observers.push({ cb });
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
  cb();
  return 0;
});
vi.stubGlobal("cancelAnimationFrame", () => {});

import { TerminalPanel } from "./TerminalPanel";
import { useRequirementsUi } from "../requirements/uiStore";

beforeEach(() => {
  backend.sessions = [];
  backend.calls = [];
  backend.next = 1;
  events.handlers.clear();
  events.listens = 0;
  fakeXterm.instances.length = 0;
  observers.length = 0;
  xtermDims.cols = 80;
  xtermDims.rows = 24;
  useRequirementsUi.getState().setTerminalMaximized(false);
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});

function renderPanel(onHide = vi.fn()) {
  return render(
    <StrictMode>
      <TerminalPanel visible onHide={onHide} />
    </StrictMode>,
  );
}

async function createSession(expected: number) {
  fireEvent.click(screen.getByRole("button", { name: "New terminal" }));
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(expected));
  await waitFor(() => expect(liveTerminals()).toHaveLength(expected));
}

describe("terminals: tabs and side by side", () => {
  it("mounts a single subscription per event even when dev mounts twice", async () => {
    renderPanel();
    // `listen` runs on every mount (6), but the collector unsubscribes the
    // first set: exactly one live listener per event remains.
    await waitFor(() => expect(events.listens).toBe(6));
    expect(events.handlers.get("ruth-terminal-output")?.size).toBe(1);
    expect(events.handlers.get("ruth-terminal-exit")?.size).toBe(1);
    expect(events.handlers.get("ruth-terminal-close-requested")?.size).toBe(1);
  });

  it("creates two sessions with a single strip and a single viewport", async () => {
    const { container } = renderPanel();
    await createSession(1);
    await createSession(2);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // No duplicated pane headers in tabs mode.
    expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(0);
    // One wrapper visible at full width and one hidden.
    const wraps = Array.from(container.querySelectorAll(".terminal-pane-wrap"));
    expect(wraps).toHaveLength(2);
    expect(wraps.filter((w) => (w as HTMLElement).hidden)).toHaveLength(1);
    const shown = wraps.find((w) => !(w as HTMLElement).hidden) as HTMLElement;
    expect(shown.style.flex).toBe("1 1 auto");
    // Two live views (one hidden): nothing unmounts.
    expect(liveTerminals()).toHaveLength(2);
  });

  it("switches tabs with independent, single output", async () => {
    renderPanel();
    await createSession(1);
    await createSession(2);
    emit("ruth-terminal-output", { id: "term-1", data: "AAA" });
    emit("ruth-terminal-output", { id: "term-2", data: "BBB" });
    expect(terminalFor("term-1").text).toBe("AAA");
    expect(terminalFor("term-2").text).toBe("BBB");
    fireEvent.click(screen.getByRole("tab", { name: /term-1/ }));
    const views = document.querySelectorAll(".terminal-view");
    const shown = Array.from(views).filter((v) => !(v as HTMLElement).hidden);
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute("aria-label")).toContain("term-1");
    expect(terminalFor("term-1").text).toBe("AAA");
    expect(terminalFor("term-2").text).toBe("BBB");
  });

  it("toggles to side by side and back without remounting or duplicating", async () => {
    const { container } = renderPanel();
    await createSession(1);
    await createSession(2);
    emit("ruth-terminal-output", { id: "term-1", data: "AAA" });
    const mounts = fakeXterm.instances.length;
    const toggle = screen.getByRole("button", { name: "View side by side" });
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole("button", { name: "View side by side" }));
      expect(container.querySelectorAll(".terminal-sep")).toHaveLength(1);
      expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(2);
      expect(container.querySelectorAll(".terminal-pane-wrap[hidden]")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "View as tabs" }));
      expect(container.querySelectorAll(".terminal-sep")).toHaveLength(0);
      expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(0);
      expect(container.querySelectorAll(".terminal-pane-wrap[hidden]")).toHaveLength(1);
    }
    expect(toggle).toBeDefined();
    // No remounts: same instances, same text exactly once.
    expect(fakeXterm.instances.length).toBe(mounts);
    expect(liveTerminals()).toHaveLength(2);
    expect(terminalFor("term-1").text).toBe("AAA");
    // Toggling creates no PTYs and resubscribes nothing (the initial
    // double mount's 6 remain, with a single live listener per event).
    expect(backend.calls.filter((c) => c.cmd === "term_create")).toHaveLength(2);
    expect(events.listens).toBe(6);
    expect(events.handlers.get("ruth-terminal-output")?.size).toBe(1);
  });

  it("clears one session without touching the other or the PTY", async () => {
    renderPanel();
    await createSession(1);
    await createSession(2);
    emit("ruth-terminal-output", { id: "term-1", data: "AAA" });
    emit("ruth-terminal-output", { id: "term-2", data: "BBB" });
    fireEvent.click(screen.getByRole("button", { name: "Clear term-1 view" }));
    expect(terminalFor("term-1").text).toBe("");
    expect(terminalFor("term-2").text).toBe("BBB");
    expect(backend.calls.some((c) => c.cmd === "term_write")).toBe(false);
  });

  it("resizes every PTY to its real size, never zero", async () => {
    renderPanel();
    await createSession(1);
    xtermDims.cols = 100;
    xtermDims.rows = 30;
    for (const ro of observers) ro.cb();
    // After the debounce, the last notice carries the measured size.
    await waitFor(() => {
      const sizes = backend.calls
        .filter((c) => c.cmd === "term_resize")
        .map((c) => (c.args as { input: { id: string; cols: number; rows: number } }).input);
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        expect(size.cols).toBeGreaterThanOrEqual(2);
        expect(size.rows).toBeGreaterThanOrEqual(1);
      }
      expect(sizes[sizes.length - 1]).toEqual({ id: "term-1", cols: 100, rows: 30 });
    });
  });

  it("Ctrl+C travels to the PTY untouched", async () => {
    renderPanel();
    await createSession(1);
    terminalFor("term-1").onDataCb?.("\x03");
    await waitFor(() => {
      expect(
        backend.calls.some(
          (c) =>
            c.cmd === "term_write" &&
            (c.args as { input: { id: string; data: string } }).input.data === "\x03",
        ),
      ).toBe(true);
    });
  });

  it("closes with confirmation and keeps the other session", async () => {
    renderPanel();
    await createSession(1);
    await createSession(2);
    fireEvent.click(screen.getByRole("button", { name: "Close term-1" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Close term-1" });
    // Cancelling does not close.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Confirming closes and activates the remaining one.
    fireEvent.click(screen.getByRole("button", { name: "Close term-1" }));
    const dialog2 = await screen.findByRole("alertdialog", { name: "Close term-1" });
    fireEvent.click(within(dialog2).getByRole("button", { name: "Close session" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(backend.calls.some((c) => c.cmd === "term_close")).toBe(true);
    expect(screen.getByRole("tab", { name: /term-2/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("hiding notifies the container without closing sessions", async () => {
    const onHide = vi.fn();
    renderPanel(onHide);
    await createSession(1);
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal panel" }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(backend.calls.some((c) => c.cmd === "term_close")).toBe(false);
  });
});

describe("terminal: keyboard resizing", () => {
  it("arrows adjust the height and Home restores the default", async () => {
    useRequirementsUi.setState({ terminalHeight: null });
    renderPanel();
    await createSession(1);
    const handle = screen.getByRole("separator", { name: "Terminal panel height" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(useRequirementsUi.getState().terminalHeight).toBe(276);
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(useRequirementsUi.getState().terminalHeight).toBe(260);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(useRequirementsUi.getState().terminalHeight).toBeNull();
    useRequirementsUi.setState({ terminalHeight: null });
  });

  it("arrows split side-by-side panes and Home evens them", async () => {
    useRequirementsUi.setState({ terminalPaneWidths: null });
    const { container } = renderPanel();
    await createSession(1);
    await createSession(2);
    fireEvent.click(screen.getByRole("button", { name: "View side by side" }));
    const sep = await screen.findByRole("separator", { name: /Width between term-1 and term-2/ });
    // jsdom computes no widths: the container is faked.
    const panes = container.querySelector(".terminal-panes") as HTMLElement;
    Object.defineProperty(panes, "getBoundingClientRect", {
      value: () => ({ width: 1000, height: 400, top: 0, left: 0, right: 1000, bottom: 400 }),
      configurable: true,
    });
    fireEvent.keyDown(sep, { key: "ArrowRight" });
    const widths = useRequirementsUi.getState().terminalPaneWidths;
    expect(widths).not.toBeNull();
    expect(widths?.[0]).toBeGreaterThan(0.5);
    fireEvent.keyDown(sep, { key: "Home" });
    expect(useRequirementsUi.getState().terminalPaneWidths).toBeNull();
  });
});

describe("terminal: maximize and restore", () => {
  it("maximizes with the button and restores with it", () => {
    const { container } = renderPanel();
    const panel = container.querySelector(".terminal-panel") as HTMLElement;
    expect(panel.classList.contains("maximized")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal panel" }));
    expect(useRequirementsUi.getState().terminalMaximized).toBe(true);
    expect(panel.classList.contains("maximized")).toBe(true);
    // Maximized, flex rules: no inline height.
    expect(panel.getAttribute("style") ?? "").not.toContain("height");
    fireEvent.click(screen.getByRole("button", { name: "Restore terminal panel" }));
    expect(useRequirementsUi.getState().terminalMaximized).toBe(false);
    expect(panel.classList.contains("maximized")).toBe(false);
    // Restoring brings the height back (viewport-clamped).
    expect(panel.getAttribute("style") ?? "").toContain("min(");
  });

  it("hiding exits maximized without touching sessions", async () => {
    const onHide = vi.fn();
    renderPanel(onHide);
    await createSession(1);
    fireEvent.click(screen.getByRole("button", { name: "Maximize terminal panel" }));
    expect(useRequirementsUi.getState().terminalMaximized).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide terminal panel" }));
    expect(useRequirementsUi.getState().terminalMaximized).toBe(false);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("tab")).toHaveLength(1);
  });
});
