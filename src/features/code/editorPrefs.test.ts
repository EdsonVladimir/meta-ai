import { describe, expect, it } from "vitest";
import {
  CODE_EDITOR_PREFS_KEY,
  DEFAULT_CODE_EDITOR_PREFS,
  loadCodeEditorPrefs,
  normalizeCodeEditorPrefs,
  saveCodeEditorPrefs,
} from "./editorPrefs";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    snapshot: () => Object.fromEntries(data),
  };
}

describe("editor preferences", () => {
  it("normalizes partial and out-of-range values", () => {
    expect(
      normalizeCodeEditorPrefs({
        minimap: true,
        fontSize: 99,
        lineHeight: 1,
        whitespace: "invalid",
        guides: false,
        diffLayout: "inline",
      }),
    ).toEqual({
      ...DEFAULT_CODE_EDITOR_PREFS,
      minimap: true,
      fontSize: 20,
      lineHeight: 16,
      guides: false,
      diffLayout: "inline",
    });
  });

  it("rejects non-object values", () => {
    expect(normalizeCodeEditorPrefs(null)).toEqual(DEFAULT_CODE_EDITOR_PREFS);
    expect(normalizeCodeEditorPrefs("x")).toEqual(DEFAULT_CODE_EDITOR_PREFS);
  });

  it("persists and recovers only preferences", () => {
    const storage = memoryStorage();
    saveCodeEditorPrefs({ ...DEFAULT_CODE_EDITOR_PREFS, minimap: true }, storage);
    const snapshot = storage.snapshot();
    expect(Object.keys(snapshot)).toEqual([CODE_EDITOR_PREFS_KEY]);
    expect(snapshot[CODE_EDITOR_PREFS_KEY]).not.toContain("content");
    expect(loadCodeEditorPrefs(storage).minimap).toBe(true);
  });

  it("uses defaults on corrupt JSON or missing storage", () => {
    expect(loadCodeEditorPrefs(memoryStorage({ [CODE_EDITOR_PREFS_KEY]: "{no json" }))).toEqual(
      DEFAULT_CODE_EDITOR_PREFS,
    );
    expect(loadCodeEditorPrefs(null)).toEqual(DEFAULT_CODE_EDITOR_PREFS);
    expect(() => saveCodeEditorPrefs(DEFAULT_CODE_EDITOR_PREFS, null)).not.toThrow();
  });
});
