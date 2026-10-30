// Structure view: explicit scope, on-demand analysis and a
// semantic-read-only diagram. Unverified items are not drawn: they
// live in the inspector as unresolved.
import { Suspense, lazy, useMemo, useRef, useState } from "react";
import { fnv1aHex } from "../model";
import { verifyAnalyzedHash } from "./verifiedOpen";
import { analyzeRust as analyzeRustCommand, normalizeCodeError, readCodeFile } from "../client";
import type { CodeTab } from "../types";
import { defaultAnalyzeTs } from "./tsWorkerClient";
import { combineResults } from "./structureMerge";
import { ApiPanel } from "./ApiPanel";
import { DataPanel } from "./DataPanel";
import { CodeProposalDialog } from "./CodeProposalDialog";
import { ProjectCodePanel, type ProjectCodeApi } from "./ProjectCodePanel";
import type { CodeEditorPrefs } from "../editorPrefs";
import type { MonacoApi } from "../monacoLoader";
import { STRUCTURE_LIMITS } from "./structureTypes";
import type {
  StructureInput,
  StructureKind,
  StructureRange,
  StructureResult,
} from "./structureTypes";

const StructureGraph = lazy(() =>
  import("./StructureGraph").then((module) => ({ default: module.StructureGraph })),
);

export interface ScopeFile {
  rootId: string;
  rel: string;
}

export function scopeKey(file: ScopeFile): string {
  return `${file.rootId}::${file.rel}`;
}

const ALL_KINDS: StructureKind[] = [
  "class",
  "interface",
  "struct",
  "enum",
  "trait",
  "function",
  "component",
];

const KIND_LABELS: Record<StructureKind, string> = {
  class: "Classes",
  interface: "Interfaces",
  struct: "Structs",
  enum: "Enums",
  trait: "Traits",
  function: "Functions",
  component: "Components",
};

interface StructureViewProps {
  scope: ScopeFile[];
  rootNames: Record<string, string>;
  onRemoveScope: (key: string) => void;
  onAddActiveFile: () => void;
  onAddActiveFolder: () => void;
  tabs: CodeTab[];
  onOpenFile: (rootId: string, rel: string, range: StructureRange | null) => void;
  analyzeTs?: (files: StructureInput[]) => Promise<StructureResult>;
  analyzeRust?: (files: ScopeFile[]) => Promise<StructureResult>;
  /** Selected project/module (links and snapshots). */
  projectId?: string | null;
  moduleId?: string | null;
  projectApi?: ProjectCodeApi;
  /** Accept wrote to disk: clean reload and tree refresh. */
  onFileChanged?: (rootId: string, rel: string) => void;
  /** Preferences and loader for the proposal diff. */
  prefs?: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
}

export function StructureView({
  scope,
  rootNames,
  onRemoveScope,
  onAddActiveFile,
  onAddActiveFolder,
  tabs,
  onOpenFile,
  analyzeTs,
  analyzeRust,
  projectId,
  moduleId,
  projectApi,
  onFileChanged,
  prefs,
  loader,
}: StructureViewProps) {
  const [result, setResult] = useState<StructureResult | null>(null);
  const [tab, setTab] = useState<"classes" | "data" | "apis">("classes");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalBaseline, setProposalBaseline] = useState<StructureResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<StructureKind>>(new Set(ALL_KINDS));
  const [query, setQuery] = useState("");
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const epochRef = useRef(0);
  const analyzeTsRef = useRef(analyzeTs ?? defaultAnalyzeTs);
  analyzeTsRef.current = analyzeTs ?? defaultAnalyzeTs;
  const analyzeRustRef = useRef(analyzeRust ?? analyzeRustCommand);
  analyzeRustRef.current = analyzeRust ?? analyzeRustCommand;

  const dirtyScope = useMemo(() => {
    const dirty = new Set(tabs.filter((tab) => tab.dirty).map((tab) => `${tab.rootId}::${tab.rel}`));
    return scope.filter((file) => dirty.has(scopeKey(file)));
  }, [scope, tabs]);

  async function handleAnalyze() {
    const epoch = ++epochRef.current;
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    setStale(false);
    setSelectedId(null);
    try {
      // Reading of the SAVED version (the draft is warned, not analyzed).
      const inputs: StructureInput[] = [];
      const readErrors: StructureResult["files"] = [];
      for (const file of scope.slice(0, STRUCTURE_LIMITS.maxFiles)) {
        try {
          const content = await readCodeFile(file.rootId, file.rel);
          inputs.push({
            rootId: file.rootId,
            rel: file.rel,
            content: content.text,
            hash: fnv1aHex(content.text),
          });
        } catch (raw) {
          readErrors.push({
            rootId: file.rootId,
            rel: file.rel,
            hash: "",
            bytes: 0,
            language: null,
            status: "error",
            message: normalizeCodeError(raw).message,
          });
        }
      }
      const tsInputs = inputs.filter((file) => !file.rel.toLowerCase().endsWith(".rs"));
      const rustScope = inputs
        .filter((file) => file.rel.toLowerCase().endsWith(".rs"))
        .map((file) => ({ rootId: file.rootId, rel: file.rel }));
      const [tsResult, rustResult] = await Promise.all([
        tsInputs.length > 0 ? analyzeTsRef.current(tsInputs) : combineResults([]),
        // Rust is analyzed in the command (it reads the saved version
        // with the same root and path; readability was verified here).
        rustScope.length > 0 ? analyzeRustRef.current(rustScope) : combineResults([]),
      ]);
      if (epochRef.current !== epoch) return;
      setResult(
        combineResults([
          tsResult,
          rustResult,
          {
            files: readErrors,
            symbols: [],
            relations: [],
            endpoints: [],
            calls: [],
            symbolsTruncated: false,
            relationsTruncated: false,
            endpointsTruncated: false,
            callsTruncated: false,
            limits: STRUCTURE_LIMITS,
          },
        ]),
      );
    } catch (raw) {
      if (epochRef.current !== epoch) return;
      setError(normalizeCodeError(raw).message);
    } finally {
      if (epochRef.current === epoch) setAnalyzing(false);
    }
  }

  const visibleIds = useMemo(() => {
    if (result === null) return new Set<string>();
    const needle = query.trim().toLowerCase();
    return new Set(
      result.symbols
        .filter((symbol) => kinds.has(symbol.kind))
        .filter((symbol) => needle === "" || symbol.name.toLowerCase().includes(needle))
        .map((symbol) => symbol.id),
    );
  }, [result, kinds, query]);

  const selected =
    result === null || selectedId === null
      ? null
      : (result.symbols.find((symbol) => symbol.id === selectedId) ?? null);
  const selectedOut = result === null ? [] : result.relations.filter((rel) => rel.from === selectedId);
  const selectedIn = result === null ? [] : result.relations.filter((rel) => rel.to === selectedId);

  /** Navigate verifying the fingerprint: old ranges are unused. */
  async function openSymbol(rootId: string, rel: string, range: StructureRange, hash: string) {
    setNotice(null);
    const outcome = await verifyAnalyzedHash(readCodeFile, rootId, rel, hash);
    if (outcome === "match") {
      onOpenFile(rootId, rel, range);
      return;
    }
    if (outcome === "changed") {
      setStale(true);
      setNotice(
        "The file changed since the analysis: it opens without jumping to the range. Recalculate to update.",
      );
    } else {
      setNotice("Could not reread the file to verify; it opens without jumping to the range.");
    }
    onOpenFile(rootId, rel, null);
  }

  function toggleKind(kind: StructureKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  const analyzedHash = (rootId: string, rel: string): string =>
    result?.files.find((file) => file.rootId === rootId && file.rel === rel)?.hash ?? "";

  return (
    <div className="structure-view">
      <div className="structure-main">
        <div className="structure-toolbar">
          <button
            type="button"
            className="primary small"
            onClick={() => void handleAnalyze()}
            disabled={analyzing || scope.length === 0}
            title="Analyze the scope files (saved content)"
          >
            {analyzing ? "Analyzing…" : "Analyze selection"}
          </button>
          <button
            type="button"
            className="secondary small"
            disabled={
              projectId == null || moduleId == null || scope.length === 0 || prefs === undefined
            }
            title={
              projectId == null || moduleId == null
                ? "Select a project and a module to propose code"
                : scope.length === 0
                  ? "Add scope to propose code"
                  : "Propose code from a requirement and the scope"
            }
            onClick={() => {
              setProposalBaseline(result);
              setProposalOpen(true);
            }}
          >
            Propose code
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={onAddActiveFile}
            title="Add the active tab to the scope"
          >
            + Current file
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={onAddActiveFolder}
            title="Add the analyzable files of the active-tab folder (direct children only)"
          >
            + Active folder
          </button>
          <span className="hint">
            {scope.length} file{scope.length === 1 ? "" : "s"} (max {STRUCTURE_LIMITS.maxFiles})
          </span>
        </div>
        {scope.length === 0 && (
          <ol className="hint struct-guide">
            <li>
              Add scope: "+ Current file", "+ Active folder" or "Add to the
              analysis" in the tree (.ts/.tsx/.rs files or folders).
            </li>
            <li>
              Press "Analyze selection": class diagram, detected data and API joins.
            </li>
            <li>
              Press a symbol to open its code. Only the chosen files are analyzed;
              never the whole repository.
            </li>
          </ol>
        )}
        {dirtyScope.length > 0 && (
          <p className="notice" role="note">
            {dirtyScope.length} file{dirtyScope.length === 1 ? "" : "s"} with unsaved
            changes: the on-disk saved version is analyzed, not the draft.
          </p>
        )}
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="notice" role="note">
            {notice}
          </p>
        )}
        {stale && (
          <p className="notice" role="note">
            Stale result: some file changed since the analysis.{" "}
            <button type="button" className="secondary small" onClick={() => void handleAnalyze()}>
              Recalculate
            </button>
          </p>
        )}
        {result !== null && (
          <>
            <div className="struct-tabs" role="tablist" aria-label="Analysis views">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "classes"}
                className={tab === "classes" ? "active" : ""}
                onClick={() => setTab("classes")}
              >
                Classes
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "data"}
                className={tab === "data" ? "active" : ""}
                onClick={() => setTab("data")}
              >
                Data
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "apis"}
                className={tab === "apis" ? "active" : ""}
                onClick={() => setTab("apis")}
              >
                APIs
              </button>
            </div>
            {tab === "classes" && (
              <>
                <div className="structure-filters">
                  <label className="hint" htmlFor="struct-search">
                    Search
                  </label>
                  <input
                    id="struct-search"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Symbol name…"
                  />
                  <div className="struct-kind-filters" role="group" aria-label="Symbol kinds">
                    {ALL_KINDS.map((kind) => (
                      <label key={kind} className="struct-kind-check">
                        <input
                          type="checkbox"
                          checked={kinds.has(kind)}
                          onChange={() => toggleKind(kind)}
                        />{" "}
                        {KIND_LABELS[kind]}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="structure-graph-wrap">
                  <Suspense fallback={<p className="hint">Loading diagram…</p>}>
                    <StructureGraph
                      key={result.symbols.length + result.relations.length}
                      symbols={result.symbols}
                      relations={result.relations}
                      visibleIds={visibleIds}
                      selectedId={
                        selected !== null && visibleIds.has(selected.id) ? selected.id : null
                      }
                      onSelect={setSelectedId}
                    />
                  </Suspense>
                </div>
                <div className="struct-legend hint" aria-label="Legend">
                  <span className="legend-extends">— inherits</span>
                  <span className="legend-implements">- - implements</span>
                  <span className="legend-references">·· references</span>
                  <span>unverified items only show in the inspector</span>
                </div>
              </>
            )}
            {tab === "data" && (
              <DataPanel
                symbols={result.symbols}
                rootNames={rootNames}
                hashOf={analyzedHash}
                onOpenSymbol={(rootId, rel, range, hash) =>
                  void openSymbol(rootId, rel, range, hash)
                }
              />
            )}
            {tab === "apis" && (
              <ApiPanel
                endpoints={result.endpoints}
                calls={result.calls}
                rootNames={rootNames}
                hashOf={analyzedHash}
                onOpenPoint={(rootId, rel, range, hash) =>
                  void openSymbol(rootId, rel, range, hash)
                }
              />
            )}
            {(result.symbolsTruncated ||
              result.relationsTruncated ||
              result.endpointsTruncated ||
              result.callsTruncated) && (
              <p className="notice" role="note">
                Truncated result: showing {result.symbols.length} symbols,{" "}
                {result.relations.length} relations, {result.endpoints.length} endpoints and{" "}
                {result.calls.length} calls (caps {STRUCTURE_LIMITS.maxSymbols}/
                {STRUCTURE_LIMITS.maxRelations}/{STRUCTURE_LIMITS.maxEndpoints}/
                {STRUCTURE_LIMITS.maxCalls}). Narrow the scope to see the rest.
              </p>
            )}
          </>
        )}
      </div>
      <aside className="structure-side" aria-label="Scope and inspector">
        <div className="panel-head">
          <h2>Scope</h2>
        </div>
        <ul className="struct-scope">
          {scope.map((file) => {
            const info = result?.files.find(
              (candidate) => candidate.rootId === file.rootId && candidate.rel === file.rel,
            );
            return (
              <li key={scopeKey(file)} className="struct-scope-row">
                <span title={`${rootNames[file.rootId] ?? file.rootId} / ${file.rel}`}>
                  {file.rel}
                  {info !== undefined && info.status !== "ok" && (
                    <span className="hint">
                      {" "}
                      ({info.status === "partial" ? "partial" : info.status === "unsupported" ? "pending" : "error"})
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${file.rel} from the scope`}
                  onClick={() => onRemoveScope(scopeKey(file))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        {selected !== null && (
          <div className="struct-inspector">
            <div className="panel-head">
              <h2>Inspector</h2>
            </div>
            <p className="struct-inspector-title">
              <strong>{selected.name}</strong> · {KIND_LABELS[selected.kind].toLowerCase()} ·{" "}
              {selected.language === "ts" ? "TypeScript" : "Rust"}
            </p>
            <p className="hint">
              {selected.rel} · lines {selected.range.startLine}–{selected.range.endLine}
            </p>
            {selected.heuristic !== null && <p className="hint">⚠ {selected.heuristic}</p>}
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                void openSymbol(
                  selected.rootId,
                  selected.rel,
                  selected.range,
                  analyzedHash(selected.rootId, selected.rel),
                )
              }
            >
              Open in code
            </button>
            {selectedOut.length > 0 && (
              <>
                <h3>Relations</h3>
                <ul className="struct-rel-list">
                  {selectedOut.map((rel) => (
                    <li key={rel.id}>
                      <span className={`rel-kind k-${rel.kind}`}>{rel.kind}</span>{" "}
                      {rel.toName}{" "}
                      {rel.status === "resolved" ? (
                        <button
                          type="button"
                          className="struct-link"
                          onClick={() => setSelectedId(rel.to)}
                          title="View target symbol"
                        >
                          (view)
                        </button>
                      ) : (
                        <span className="hint">
                          ({rel.status === "ambiguous" ? "ambiguous" : "unverified"})
                        </span>
                      )}
                      <div className="hint">{rel.evidence}</div>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {selectedIn.length > 0 && (
              <>
                <h3>Referenced by</h3>
                <ul className="struct-rel-list">
                  {selectedIn.map((rel) => {
                    const from = result?.symbols.find((symbol) => symbol.id === rel.from);
                    return (
                      <li key={rel.id}>
                        <button
                          type="button"
                          className="struct-link"
                          onClick={() => setSelectedId(rel.from)}
                        >
                          {from?.name ?? rel.from}
                        </button>{" "}
                        <span className="hint">({rel.kind})</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
        <ProjectCodePanel
          projectId={projectId ?? null}
          moduleId={moduleId ?? null}
          selectedSymbol={
            selected === null
              ? null
              : {
                  id: selected.id,
                  name: selected.name,
                  kind: selected.kind,
                  rootId: selected.rootId,
                  rel: selected.rel,
                  range: selected.range,
                  hash: analyzedHash(selected.rootId, selected.rel),
                }
          }
          result={result}
          rootNames={rootNames}
          onOpenFile={(rootId, rel) => onOpenFile(rootId, rel, null)}
          api={projectApi}
        />
      </aside>
      {proposalOpen && projectId != null && moduleId != null && prefs !== undefined && (
        <CodeProposalDialog
          projectId={projectId}
          moduleId={moduleId}
          scope={scope}
          rootNames={rootNames}
          baseline={proposalBaseline}
          current={result}
          onReanalyze={() => handleAnalyze()}
          onFileAccepted={(rootId, rel) => onFileChanged?.(rootId, rel)}
          onClose={() => setProposalOpen(false)}
          prefs={prefs}
          loader={loader}
        />
      )}
    </div>
  );
}
