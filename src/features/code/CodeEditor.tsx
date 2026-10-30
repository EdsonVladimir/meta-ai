// Monaco editor with one model per tab: switching tabs preserves text,
// undo and position. The live text is held by Monaco; React only
// receives changes to mark the draft (never the global store). `loader`
// is injectable for testing without downloading Monaco. When loading
// fails, an honest textarea keeps editing possible.
import { useEffect, useRef, useState } from "react";
import { DEFAULT_CODE_EDITOR_PREFS, type CodeEditorPrefs } from "./editorPrefs";
import {
  ensureRuthMonacoTheme,
  monacoEditorOptions,
  monacoEditorUpdate,
} from "./monacoTheme";
import { loadMonaco, type MonacoApi } from "./monacoLoader";

type Editor = ReturnType<MonacoApi["editor"]["create"]>;
type TextModel = ReturnType<MonacoApi["editor"]["createModel"]>;
type ViewState = ReturnType<Editor["saveViewState"]>;

interface TabModel {
  model: TextModel;
  viewState: ViewState;
  appliedText: string;
}

export interface EditorReveal {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  nonce: number;
}

/** Cursor position for the status bar (local, never global). */
export interface EditorCursor {
  line: number;
  column: number;
  selectedChars: number;
  selectionLabel: string | null;
  lineCount: number | null;
}

interface CodeEditorProps {
  tabKey: string;
  /** Saved text: only applied when creating the model or reloading. */
  text: string;
  language: string;
  /** The pane is visible: when back, re-measures the editor. */
  visible: boolean;
  /** Range-jump request (navigation from Structure). */
  reveal: EditorReveal | null;
  prefs?: CodeEditorPrefs;
  onChange: (tabKey: string, value: string) => void;
  onCursor?: (tabKey: string, cursor: EditorCursor) => void;
  loader?: () => Promise<MonacoApi>;
}

function readCursor(editor: Editor): EditorCursor | null {
  try {
    const position = editor.getPosition();
    const selection = editor.getSelection();
    const model = editor.getModel();
    const line = position?.lineNumber ?? 1;
    const column = position?.column ?? 1;
    let selectedChars = 0;
    let selectionLabel: string | null = null;
    if (
      selection !== null &&
      (selection.startLineNumber !== selection.endLineNumber ||
        selection.startColumn !== selection.endColumn)
    ) {
      selectionLabel =
        `${selection.startLineNumber}:${selection.startColumn}–` +
        `${selection.endLineNumber}:${selection.endColumn}`;
      const value = model?.getValueInRange(selection) ?? "";
      selectedChars = value.length;
    }
    return { line, column, selectedChars, selectionLabel, lineCount: model?.getLineCount() ?? null };
  } catch {
    return null;
  }
}

export function CodeEditor({
  tabKey,
  text,
  language,
  visible,
  reveal,
  prefs,
  onChange,
  onCursor,
  loader,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const apiRef = useRef<MonacoApi | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const modelsRef = useRef(new Map<string, TabModel>());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const activePrefs = prefs ?? DEFAULT_CODE_EDITOR_PREFS;
  const propsRef = useRef({ tabKey, text, language, prefs: activePrefs });
  propsRef.current = { tabKey, text, language, prefs: activePrefs };
  const tabKeyRef = useRef(tabKey);
  tabKeyRef.current = tabKey;
  const appliedPrefsRef = useRef<CodeEditorPrefs | null>(null);
  const [fallbackText, setFallbackText] = useState(text);
  const fallbackRef = useRef<HTMLTextAreaElement | null>(null);
  const load = loader ?? loadMonaco;

  function reportCursor(editor: Editor) {
    const cursor = readCursor(editor);
    if (cursor !== null) onCursorRef.current?.(tabKeyRef.current, cursor);
  }

  function reportFallbackCursor() {
    const area = fallbackRef.current;
    if (area === null) return;
    const { value, selectionStart, selectionEnd } = area;
    const before = value.slice(0, selectionStart);
    const line = before.split("\n").length;
    const column = selectionStart - (before.lastIndexOf("\n") + 1) + 1;
    onCursorRef.current?.(tabKeyRef.current, {
      line,
      column,
      selectedChars: Math.max(0, selectionEnd - selectionStart),
      selectionLabel: null,
      lineCount: value === "" ? 1 : value.split("\n").length,
    });
  }

  // Single editor creation; models live per tab.
  useEffect(() => {
    let cancelled = false;
    let editor: Editor | null = null;
    const subscriptions: Array<{ dispose: () => void }> = [];
    void (async () => {
      try {
        const api = await load();
        if (cancelled || containerRef.current === null) return;
        apiRef.current = api;
        ensureRuthMonacoTheme(api);
        const initialPrefs = propsRef.current.prefs;
        editor = api.editor.create(containerRef.current, monacoEditorOptions(initialPrefs));
        appliedPrefsRef.current = initialPrefs;
        editorRef.current = editor;
        const created = editor;
        subscriptions.push(
          created.onDidChangeCursorPosition(() => reportCursor(created)),
          created.onDidChangeCursorSelection(() => reportCursor(created)),
        );
        const { tabKey: key, text: initial, language: initialLang } = propsRef.current;
        const model = api.editor.createModel(
          initial,
          initialLang,
          api.Uri.parse(`ruth://${key}`),
        );
        modelsRef.current.set(key, { model, viewState: null, appliedText: initial });
        editor.setModel(model);
        subscriptions.push(
          model.onDidChangeContent(() => {
            onChangeRef.current(key, model.getValue());
          }),
        );
        reportCursor(created);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      for (const subscription of subscriptions) subscription.dispose();
      for (const entry of modelsRef.current.values()) entry.model.dispose();
      modelsRef.current.clear();
      editorRef.current?.dispose();
      editorRef.current = null;
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switch / external reload / language.
  useEffect(() => {
    if (status !== "ready") return;
    const api = apiRef.current;
    const editor = editorRef.current;
    if (api === null || editor === null) return;
    const current = editor.getModel();
    // Saves the outgoing model view state.
    for (const entry of modelsRef.current.values()) {
      if (entry.model === current) entry.viewState = editor.saveViewState();
    }
    let entry = modelsRef.current.get(tabKey);
    if (entry === undefined) {
      const model = api.editor.createModel(text, language, api.Uri.parse(`ruth://${tabKey}`));
      entry = { model, viewState: null, appliedText: text };
      modelsRef.current.set(tabKey, entry);
      model.onDidChangeContent(() => {
        onChangeRef.current(tabKey, model.getValue());
      });
    } else {
      if (entry.appliedText !== text) {
        entry.model.setValue(text);
        entry.appliedText = text;
      }
      api.editor.setModelLanguage(entry.model, language);
    }
    editor.setModel(entry.model);
    if (entry.viewState !== null) editor.restoreViewState(entry.viewState);
    reportCursor(editor);
  }, [status, tabKey, text, language]);

  // Hot preferences, without recreating the editor or touching models.
  useEffect(() => {
    if (status !== "ready") return;
    const editor = editorRef.current;
    if (editor === null) return;
    const applied = appliedPrefsRef.current;
    if (applied !== null && JSON.stringify(applied) === JSON.stringify(activePrefs)) return;
    appliedPrefsRef.current = activePrefs;
    editor.updateOptions(monacoEditorUpdate(activePrefs));
  }, [status, activePrefs]);

  // The fallback follows the saved text (post-conflict reloads).
  useEffect(() => {
    if (status === "failed") setFallbackText(text);
  }, [text, status]);

  // When back in the pane, the container regains size: re-measure.
  useEffect(() => {
    if (visible && status === "ready") editorRef.current?.layout();
  }, [visible, status]);

  // Re-measure when the container resizes (window, terminal, panes):
  // Monaco fixes pixels in its DOM and does not notice alone
  // (deliberate `automaticLayout: false`). Without this, its old height
  // overflows the pane downward. The observer already batches per
  // frame; zero size (hidden) is skipped and it is freed on unmount.
  useEffect(() => {
    if (status !== "ready") return;
    const node = containerRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === 0 || node.clientHeight === 0) return;
      try {
        editorRef.current?.layout();
      } catch {
        // A failed layout does not topple the editor.
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [status]);

  // Verified range jump (each nonce applies once).
  const appliedReveal = useRef(0);
  useEffect(() => {
    if (reveal === null || status !== "ready") return;
    if (appliedReveal.current === reveal.nonce) return;
    appliedReveal.current = reveal.nonce;
    const editor = editorRef.current;
    if (editor === null) return;
    const selection = {
      startLineNumber: reveal.startLine,
      startColumn: reveal.startCol,
      endLineNumber: reveal.endLine,
      endColumn: reveal.endCol,
    };
    editor.setSelection(selection);
    editor.revealRangeInCenter(selection);
    editor.focus();
  }, [reveal, status]);

  if (status === "failed") {
    return (
      <div className="code-fallback">
        <p className="hint" role="note">
          Could not load Monaco; basic editing without highlighting.
        </p>
        <textarea
          ref={fallbackRef}
          className="code-textarea"
          aria-label="File contents"
          value={fallbackText}
          onChange={(event) => {
            setFallbackText(event.target.value);
            onChange(tabKey, event.target.value);
          }}
          onSelect={reportFallbackCursor}
          onKeyUp={reportFallbackCursor}
          onClick={reportFallbackCursor}
        />
      </div>
    );
  }

  return (
    <div className="code-editor-wrap">
      {status === "loading" && <p className="hint">Loading editor…</p>}
      <div ref={containerRef} className="code-editor" aria-label="Code editor" />
    </div>
  );
}
