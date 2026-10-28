// Coordinación pura de pestañas de terminal: añadir, quitar, marcar fin,
// elegir activa y decidir confirmaciones. Sin React ni Tauri.
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

/** Activa tras cerrar: vecina más cercana (la anterior si existe). */
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

/** Cerrar una sesión en marcha pide confirmación; una terminada no. */
export function needsTerminalCloseConfirm(tab: TerminalTab | undefined): boolean {
  return tab !== undefined && tab.info.running;
}

export function runningTerminals(tabs: TerminalTab[]): number {
  return tabs.filter((tab) => tab.info.running).length;
}

/**
 * Carpeta corta para la pestaña: `~` por la carpeta personal y como mucho
 * dos niveles (`~/proyecto/sub`). Nunca inventa: abrevia el texto servido.
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

/** Etiqueta de estado honesta: en marcha o código de fin. */
export function terminalStatusLabel(info: TerminalSessionDto): string {
  if (info.running) return "en marcha";
  return info.exitCode === null ? "terminada" : `terminó (${info.exitCode})`;
}

/**
 * Colector de bajas de suscripción a prueba de desmontajes tempranos.
 * Causa del prompt duplicado: `listen()` es asíncrono y la limpieza del
 * efecto corría con la lista aún vacía (en dev, StrictMode monta dos
 * veces), dejando listeners huérfanos que escribían cada fragmento dos
 * veces. Aquí, lo que se resuelva tras `dispose()` se da de baja al
 * momento: cada evento llega exactamente una vez.
 */
export interface UnlistenCollector {
  track(promise: Promise<() => void>): void;
  dispose(): void;
}

/** Disposición de las mismas sesiones: pestañas o lado a lado. */
export type TerminalLayout = "tabs" | "parallel";

/** Fracciones iguales para N paneles (suman 1). */
export function equalPaneWidths(count: number): number[] {
  if (count <= 0) return [];
  return Array.from({ length: count }, () => 1 / count);
}

/** Al cerrar un panel: se quita su fracción y el resto se reparte. */
export function dropPaneWidth(widths: number[], index: number): number[] {
  const rest = widths.filter((_, i) => i !== index);
  const total = rest.reduce((sum, value) => sum + value, 0);
  if (rest.length === 0 || total <= 0) return equalPaneWidths(rest.length);
  return rest.map((value) => value / total);
}

/**
 * Arrastre del separador entre `index` e `index+1`: mueve `delta` de
 * fracción de uno al otro, sin bajar ningún panel de `minFrac`.
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
