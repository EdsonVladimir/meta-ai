// Project context dialog: reviewed opt-in per project. Shows the
// architecture map (collapsible), the doc checklist with sizes, the
// totals against the limits, and the warning that chosen files go to
// Meta as they are. "Use this context" enables it for the project; a
// switch turns it off. Nothing is sent from here: the context travels
// only inside a message the person sends.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodeFileDto, CodeListingDto, CodeRootDto } from "../code/types";
import type { MuseContextChoice } from "../requirements/uiStore";
import {
  detectedForRoots,
  mapSectionsForRoots,
  MAP_SUMMARY_MAX_CHARS,
  renderRootSummary,
} from "./mapSummary";
import { formatDocSize, scanContextDocs, type ContextDocSuggestions } from "./contextDocs";

/** Mirror of MAX_CONTEXT_DOCS in ruth-meta: docs sent per message. */
export const CONTEXT_DOCS_SEND_MAX = 8;
/** Mirror of MAX_CONTEXT_DOCS_CHARS in ruth-meta. */
const CONTEXT_DOCS_CHARS_MAX = 24_000;

export interface MuseContextDialogApi {
  listDir: (rootId: string, rel: string) => Promise<CodeListingDto>;
  readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
}

interface MuseContextDialogProps {
  /** Active project roots (blocked and missing ones are skipped). */
  roots: CodeRootDto[];
  choice: MuseContextChoice | null;
  api: MuseContextDialogApi;
  onSave: (choice: MuseContextChoice) => void;
  onClose: () => void;
}

type ScanState =
  | { status: "loading" }
  | { status: "ready"; result: ContextDocSuggestions }
  | { status: "error"; message: string };

function docKey(rootId: string, rel: string): string {
  return `${rootId}::${rel}`;
}

export function MuseContextDialog({ roots, choice, api, onSave, onClose }: MuseContextDialogProps) {
  const [scan, setScan] = useState<ScanState>({ status: "loading" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [showMap, setShowMap] = useState(false);
  const [enabled, setEnabled] = useState(choice?.enabled ?? false);
  const initialized = useRef(false);
  const rootsSig = roots.map((root) => root.id).join(",");
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let stale = false;
    setScan({ status: "loading" });
    void scanContextDocs(roots, apiRef.current).then(
      (result) => {
        if (!stale) setScan({ status: "ready", result });
      },
      (raw: unknown) => {
        if (!stale) {
          setScan({
            status: "error",
            message: raw instanceof Error ? raw.message : "Could not list docs.",
          });
        }
      },
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsSig]);

  // Escape closes without saving.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const suggestions = scan.status === "ready" ? scan.result.suggestions : [];
  useEffect(() => {
    if (scan.status !== "ready" || initialized.current) return;
    initialized.current = true;
    // An enabled choice with no docs is a decision, not an empty state.
    if (choice !== null && (choice.enabled || choice.docs.length > 0)) {
      const wanted = new Set(choice.docs.map((doc) => docKey(doc.rootId, doc.rel)));
      setChecked(
        new Set(
          scan.result.suggestions
            .filter((item) => wanted.has(docKey(item.rootId, item.rel)))
            .map((item) => docKey(item.rootId, item.rel)),
        ),
      );
    } else {
      setChecked(
        new Set(scan.result.defaultSelected.map((item) => docKey(item.rootId, item.rel))),
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan]);

  const mapTexts = useMemo(() => {
    const ids = roots.filter((root) => !root.missing && !root.aiBlocked).map((root) => root.id);
    const sections = mapSectionsForRoots(ids);
    const detected = detectedForRoots(ids);
    const analyzed = new Set(sections.map((section) => section.key));
    const out: Array<{ rootId: string; text: string }> = [];
    for (const root of roots) {
      if (root.missing || root.aiBlocked) continue;
      const own = sections.filter((section) => section.rootId === root.id);
      if (own.length === 0) continue;
      const unanalyzed = detected
        .filter((service) => service.rootId === root.id && !analyzed.has(service.key))
        .map((service) => service.name);
      const text = renderRootSummary({ id: root.id, name: root.name }, own, unanalyzed);
      if (text !== "") out.push({ rootId: root.id, text });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootsSig]);
  const mapChars = mapTexts.reduce((n, item) => n + item.text.length, 0);

  const checkedDocs = suggestions.filter((item) => checked.has(docKey(item.rootId, item.rel)));
  const sentDocs = checkedDocs.slice(0, CONTEXT_DOCS_SEND_MAX);
  const sentChars = sentDocs.reduce((n, item) => n + (item.size ?? 0), 0);
  const rootNames = Object.fromEntries(roots.map((root) => [root.id, root.name]));
  const multiRoot = roots.length > 1;
  const number = (n: number): string => n.toLocaleString("en-US");

  function toggle(rootId: string, rel: string): void {
    const key = docKey(rootId, rel);
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  function useThisContext(): void {
    onSave({
      enabled: true,
      dismissed: false,
      docs: checkedDocs.map((item) => ({ rootId: item.rootId, rel: item.rel })),
    });
    onClose();
  }

  function flipEnabled(): void {
    const next = !enabled;
    setEnabled(next);
    onSave({
      enabled: next,
      dismissed: !next,
      docs: checkedDocs.map((item) => ({ rootId: item.rootId, rel: item.rel })),
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Project context"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Project context</h3>
          <button
            type="button"
            className="secondary small"
            onClick={onClose}
            aria-label="Close project context"
          >
            ✕
          </button>
        </div>
        <p className="hint">
          {mapTexts.length === 0
            ? "Map: empty (no analyzed service yet)."
            : `Map: ${mapTexts.length} ${mapTexts.length === 1 ? "section" : "sections"}, ${number(mapChars)} chars.`}{" "}
          <button type="button" className="secondary small" onClick={() => setShowMap((v) => !v)}>
            {showMap ? "Hide map" : "Show map"}
          </button>
        </p>
        {showMap && mapTexts.length > 0 && (
          <pre className="muse-context-map">
            {mapTexts.map((item) => item.text).join("\n\n")}
          </pre>
        )}
        {scan.status === "loading" && <p className="hint">Looking for docs…</p>}
        {scan.status === "error" && (
          <p className="error" role="alert">
            {scan.message}
          </p>
        )}
        {scan.status === "ready" && suggestions.length === 0 && (
          <p className="hint">No docs found in this project.</p>
        )}
        {suggestions.length > 0 && (
          <ul className="muse-context-docs" aria-label="Context docs">
            {suggestions.map((item) => (
              <li key={docKey(item.rootId, item.rel)}>
                <label title={item.rel}>
                  <input
                    type="checkbox"
                    checked={checked.has(docKey(item.rootId, item.rel))}
                    onChange={() => toggle(item.rootId, item.rel)}
                  />
                  {multiRoot ? `${rootNames[item.rootId] ?? item.rootId}/${item.rel}` : item.rel}
                  <span className="hint"> · {formatDocSize(item.size)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {`Map ${number(mapChars)} of ${number(MAP_SUMMARY_MAX_CHARS)} chars · Docs ${checkedDocs.length} chosen · ${sentDocs.length} of ${CONTEXT_DOCS_SEND_MAX} sent${checkedDocs.length > CONTEXT_DOCS_SEND_MAX ? " (limit)" : ""} · ≈${number(sentChars)} of ${number(CONTEXT_DOCS_CHARS_MAX)} chars`}
        </p>
        <p className="hint">
          Chosen files go to Meta as they are. Nothing is sent until you send a message.
        </p>
        <div className="button-row">
          <span className="hint">Project context</span>
          <button
            type="button"
            className="secondary small"
            role="switch"
            aria-checked={enabled}
            onClick={flipEnabled}
          >
            {enabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            className="primary"
            disabled={scan.status === "loading"}
            onClick={useThisContext}
          >
            Use this context
          </button>
        </div>
      </div>
    </div>
  );
}
