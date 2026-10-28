// Tipos de la terminal integrada. Las sesiones viven en Rust (`ruth-term`)
// y la salida viaja por eventos; aquí solo fichas, pestañas y errores.
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

/** Pestaña visible: ficha servida por Rust. Sin caché de salida (la guarda xterm). */
export interface TerminalTab {
  info: TerminalSessionDto;
}

/** Límite espejo del de Rust (la autoridad es `MAX_SESSIONS`). */
export const MAX_TERMINAL_SESSIONS = 3;
