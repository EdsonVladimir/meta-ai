// Pure terminal-tab coordination: add, remove, mark exit, pick the
// active one and decide confirmations. No React, no Tauri.
import { MAX_TERMINAL_SESSIONS, type TerminalSessionDto, type TerminalTab } from "./types";

export function canCreateTerminal(tabs: TerminalTab[]): boolean {
  return tabs.length < MAX_TERMINAL_SESSIONS;
}

export function addTerminalTab(tabs: TerminalTab[], info: TerminalSessionDto): TerminalTab[] {
  if (tabs.some((tab) => tab.info.id === info.id)) return tabs;
  return [...tabs, { info }];
}

export function removeTerminalTab(tabs: TerminalTab[], id: string): TerminalTab[] {
  return tabs.filter((tab) => tab.info.id !== id);
}

export function applyTerminalExit(
  tabs: TerminalTab[],
  id: string,
  code: number | null,
): TerminalTab[] {
  return tabs.map((tab) =>
    tab.info.id === id
      ? { info: { ...tab.info, running: false, exitCode: code } }
      : tab,
  );
}

/** Active after closing: nearest neighbor (the previous one when it exists). */
export function nextActiveTerminal(
  tabs: TerminalTab[],
  closedId: string,
  activeId: string | null,
): string | null {
  const rest = tabs.filter((tab) => tab.info.id !== closedId);
  if (activeId !== closedId) {
    return activeId !== null && rest.some((tab) => tab.info.id === activeId) ? activeId : null;
  }
  if (rest.length === 0) return null;
  const closedIndex = tabs.findIndex((tab) => tab.info.id === closedId);
  const pick = rest[Math.min(Math.max(closedIndex - 1, 0), rest.length - 1)];
  return pick.info.id;
}

/** Closing a running session asks for confirmation; an exited one does not. */
export function needsTerminalCloseConfirm(tab: TerminalTab | undefined): boolean {
  return tab !== undefined && tab.info.running;
}

export function runningTerminals(tabs: TerminalTab[]): number {
  return tabs.filter((tab) => tab.info.running).length;
}

/**
 * Short folder for the tab: `~` for the home folder and at most two
 * levels (`~/project/sub`). Never invents: it abbreviates the served text.
 */
export function shortTerminalCwd(cwd: string, home: string | null): string {
  let rest = cwd;
  if (home !== null && home !== "" && (cwd === home || cwd.startsWith(home + "/"))) {
    rest = "~" + cwd.slice(home.length);
  }
  const parts = rest.split("/").filter((part) => part !== "");
  if (parts.length <= 3) return rest === "" ? "/" : rest;
  const head = rest.startsWith("~") ? "~" : rest.startsWith("/") ? "" : "";
  const tail = parts.slice(-2).join("/");
  return head === "" && rest.startsWith("/") ? `/…/${tail}` : `${head}/…/${tail}`;
}

/** Honest status label: running or exit code. */
export function terminalStatusLabel(info: TerminalSessionDto): string {
  if (info.running) return "running";
  return info.exitCode === null ? "exited" : `exited (${info.exitCode})`;
}

/**
 * Unsubscribe collector that survives early unmounts. Cause of the
 * duplicated prompt: `listen()` is async and the effect cleanup ran with
 * the list still empty (in dev, StrictMode mounts twice), leaving
 * orphaned listeners writing every chunk twice. Here, whatever resolves
 * after `dispose()` unsubscribes immediately: each event arrives exactly
 * once.
 */
export interface UnlistenCollector {
  track(promise: Promise<() => void>): void;
  dispose(): void;
}

/** Layout of the same sessions: tabs or side by side. */
export type TerminalLayout = "tabs" | "parallel";

/** Even fractions for N panes (they add up to 1). */
export function equalPaneWidths(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}

/** When closing a pane: its fraction goes away and the rest is shared. */
export function dropPaneWidth(widths: number[], index: number): number[] {
  const rest = widths.filter((_, i) => i !== index);
  const total = rest.reduce((sum, value) => sum + value, 0);
  if (rest.length === 0 || total <= 0) return equalPaneWidths(rest.length);
  return rest.map((value) => value / total);
}

/**
 * Dragging the separator between `index` and `index+1`: moves `delta` of
 * fraction from one to the other, without dropping any pane below
 * `minFrac`.
 */
export function dragPaneWidths(
  widths: number[],
  index: number,
  delta: number,
  minFrac: number,
): number[] {
  if (index < 0 || index + 1 >= widths.length) return widths;
  const left = widths[index] + delta;
  const right = widths[index + 1] - delta;
  const floor = Math.min(minFrac, (widths[index] + widths[index + 1]) / 2);
  if (left < floor || right < floor) return widths;
  const next = [...widths];
  next[index] = left;
  next[index + 1] = right;
  return next;
}

export function createUnlistenCollector(): UnlistenCollector {
  let disposed = false;
  const ready: (() => void)[] = [];
  return {
    track(promise: Promise<() => void>) {
      void promise.then((off) => {
        if (disposed) off();
        else ready.push(off);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      ready.splice(0).forEach((off) => off());
    },
  };
}
