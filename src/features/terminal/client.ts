// Cliente de terminal: comandos Tauri y suscripciones a eventos.
// La salida fluye por eventos a xterm directamente, sin pasar por stores
// de React: ningún fragmento re-renderiza nada.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../../lib/env";
import type {
  TerminalCloseRequestedEvent,
  TerminalError,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalSessionDto,
} from "./types";

export { isTauriEnvironment };

function notDesktop(): TerminalError {
  return {
    kind: "not_tauri",
    message: "La terminal integrada requiere Ruth IDE de escritorio.",
  };
}

export function normalizeTerminalError(raw: unknown): TerminalError {
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    const message =
      typeof record.message === "string" ? record.message : "Error desconocido de terminal.";
    return { kind, message };
  }
  if (typeof raw === "string") return { kind: "unknown", message: raw };
  return { kind: "unknown", message: "Error desconocido de terminal." };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriEnvironment()) throw notDesktop();
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeTerminalError(raw);
  }
}

export function listTerminals(): Promise<TerminalSessionDto[]> {
  return call("term_list");
}

export function createTerminal(cwd: string | null, cols: number, rows: number): Promise<TerminalSessionDto> {
  return call("term_create", { input: { cwd, cols, rows } });
}

export function writeTerminal(id: string, data: string): Promise<void> {
  return call("term_write", { input: { id, data } });
}

export function resizeTerminal(id: string, cols: number, rows: number): Promise<TerminalSessionDto> {
  return call("term_resize", { input: { id, cols, rows } });
}

export function closeTerminal(id: string): Promise<void> {
  return call("term_close", { input: { id } });
}

/** Salida confirmada: mata las sesiones y termina la app. */
export function quitAppWithTerminals(): Promise<void> {
  return call("term_quit_app");
}

export function listenTerminalOutput(
  onOutput: (event: TerminalOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("ruth-terminal-output", (event) => onOutput(event.payload));
}

export function listenTerminalExit(onExit: (event: TerminalExitEvent) => void): Promise<UnlistenFn> {
  return listen<TerminalExitEvent>("ruth-terminal-exit", (event) => onExit(event.payload));
}

export function listenTerminalCloseRequested(
  onRequest: (event: TerminalCloseRequestedEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalCloseRequestedEvent>("ruth-terminal-close-requested", (event) =>
    onRequest(event.payload),
  );
}
