// Bounded undo/redo history for SEMANTIC draft changes. Pure: no
// React. It only stores specs; moving elements or changing zoom never
// enters here (layout lives separately).
export interface SpecHistory {
  past: string[];
  present: string;
  future: string[];
}

export const HISTORY_CAP = 50;

/** New history over the base spec (current version). */
export function createHistory(base: string): SpecHistory {
  return { past: [], present: base, future: [] };
}

/**
 * Records a new spec. Without changes (equal to the current one) it
 * does nothing; a new change discards the redo future.
 */
export function pushHistory(history: SpecHistory, next: string): SpecHistory {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  while (past.length > HISTORY_CAP) past.shift();
  return { past, present: next, future: [] };
}

/** Undoes one step. Without past, returns the same history. */
export function undoHistory(history: SpecHistory): SpecHistory {
  if (history.past.length === 0) return history;
  const past = [...history.past];
  const present = past.pop() as string;
  return { past, present, future: [history.present, ...history.future] };
}

/** Redoes one step. Without future, returns the same history. */
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
