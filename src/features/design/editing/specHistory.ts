// Historial acotado de deshacer/rehacer para cambios SEMÁNTICOS del
// borrador. Puro: sin React. Solo guarda especificaciones; mover elementos
// o cambiar el zoom nunca entra aquí (la disposición vive aparte).
export interface SpecHistory {
  past: string[];
  present: string;
  future: string[];
}

export const HISTORY_CAP = 50;

/** Historial nuevo sobre la especificación base (versión actual). */
export function createHistory(base: string): SpecHistory {
  return { past: [], present: base, future: [] };
}

/**
 * Registra una especificación nueva. Sin cambios (igual a la actual) no
 * hace nada; un cambio nuevo descarta el futuro de rehacer.
 */
export function pushHistory(history: SpecHistory, next: string): SpecHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  while (past.length > HISTORY_CAP) past.shift();
  return { past, present: next, future: [] };
}

/** Deshace un paso. Sin pasado, devuelve el mismo historial. */
export function undoHistory(history: SpecHistory): SpecHistory {
  if (history.past.length === 0) return history;
  const past = [...history.past];
  const present = past.pop() as string;
  return { past, present, future: [history.present, ...history.future] };
}

/** Rehace un paso. Sin futuro, devuelve el mismo historial. */
export function redoHistory(history: SpecHistory): SpecHistory {
  if (history.future.length === 0) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

export function canUndo(history: SpecHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: SpecHistory): boolean {
  return history.future.length > 0;
}
