// Disk/draft comparison with the real Monaco diff (read-only). When
// Monaco fails to load, the text comparison is kept.
import { useEffect, useRef, useState } from "react";
import type { CodeEditorPrefs } from "./editorPrefs";
import {
  ensureRuthMonacoTheme,
  monacoDiffOptions,
  monacoDiffUpdate,
} from "./monacoTheme";
import { loadMonaco, type MonacoApi } from "./monacoLoader";

type DiffEditor = ReturnType<MonacoApi["editor"]["createDiffEditor"]>;
type TextModel = ReturnType<MonacoApi["editor"]["createModel"]>;

let conflictCounter = 0;

interface CodeConflictDiffProps {
  diskText: string;
  draftText: string;
  language: string;
  prefs: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
}

export function CodeConflictDiff({
  diskText,
  draftText,
  language,
  prefs,
  loader,
}: CodeConflictDiffProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const apiRef = useRef<MonacoApi | null>(null);
  const diffRef = useRef<DiffEditor | null>(null);
  const modelsRef = useRef<{ original: TextModel; modified: TextModel } | null>(null);
  const appliedRef = useRef({ diskText, draftText, language });
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const textsRef = useRef({ diskText, draftText, language });
  textsRef.current = { diskText, draftText, language };
  const idRef = useRef(0);
  if (idRef.current === 0) {
    conflictCounter += 1;
    idRef.current = conflictCounter;
  }
  const load = loader ?? loadMonaco;

  useEffect(() => {
    let cancelled = false;
    let diff: DiffEditor | null = null;
    let models: { original: TextModel; modified: TextModel } | null = null;
    void (async () => {
      try {
        const api = await load();
        if (cancelled || containerRef.current === null) return;
        if (typeof api.editor.createDiffEditor !== "function") {
          if (!cancelled) setStatus("failed");
          return;
        }
        ensureRuthMonacoTheme(api);
        apiRef.current = api;
        const { diskText: disk, draftText: draft, language: lang } = textsRef.current;
        diff = api.editor.createDiffEditor(
          containerRef.current,
          monacoDiffOptions(prefsRef.current),
        );
        models = {
          original: api.editor.createModel(
            disk,
            lang,
            api.Uri.parse(`ruth://conflict/${idRef.current}/disk`),
          ),
          modified: api.editor.createModel(
            draft,
            lang,
            api.Uri.parse(`ruth://conflict/${idRef.current}/draft`),
          ),
        };
        appliedRef.current = { diskText: disk, draftText: draft, language: lang };
        diff.setModel({ original: models.original, modified: models.modified });
        try {
          await diff.revealFirstDiff();
        } catch {
          // Without a visible first diff: the comparison stays valid.
        }
        diff.layout();
        diffRef.current = diff;
        modelsRef.current = models;
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      try {
        diff?.setModel(null);
      } catch {
        // Tolerant cleanup.
      }
      models?.original.dispose();
      models?.modified.dispose();
      diff?.dispose();
      apiRef.current = null;
      diffRef.current = null;
      modelsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live conflict texts (the draft may keep changing).
  useEffect(() => {
    const models = modelsRef.current;
    if (status !== "ready" || models === null) return;
    const applied = appliedRef.current;
    if (applied.diskText !== diskText) {
      models.original.setValue(diskText);
      applied.diskText = diskText;
    }
    if (applied.draftText !== draftText) {
      models.modified.setValue(draftText);
      applied.draftText = draftText;
    }
    if (applied.language !== language) {
      const api = apiRef.current;
      if (api !== null) {
        api.editor.setModelLanguage(models.original, language);
        api.editor.setModelLanguage(models.modified, language);
      }
      applied.language = language;
    }
  }, [status, diskText, draftText, language]);

  // Layout and hot fit.
  useEffect(() => {
    if (status !== "ready") return;
    diffRef.current?.updateOptions(monacoDiffUpdate(prefs));
    diffRef.current?.layout();
  }, [status, prefs]);

  if (status === "failed") {
    return (
      <div className="code-compare">
        <div>
          <h4>On disk</h4>
          <pre className="code-pre small">{diskText}</pre>
        </div>
        <div>
          <h4>Your draft</h4>
          <pre className="code-pre small">{draftText}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="code-diff-wrap">
      {status === "loading" && <p className="hint">Loading comparison…</p>}
      <div
        ref={containerRef}
        className="code-diff"
        role="img"
        aria-label="Comparison between the disk and your draft"
      />
    </div>
  );
}
