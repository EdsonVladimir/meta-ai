// Ruth theme for Monaco and preference-derived options.
// Presentation only: it touches no models, text or saving.
import type { CodeEditorPrefs } from "./editorPrefs";
import type { MonacoApi } from "./monacoLoader";

export const RUTH_MONACO_THEME = "ruth-dark";
export const RUTH_MONACO_FONT =
  '"Cascadia Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export function ruthMonacoTheme(): {
  base: "vs-dark";
  inherit: boolean;
  rules: Array<{ token: string }>;
  colors: Record<string, string>;
} {
  return {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#171c22",
      "editor.foreground": "#e9eef3",
      "editorLineNumber.foreground": "#667180",
      "editorLineNumber.activeForeground": "#e9eef3",
      "editorCursor.foreground": "#3ddc97",
      "editor.selectionBackground": "#24473a",
      "editor.inactiveSelectionBackground": "#1d332b",
      "editor.lineHighlightBackground": "#1b2129",
      "editor.lineHighlightBorder": "#2a323b",
      "editorWhitespace.foreground": "#3d4856",
      "editorIndentGuide.background": "#2a323b",
      "editorIndentGuide.activeBackground": "#3ddc97",
      "editorBracketMatch.background": "#24473a",
      "editorBracketMatch.border": "#3ddc97",
      "editorGutter.background": "#171c22",
      "editorWidget.background": "#1b2129",
      "editorWidget.border": "#2a323b",
      "editorHoverWidget.background": "#1b2129",
      "editorHoverWidget.border": "#2a323b",
      "minimap.background": "#171c22",
      "minimapSlider.background": "#2a323b",
      "minimapSlider.hoverBackground": "#3d4856",
      "minimapSlider.activeBackground": "#24473a",
      "diffEditor.insertedTextBackground": "#1c3a2f",
      "diffEditor.removedTextBackground": "#412726",
      "diffEditor.insertedLineBackground": "#173128",
      "diffEditor.removedLineBackground": "#37201f",
      focusBorder: "#3ddc97",
    },
  };
}

const definedThemes = new WeakSet<object>();

/** Defines the theme once per API and activates it. */
export function ensureRuthMonacoTheme(api: MonacoApi): void {
  if (!definedThemes.has(api)) {
    api.editor.defineTheme(RUTH_MONACO_THEME, ruthMonacoTheme());
    definedThemes.add(api);
  }
  api.editor.setTheme(RUTH_MONACO_THEME);
}

export type RuthEditorOptions = NonNullable<Parameters<MonacoApi["editor"]["create"]>[1]>;
export type RuthEditorUpdate = NonNullable<
  Parameters<ReturnType<MonacoApi["editor"]["create"]>["updateOptions"]>[0]
>;
export type RuthDiffOptions = NonNullable<
  Parameters<MonacoApi["editor"]["createDiffEditor"]>[1]
>;
export type RuthDiffUpdate = NonNullable<
  Parameters<ReturnType<MonacoApi["editor"]["createDiffEditor"]>["updateOptions"]>[0]
>;

function sharedOptions(prefs: CodeEditorPrefs) {
  return {
    fontFamily: RUTH_MONACO_FONT,
    fontLigatures: true,
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    wordWrap: (prefs.wordWrap ? "on" : "off") as "on" | "off",
    wrappingStrategy: "advanced" as const,
    stickyScroll: { enabled: prefs.stickyScroll, maxLineCount: 4 },
    guides: {
      bracketPairs: prefs.guides,
      bracketPairsHorizontal: (prefs.guides ? "active" : false) as "active" | false,
      highlightActiveBracketPair: prefs.guides,
      indentation: true,
      highlightActiveIndentation: true,
    },
    bracketPairColorization: { enabled: prefs.guides },
    folding: true,
    foldingStrategy: "auto" as const,
    foldingHighlight: true,
    smoothScrolling: true,
    cursorBlinking: "smooth" as const,
    cursorSmoothCaretAnimation: "on" as const,
    renderLineHighlight: "all" as const,
    renderWhitespace: prefs.whitespace,
    scrollBeyondLastLine: false,
    padding: { top: 8, bottom: 8 },
  };
}

/** Initial main-editor options (they include the theme). */
export function monacoEditorOptions(prefs: CodeEditorPrefs): RuthEditorOptions {
  return {
    ...sharedOptions(prefs),
    theme: RUTH_MONACO_THEME,
    automaticLayout: false,
    minimap: {
      enabled: prefs.minimap,
      renderCharacters: false,
      maxColumn: 120,
      scale: 1,
    },
  };
}

/** Hot update: `updateOptions` does not accept the theme. */
export function monacoEditorUpdate(prefs: CodeEditorPrefs): RuthEditorUpdate {
  const { theme: _theme, automaticLayout: _layout, ...rest } = monacoEditorOptions(prefs);
  void _theme;
  void _layout;
  return rest;
}

/** Diff update without theme or initial layout. */
export function monacoDiffUpdate(prefs: CodeEditorPrefs): RuthDiffUpdate {
  const { theme: _theme, automaticLayout: _layout, ...rest } = monacoDiffOptions(prefs);
  void _theme;
  void _layout;
  return rest;
}

/** Conflict-diff options: read-only and honest. */
export function monacoDiffOptions(prefs: CodeEditorPrefs): RuthDiffOptions {
  const sideBySide = prefs.diffLayout === "side";
  return {
    ...sharedOptions(prefs),
    theme: RUTH_MONACO_THEME,
    automaticLayout: false,
    readOnly: true,
    renderSideBySide: sideBySide,
    useInlineViewWhenSpaceIsLimited: sideBySide,
    renderSideBySideInlineBreakpoint: 700,
    diffWordWrap: prefs.wordWrap ? "on" : "off",
    minimap: { enabled: false },
    stickyScroll: { enabled: false },
    renderIndicators: true,
    originalEditable: false,
  };
}
