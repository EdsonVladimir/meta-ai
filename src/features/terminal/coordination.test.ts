import { describe, expect, it } from "vitest";
import {
  addTerminalTab,
  applyTerminalExit,
  canCreateTerminal,
  createUnlistenCollector,
  dragPaneWidths,
  dropPaneWidth,
  equalPaneWidths,
  needsTerminalCloseConfirm,
  nextActiveTerminal,
  removeTerminalTab,
  runningTerminals,
  shortTerminalCwd,
  terminalStatusLabel,
} from "./coordination";
import type { TerminalSessionDto } from "./types";

function info(id: string, running = true): TerminalSessionDto {
  return { id, shell: "/bin/sh", cwd: "/home/u", cols: 80, rows: 24, running, exitCode: null };
}

describe("pestañas de terminal", () => {
  it("respeta el límite de tres sesiones", () => {
    const tabs = [info("term-1"), info("term-2")].map((i) => ({ info: i }));
    expect(canCreateTerminal(tabs)).toBe(true);
    expect(canCreateTerminal([...tabs, { info: info("term-3") }])).toBe(false);
  });

  it("añadir ignora duplicados y quitar conserva el resto", () => {
    const tabs = [{ info: info("term-1") }];
    expect(addTerminalTab(tabs, info("term-1"))).toEqual(tabs);
    const two = addTerminalTab(tabs, info("term-2"));
    expect(removeTerminalTab(two, "term-1").map((t) => t.info.id)).toEqual(["term-2"]);
  });

  it("el fin marca código sin tocar a las vecinas", () => {
    const tabs = [{ info: info("term-1") }, { info: info("term-2") }];
    const next = applyTerminalExit(tabs, "term-1", 7);
    expect(next[0].info).toMatchObject({ running: false, exitCode: 7 });
    expect(next[1].info.running).toBe(true);
  });

  it("tras cerrar activa la vecina anterior", () => {
    const tabs = [{ info: info("term-1") }, { info: info("term-2") }, { info: info("term-3") }];
    expect(nextActiveTerminal(tabs, "term-2", "term-2")).toBe("term-1");
    expect(nextActiveTerminal(tabs, "term-1", "term-1")).toBe("term-2");
    expect(nextActiveTerminal(tabs, "term-3", "term-1")).toBe("term-1");
    expect(nextActiveTerminal([{ info: info("term-1") }], "term-1", "term-1")).toBeNull();
  });

  it("cerrar en marcha confirma; terminada no", () => {
    expect(needsTerminalCloseConfirm({ info: info("term-1", true) })).toBe(true);
    expect(needsTerminalCloseConfirm({ info: info("term-1", false) })).toBe(false);
    expect(needsTerminalCloseConfirm(undefined)).toBe(false);
    expect(runningTerminals([{ info: info("a", true) }, { info: info("b", false) }])).toBe(1);
  });

  it("abrevia carpetas sin inventar", () => {
    expect(shortTerminalCwd("/home/u", "/home/u")).toBe("~");
    expect(shortTerminalCwd("/home/u/proyecto", "/home/u")).toBe("~/proyecto");
    expect(shortTerminalCwd("/home/u/a/b/c", "/home/u")).toBe("~/…/b/c");
    expect(shortTerminalCwd("/var/lib/cosas/x", null)).toBe("/…/cosas/x");
    expect(shortTerminalCwd("/", null)).toBe("/");
  });

  it("da de baja las suscripciones tardías sin duplicar ni perder", async () => {
    // Regresión del prompt duplicado: desmontaje antes de resolverse.
    const collector = createUnlistenCollector();
    let offs = 0;
    const off = () => {
      offs += 1;
    };
    let resolveFirst!: (off: () => void) => void;
    let resolveSecond!: (off: () => void) => void;
    collector.track(new Promise<() => void>((resolve) => (resolveFirst = resolve)));
    collector.track(new Promise<() => void>((resolve) => (resolveSecond = resolve)));
    collector.dispose();
    resolveFirst(off);
    resolveSecond(off);
    await Promise.resolve();
    await Promise.resolve();
    expect(offs).toBe(2);
    collector.dispose();
    expect(offs).toBe(2);
  });

  it("da de baja al disponer lo ya resuelto", async () => {
    const collector = createUnlistenCollector();
    let offs = 0;
    collector.track(Promise.resolve(() => (offs += 1)));
    await Promise.resolve();
    await Promise.resolve();
    expect(offs).toBe(0);
    collector.dispose();
    expect(offs).toBe(1);
  });

  it("reparte paneles, redistribuye al cerrar y arrastra con mínimo", () => {
    expect(equalPaneWidths(3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(equalPaneWidths(0)).toEqual([]);
    expect(dropPaneWidth([0.5, 0.3, 0.2], 1)).toEqual([0.5 / 0.7, 0.2 / 0.7]);
    expect(dropPaneWidth([1], 0)).toEqual([]);
    // Arrastra 0.1 del segundo al primero.
    expect(dragPaneWidths([0.5, 0.5], 0, 0.1, 0.1)).toEqual([0.6, 0.4]);
    // Por debajo del mínimo no se mueve.
    expect(dragPaneWidths([0.5, 0.5], 0, 0.45, 0.1)).toEqual([0.5, 0.5]);
    // Separador inexistente: intacto.
    expect(dragPaneWidths([0.5, 0.5], 1, 0.1, 0.1)).toEqual([0.5, 0.5]);
    expect(dragPaneWidths([0.5, 0.5], -1, 0.1, 0.1)).toEqual([0.5, 0.5]);
  });

  it("etiqueta el estado con el código real", () => {
    expect(terminalStatusLabel(info("a", true))).toBe("en marcha");
    expect(terminalStatusLabel({ ...info("a", false), exitCode: 1 })).toBe("terminó (1)");
    expect(terminalStatusLabel({ ...info("a", false), exitCode: null })).toBe("terminada");
  });
});
