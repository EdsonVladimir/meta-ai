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

describe("terminal tabs", () => {
  it("respects the three-session limit", () => {
    const tabs = [info("term-1"), info("term-2")].map((i) => ({ info: i }));
    expect(canCreateTerminal(tabs)).toBe(true);
    expect(canCreateTerminal([...tabs, { info: info("term-3") }])).toBe(false);
  });

  it("adding ignores duplicates and removing keeps the rest", () => {
    const tabs = [{ info: info("term-1") }];
    expect(addTerminalTab(tabs, info("term-1"))).toEqual(tabs);
    const two = addTerminalTab(tabs, info("term-2"));
    expect(removeTerminalTab(two, "term-1").map((t) => t.info.id)).toEqual(["term-2"]);
  });

  it("exit marks the code without touching neighbors", () => {
    const tabs = [{ info: info("term-1") }, { info: info("term-2") }];
    const next = applyTerminalExit(tabs, "term-1", 7);
    expect(next[0].info).toMatchObject({ running: false, exitCode: 7 });
    expect(next[1].info.running).toBe(true);
  });

  it("after closing, the previous neighbor activates", () => {
    const tabs = [{ info: info("term-1") }, { info: info("term-2") }, { info: info("term-3") }];
    expect(nextActiveTerminal(tabs, "term-2", "term-2")).toBe("term-1");
    expect(nextActiveTerminal(tabs, "term-1", "term-1")).toBe("term-2");
    expect(nextActiveTerminal(tabs, "term-3", "term-1")).toBe("term-1");
    expect(nextActiveTerminal([{ info: info("term-1") }], "term-1", "term-1")).toBeNull();
  });

  it("closing a running session confirms; an exited one does not", () => {
    expect(needsTerminalCloseConfirm({ info: info("term-1", true) })).toBe(true);
    expect(needsTerminalCloseConfirm({ info: info("term-1", false) })).toBe(false);
    expect(needsTerminalCloseConfirm(undefined)).toBe(false);
    expect(runningTerminals([{ info: info("a", true) }, { info: info("b", false) }])).toBe(1);
  });

  it("abbreviates folders without inventing", () => {
    expect(shortTerminalCwd("/home/u", "/home/u")).toBe("~");
    expect(shortTerminalCwd("/home/u/project", "/home/u")).toBe("~/project");
    expect(shortTerminalCwd("/home/u/a/b/c", "/home/u")).toBe("~/…/b/c");
    expect(shortTerminalCwd("/var/lib/stuff/x", null)).toBe("/…/stuff/x");
    expect(shortTerminalCwd("/", null)).toBe("/");
  });

  it("unsubscribes late subscriptions without duplicating or losing", async () => {
    // Duplicated-prompt regression: unmount before resolving.
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

  it("disposing unsubscribes what already resolved", async () => {
    const collector = createUnlistenCollector();
    let offs = 0;
    collector.track(Promise.resolve(() => (offs += 1)));
    await Promise.resolve();
    await Promise.resolve();
    expect(offs).toBe(0);
    collector.dispose();
    expect(offs).toBe(1);
  });

  it("splits panes, redistributes on close and drags with a floor", () => {
    expect(equalPaneWidths(3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(equalPaneWidths(0)).toEqual([]);
    expect(dropPaneWidth([0.5, 0.3, 0.2], 1)).toEqual([0.5 / 0.7, 0.2 / 0.7]);
    expect(dropPaneWidth([1], 0)).toEqual([]);
    // Drags 0.1 from the second to the first.
    expect(dragPaneWidths([0.5, 0.5], 0, 0.1, 0.1)).toEqual([0.6, 0.4]);
    // Below the floor it does not move.
    expect(dragPaneWidths([0.5, 0.5], 0, 0.45, 0.1)).toEqual([0.5, 0.5]);
    // Separador inexistente: intacto.
    expect(dragPaneWidths([0.5, 0.5], 1, 0.1, 0.1)).toEqual([0.5, 0.5]);
    expect(dragPaneWidths([0.5, 0.5], -1, 0.1, 0.1)).toEqual([0.5, 0.5]);
  });

  it("labels the state with the real code", () => {
    expect(terminalStatusLabel(info("a", true))).toBe("running");
    expect(terminalStatusLabel({ ...info("a", false), exitCode: 1 })).toBe("exited (1)");
    expect(terminalStatusLabel({ ...info("a", false), exitCode: null })).toBe("exited");
  });
});
