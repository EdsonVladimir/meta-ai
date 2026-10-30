// Terminal client: Tauri commands and event subscriptions. Output
// flows over events straight into xterm, bypassing React stores: no
// chunk re-renders anything.
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
    message: "The integrated terminal needs the Ruth IDE desktop app.",
  };
}

export function normalizeTerminalError(raw: unknown): TerminalError {
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    const message =
      typeof record.message === "string" ? record.message : "Unknown terminal error.";
    return { kind, message };
  }
  if (typeof raw === "string") return { kind: "unknown", message: raw };
  return { kind: "unknown", message: "Unknown terminal error." };
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

/** Confirmed quit: kills the sessions and ends the app. */
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
