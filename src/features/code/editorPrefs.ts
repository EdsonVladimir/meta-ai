// Code-editor-only preferences: local presentation, no domain or
// content. Saved in the WebView storage; when missing or failing, the
// defaults apply.
export type CodeWhitespaceMode = "none" | "selection" | "all";

export type CodeDiffLayout = "side" | "inline";

export interface CodeEditorPrefs {
  minimap: boolean;
  wordWrap: boolean;
  fontSize: number;
  lineHeight: number;
  whitespace: CodeWhitespaceMode;
  guides: boolean;
  stickyScroll: boolean;
  diffLayout: CodeDiffLayout;
}

export const DEFAULT_CODE_EDITOR_PREFS: CodeEditorPrefs = {
  minimap: false,
  wordWrap: false,
  fontSize: 13,
  lineHeight: 20,
  whitespace: "selection",
  guides: true,
  stickyScroll: false,
  diffLayout: "side",
};

export const CODE_EDITOR_PREFS_KEY = "ruth.codeEditorPrefs.v1";
const MIN_FONT_SIZE = 11;
const MAX_FONT_SIZE = 20;
const MIN_LINE_HEIGHT = 16;
const MAX_LINE_HEIGHT = 32;

type PrefStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): PrefStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: unknown }).localStorage;
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof (candidate as PrefStorage).getItem === "function" &&
      typeof (candidate as PrefStorage).setItem === "function"
    ) {
      return candidate as PrefStorage;
    }
  } catch {
    // No storage available: defaults.
  }
  return null;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/** Normalizes partial or corrupt values without throwing. */
export function normalizeCodeEditorPrefs(raw: unknown): CodeEditorPrefs {
  if (raw === null || typeof raw !== "object") return { ...DEFAULT_CODE_EDITOR_PREFS };
  const candidate = raw as Partial<Record<keyof CodeEditorPrefs, unknown>>;
  const whitespace = candidate.whitespace;
  const diffLayout = candidate.diffLayout;
  return {
    minimap: candidate.minimap === true,
    wordWrap: candidate.wordWrap === true,
    fontSize: clampInt(
      candidate.fontSize,
      DEFAULT_CODE_EDITOR_PREFS.fontSize,
      MIN_FONT_SIZE,
      MAX_FONT_SIZE,
    ),
    lineHeight: clampInt(
      candidate.lineHeight,
      DEFAULT_CODE_EDITOR_PREFS.lineHeight,
      MIN_LINE_HEIGHT,
      MAX_LINE_HEIGHT,
    ),
    whitespace: whitespace === "none" || whitespace === "selection" || whitespace === "all"
      ? whitespace
      : DEFAULT_CODE_EDITOR_PREFS.whitespace,
    guides: candidate.guides !== false,
    stickyScroll: candidate.stickyScroll === true,
    diffLayout: diffLayout === "side" || diffLayout === "inline"
      ? diffLayout
      : DEFAULT_CODE_EDITOR_PREFS.diffLayout,
  };
}

export function loadCodeEditorPrefs(storage?: PrefStorage | null): CodeEditorPrefs {
  const store = storage === undefined ? defaultStorage() : storage;
  if (store === null) return { ...DEFAULT_CODE_EDITOR_PREFS };
  try {
    const raw = store.getItem(CODE_EDITOR_PREFS_KEY);
    if (raw === null) return { ...DEFAULT_CODE_EDITOR_PREFS };
    return normalizeCodeEditorPrefs(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_CODE_EDITOR_PREFS };
  }
}

export function saveCodeEditorPrefs(
  prefs: CodeEditorPrefs,
  storage?: PrefStorage | null,
): void {
  const store = storage === undefined ? defaultStorage() : storage;
  if (store === null) return;
  try {
    store.setItem(CODE_EDITOR_PREFS_KEY, JSON.stringify(normalizeCodeEditorPrefs(prefs)));
  } catch {
    // Optional preferences: failing silently preserves the session.
  }
}
