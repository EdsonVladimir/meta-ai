// Read-only view of the files behind a card, over the board. Nothing is
// edited here: Open in code goes to the real editor, with its saving
// rules. Esc closes and focus returns to the button that opened it.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { normalizeCodeError } from "../client";
import type { CodeEditorPrefs } from "../editorPrefs";
import { DEFAULT_CODE_EDITOR_PREFS } from "../editorPrefs";
import { languageForFile } from "../model";
import { loadMonaco, type MonacoApi } from "../monacoLoader";
import { ensureRuthMonacoTheme, monacoEditorOptions } from "../monacoTheme";
import type { SourceTab } from "./sourceTabs";

type Editor = ReturnType<MonacoApi["editor"]["create"]>;
type TextModel = ReturnType<MonacoApi["editor"]["createModel"]>;

let viewerCounter = 0;

function SourceCode({
  text,
  rel,
  line,
  prefs,
  loader,
}: {
  text: string;
  rel: string;
  line: number | null;
  prefs: CodeEditorPrefs;
  loader: () => Promise<MonacoApi>;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let editor: Editor | null = null;
    let model: TextModel | null = null;
    void (async () => {
      try {
        const api = await loader();
        if (cancelled || containerRef.current === null) return;
        ensureRuthMonacoTheme(api);
        editor = api.editor.create(containerRef.current, {
          ...monacoEditorOptions(prefs),
          readOnly: true,
        });
        viewerCounter += 1;
        model = api.editor.createModel(
          text,
          languageForFile(rel),
          api.Uri.parse(`ruth://source-viewer/${viewerCounter}`),
        );
        editor.setModel(model);
        if (line !== null) {
          editor.setPosition?.({ lineNumber: line, column: 1 });
          editor.revealLineInCenter?.(line);
        }
        editor.layout();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      editor?.dispose();
      model?.dispose();
    };
  }, [text, rel, line, prefs, loader]);

  return failed ? (
    <pre className="source-viewer-text">{text}</pre>
  ) : (
    <div ref={containerRef} className="source-viewer-code" aria-label={`Source of ${rel}`} />
  );
}

interface SourceViewerProps {
  title: string;
  tabs: SourceTab[];
  initialKey: string;
  readFile: (rootId: string, rel: string) => Promise<{ text: string }>;
  onOpenCode?: (rootId: string, rel: string, line: number) => void;
  onClose: () => void;
  prefs?: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
}

type Loaded =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "error"; message: string };

export function SourceViewer({
  title,
  tabs,
  initialKey,
  readFile,
  onOpenCode,
  onClose,
  prefs = DEFAULT_CODE_EDITOR_PREFS,
  loader = loadMonaco,
}: SourceViewerProps) {
  const [activeKey, setActiveKey] = useState(initialKey);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const readRef = useRef(readFile);
  readRef.current = readFile;

  useEffect(() => {
    const opener = document.activeElement;
    closeRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    let stale = false;
    if (active.proposed !== null) {
      setLoaded({ status: "ready", text: active.proposed });
      return;
    }
    if (active.missing) {
      setLoaded({ status: "error", message: `${active.rel} was not found.` });
      return;
    }
    setLoaded({ status: "loading" });
    readRef.current(active.rootId, active.rel).then(
      (file) => {
        if (!stale) setLoaded({ status: "ready", text: file.text });
      },
      (raw) => {
        if (!stale) setLoaded({ status: "error", message: normalizeCodeError(raw).message });
      },
    );
    return () => {
      stale = true;
    };
  }, [active.key, active.rootId, active.rel, active.proposed, active.missing]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])];
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first === undefined || last === undefined) return;
    const leaving = event.shiftKey
      ? document.activeElement === first
      : document.activeElement === last;
    const inside = dialogRef.current?.contains(document.activeElement) ?? false;
    if (leaving || !inside) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="modal wide source-viewer"
        role="dialog"
        aria-modal="true"
        aria-label={`Source of ${title}`}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <h3>{title}</h3>
          <div className="button-row">
            {onOpenCode !== undefined && active.proposed === null && !active.missing && (
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  onOpenCode(active.rootId, active.rel, active.line ?? 1);
                  onClose();
                }}
              >
                Open in code
              </button>
            )}
            <button ref={closeRef} type="button" className="secondary small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div className="source-viewer-tabs" role="tablist" aria-label="Files">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={tab.key === active.key}
              className={tab.key === active.key ? "active" : ""}
              title={tab.rel}
              onClick={() => setActiveKey(tab.key)}
            >
              {tab.label}
              {tab.missing ? " (not found)" : ""}
            </button>
          ))}
        </div>
        <p className="hint source-viewer-path" title={active.rel}>
          {active.rel}
          {active.proposed !== null ? " · proposed by Muse, not on disk yet" : " · read only"}
        </p>
        {loaded.status === "loading" && <p className="hint">Reading the file…</p>}
        {loaded.status === "error" && (
          <p className="error" role="alert">
            {loaded.message}
          </p>
        )}
        {loaded.status === "ready" && (
          <SourceCode
            text={loaded.text}
            rel={active.rel}
            line={active.line}
            prefs={prefs}
            loader={loader}
          />
        )}
      </div>
    </div>
  );
}
