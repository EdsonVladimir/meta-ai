import { describe, expect, it } from "vitest";
import { DEFAULT_CODE_EDITOR_PREFS } from "./editorPrefs";
import type { MonacoApi } from "./monacoLoader";
import {
  RUTH_MONACO_THEME,
  ensureRuthMonacoTheme,
  monacoDiffOptions,
  monacoDiffUpdate,
  monacoEditorOptions,
  monacoEditorUpdate,
  ruthMonacoTheme,
} from "./monacoTheme";

describe("Ruth theme for Monaco", () => {
  it("uses the Ruth theme colors and inherits highlighting", () => {
    const theme = ruthMonacoTheme();
    expect(theme.base).toBe("vs-dark");
    expect(theme.inherit).toBe(true);
    expect(theme.colors["editor.background"]).toBe("#171c22");
    expect(theme.colors["editorCursor.foreground"]).toBe("#3ddc97");
  });

  it("defines the theme once and always activates it", () => {
    const calls: string[] = [];
    const api = {
      editor: {
        defineTheme: () => {
          calls.push("define");
        },
        setTheme: () => {
          calls.push("set");
        },
      },
    } as unknown as MonacoApi;
    ensureRuthMonacoTheme(api);
    ensureRuthMonacoTheme(api);
    expect(calls).toEqual(["define", "set", "set"]);
  });

  it("derives editor options from the preferences", () => {
    const options = monacoEditorOptions({
      ...DEFAULT_CODE_EDITOR_PREFS,
      minimap: true,
      wordWrap: true,
      fontSize: 15,
    });
    expect(options.theme).toBe(RUTH_MONACO_THEME);
    expect(options.minimap).toMatchObject({ enabled: true });
    expect(options.wordWrap).toBe("on");
    expect(options.fontSize).toBe(15);
    expect(monacoEditorUpdate(DEFAULT_CODE_EDITOR_PREFS)).not.toHaveProperty("theme");
  });

  it("the diff is read-only and respects the layout", () => {
    expect(monacoDiffOptions(DEFAULT_CODE_EDITOR_PREFS)).toMatchObject({
      theme: RUTH_MONACO_THEME,
      readOnly: true,
      renderSideBySide: true,
    });
    expect(
      monacoDiffOptions({ ...DEFAULT_CODE_EDITOR_PREFS, diffLayout: "inline" }).renderSideBySide,
    ).toBe(false);
    expect(monacoDiffUpdate(DEFAULT_CODE_EDITOR_PREFS)).not.toHaveProperty("theme");
  });
});
