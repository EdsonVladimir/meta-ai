// Code editor shell: breadcrumbs, Monaco and status bar.
// Highlighting is only visual, not language analysis.
import { useEffect, useState } from "react";
import { useRequirementsUi } from "../requirements/uiStore";
import { CodeBreadcrumbs } from "./CodeBreadcrumbs";
import { CodeEditor, type EditorCursor, type EditorReveal } from "./CodeEditor";
import { CodeEditorPrefsPanel } from "./CodeEditorPrefsPanel";
import { CodeStatusBar } from "./CodeStatusBar";
import type { CodeEditorPrefs } from "./editorPrefs";
import { CODE_LANGUAGES, tabKeyOf } from "./model";
import type { MonacoApi } from "./monacoLoader";
import type { CodeTab } from "./types";

interface CodeViewerProps {
  tab: CodeTab;
  visible: boolean;
  reveal: EditorReveal | null;
  prefs: CodeEditorPrefs;
  onPrefsChange: (next: CodeEditorPrefs) => void;
  onPrefsReset: () => void;
  onRevealDir: (rootId: string, rel: string) => void;
  onRetry: () => void;
  onLanguageChange: (language: string) => void;
  onEditorChange: (key: string, value: string) => void;
  loader?: () => Promise<MonacoApi>;
}

export function CodeViewer({
  tab,
  visible,
  reveal,
  prefs,
  onPrefsChange,
  onPrefsReset,
  onRevealDir,
  onRetry,
  onLanguageChange,
  onEditorChange,
  loader,
}: CodeViewerProps) {
  const key = tabKeyOf(tab);
  const [cursor, setCursor] = useState<EditorCursor | null>(null);
  const archScope = useRequirementsUi((s) => s.archScope);
  const activeProjectRel =
    archScope.kind !== "all" && archScope.rootId === tab.rootId ? archScope.rel : null;

  useEffect(() => {
    setCursor(null);
  }, [key]);

  return (
    <div className="code-viewer">
      <div className="code-viewer-head">
        <CodeBreadcrumbs
          rootId={tab.rootId}
          rootName={tab.rootName}
          rel={tab.rel}
          onRevealDir={onRevealDir}
          activeProjectRel={activeProjectRel}
        />
        <span className="code-viewer-tools">
          {tab.dirty && !tab.saving && (
            <span className="badge dirty" title="Unsaved changes">
              Unsaved
            </span>
          )}
          {tab.saving && <span className="hint">Saving…</span>}
          <CodeEditorPrefsPanel prefs={prefs} onChange={onPrefsChange} onReset={onPrefsReset} />
        </span>
      </div>
      {tab.saveError !== null && (
        <p className="error" role="alert">
          {tab.saveError}
        </p>
      )}
      {tab.loading && <p className="hint">Loading file…</p>}
      {tab.error !== null && !tab.loading && (
        <p className="error" role="alert">
          {tab.error.message}{" "}
          <button type="button" className="secondary small" onClick={onRetry}>
            Retry
          </button>
        </p>
      )}
      {tab.content !== null && tab.savedText !== null && (
        <CodeEditor
          tabKey={key}
          text={tab.savedText}
          language={tab.language}
          visible={visible}
          reveal={reveal}
          prefs={prefs}
          onChange={onEditorChange}
          onCursor={(eventKey, next) => {
            if (eventKey === key) setCursor(next);
          }}
          loader={loader}
        />
      )}
      <CodeStatusBar
        cursor={cursor}
        languageControl={
          <>
            <label className="code-status-label" htmlFor={`lang-${tab.rootId}-${tab.rel}`}>
              Highlighting
            </label>
            <select
              id={`lang-${tab.rootId}-${tab.rel}`}
              value={tab.language}
              onChange={(event) => onLanguageChange(event.target.value)}
              aria-label="Highlight language"
              title="Syntax highlighting (not language analysis)"
            >
              {CODE_LANGUAGES.map((lang) => (
                <option key={lang.id} value={lang.id}>
                  {lang.label}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}
