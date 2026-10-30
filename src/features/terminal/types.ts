// Integrated terminal types. Sessions live in Rust (`ruth-term`) and
// output travels over events; here only session records, tabs and errors.
export interface TerminalSessionDto {
  id: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
  running: boolean;
  exitCode: number | null;
}

export interface TerminalOutputEvent {
  id: string;
  data: string;
}

export interface TerminalExitEvent {
  id: string;
  code: number | null;
}

export interface TerminalCloseRequestedEvent {
  running: number;
}

export interface TerminalError {
  kind: string;
  message: string;
}

/** Visible tab: record served by Rust. No output cache (xterm keeps it). */
export interface TerminalTab {
  info: TerminalSessionDto;
}

/** Mirror of the Rust limit (the authority is `MAX_SESSIONS`). */
export const MAX_TERMINAL_SESSIONS = 3;
