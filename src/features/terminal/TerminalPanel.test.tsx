// @vitest-environment jsdom
// Aceptación de pestañas/paralelo con DOM real: estructura, visibilidad,
// no-remontajes, salida única y controles por sesión. xterm y Tauri son
// dobles locales (la lógica bajo prueba es el cableado React, no ellos).
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
  if (!found) throw new Error(`sin vista viva para ${id}`);
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
  fireEvent.click(screen.getByRole("button", { name: "Nueva terminal" }));
  await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(expected));
  await waitFor(() => expect(liveTerminals()).toHaveLength(expected));
}

describe("terminales: pestañas y paralelo", () => {
  it("monta una sola suscripción por evento aunque dev monte dos veces", async () => {
    renderPanel();
    // `listen` se invoca en cada montaje (6), pero el colector da de baja
    // el primer juego: queda exactamente un vivo por evento.
    await waitFor(() => expect(events.listens).toBe(6));
    expect(events.handlers.get("ruth-terminal-output")?.size).toBe(1);
    expect(events.handlers.get("ruth-terminal-exit")?.size).toBe(1);
    expect(events.handlers.get("ruth-terminal-close-requested")?.size).toBe(1);
  });

  it("crea dos sesiones con una sola tira y un solo viewport", async () => {
    const { container } = renderPanel();
    await createSession(1);
    await createSession(2);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Sin cabeceras de panel duplicadas en modo pestañas.
    expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(0);
    // Un envoltorio visible a ancho completo y otro oculto.
    const wraps = Array.from(container.querySelectorAll(".terminal-pane-wrap"));
    expect(wraps).toHaveLength(2);
    expect(wraps.filter((w) => (w as HTMLElement).hidden)).toHaveLength(1);
    const shown = wraps.find((w) => !(w as HTMLElement).hidden) as HTMLElement;
    expect(shown.style.flex).toBe("1 1 auto");
    // Dos vistas vivas (una oculta): nada se desmonta.
    expect(liveTerminals()).toHaveLength(2);
  });

  it("cambia de pestaña con salida independiente y única", async () => {
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

  it("alterna a paralelo y de vuelta sin remontar ni duplicar", async () => {
    const { container } = renderPanel();
    await createSession(1);
    await createSession(2);
    emit("ruth-terminal-output", { id: "term-1", data: "AAA" });
    const mounts = fakeXterm.instances.length;
    const toggle = screen.getByRole("button", { name: "Ver en paralelo" });
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Ver en paralelo" }));
      expect(container.querySelectorAll(".terminal-sep")).toHaveLength(1);
      expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(2);
      expect(container.querySelectorAll(".terminal-pane-wrap[hidden]")).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: "Ver en pestañas" }));
      expect(container.querySelectorAll(".terminal-sep")).toHaveLength(0);
      expect(container.querySelectorAll(".terminal-pane > .terminal-tab")).toHaveLength(0);
      expect(container.querySelectorAll(".terminal-pane-wrap[hidden]")).toHaveLength(1);
    }
    expect(toggle).toBeDefined();
    // Sin remontajes: mismas instancias, mismo texto una sola vez.
    expect(fakeXterm.instances.length).toBe(mounts);
    expect(liveTerminals()).toHaveLength(2);
    expect(terminalFor("term-1").text).toBe("AAA");
    // Alternar no crea PTYs ni re-suscribe (siguen los 6 del montaje
    // doble inicial, con un solo vivo por evento).
    expect(backend.calls.filter((c) => c.cmd === "term_create")).toHaveLength(2);
    expect(events.listens).toBe(6);
    expect(events.handlers.get("ruth-terminal-output")?.size).toBe(1);
  });

  it("limpia una sesión sin tocar la otra ni el PTY", async () => {
    renderPanel();
    await createSession(1);
    await createSession(2);
    emit("ruth-terminal-output", { id: "term-1", data: "AAA" });
    emit("ruth-terminal-output", { id: "term-2", data: "BBB" });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar vista de term-1" }));
    expect(terminalFor("term-1").text).toBe("");
    expect(terminalFor("term-2").text).toBe("BBB");
    expect(backend.calls.some((c) => c.cmd === "term_write")).toBe(false);
  });

  it("redimensiona cada PTY a su tamaño real, nunca cero", async () => {
    renderPanel();
    await createSession(1);
    xtermDims.cols = 100;
    xtermDims.rows = 30;
    for (const ro of observers) ro.cb();
    // Tras el antirrebote, el último aviso lleva el tamaño medido.
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

  it("Ctrl+C viaja al PTY tal cual", async () => {
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

  it("cierra con confirmación y conserva la otra sesión", async () => {
    renderPanel();
    await createSession(1);
    await createSession(2);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar term-1" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cerrar term-1" });
    // Cancelar no cierra.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    // Confirmar cierra y activa la que queda.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar term-1" }));
    const dialog2 = await screen.findByRole("alertdialog", { name: "Cerrar term-1" });
    fireEvent.click(within(dialog2).getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
    expect(backend.calls.some((c) => c.cmd === "term_close")).toBe(true);
    expect(screen.getByRole("tab", { name: /term-2/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("ocultar avisa al contenedor sin cerrar sesiones", async () => {
    const onHide = vi.fn();
    renderPanel(onHide);
    await createSession(1);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar panel de terminal" }));
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(backend.calls.some((c) => c.cmd === "term_close")).toBe(false);
  });
});
