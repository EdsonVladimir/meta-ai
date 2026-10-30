// Module requirement↔code traceability: which artifact uses which code
// and what stays unlinked, ONLY with explicit links (manual and detected
// with evidence). Nothing is inferred: “unlinked” means neither extra nor
// missing. Unlinked code covers saved snapshots only, never the whole
// repository (that cannot be claimed).

import { useEffect, useMemo, useRef, useState } from "react";
import { useRequirementsUi } from "../requirements/uiStore";
import type { ArtifactDto } from "../requirements/types";
import { listModules, listRequirements } from "../requirements/client";
import { listArtifacts } from "../design/client";
import { fnv1aHex } from "../code/model";
import {
  getSnapshot,
  listCodeRoots,
  listProjectLinks,
  listSnapshots,
  normalizeCodeError,
  readCodeFile,
} from "../code/client";
import type {
  CodeLinkDto,
  CodeRootDto,
  ProjectCodeLinksDto,
  SnapshotMetaDto,
} from "../code/types";
import type { StructureResult } from "../code/structure/structureTypes";
import {
  ARTIFACT_KIND_LABELS,
  MAX_LINK_VERIFY,
  linkCheckLabel,
  type LinkCheck,
} from "../code/structure/ProjectCodePanel";
import { buildTraceModel, type TraceModel } from "./traceModel";

export interface TraceApi {
  listModuleArtifacts: (projectId: string, moduleId: string) => Promise<ArtifactDto[]>;
  listProjectLinks: (projectId: string) => Promise<ProjectCodeLinksDto>;
  listSnapshots: (projectId: string) => Promise<SnapshotMetaDto[]>;
  getSnapshot: (id: string) => Promise<{ meta: SnapshotMetaDto; result: StructureResult }>;
  listRoots: () => Promise<CodeRootDto[]>;
  readFileText: (rootId: string, rel: string) => Promise<string>;
  listModules: (projectId: string) => Promise<{ id: string; name: string }[]>;
}

export const realTraceApi: TraceApi = {
  listModuleArtifacts: async (projectId, moduleId) => {
    const [requirements, artifacts] = await Promise.all([
      listRequirements(projectId, moduleId),
      listArtifacts(projectId, moduleId),
    ]);
    const seen = new Set<string>();
    return [...requirements, ...artifacts].filter((artifact) =>
      seen.has(artifact.id) ? false : (seen.add(artifact.id), true),
    );
  },
  listProjectLinks: (projectId) => listProjectLinks(projectId),
  listSnapshots: (projectId) => listSnapshots(projectId),
  getSnapshot: (id) => getSnapshot(id),
  listRoots: () => listCodeRoots(),
  readFileText: async (rootId, rel) => (await readCodeFile(rootId, rel)).text,
  listModules: (projectId) => listModules(projectId),
};

function kindLabel(kind: string): string {
  return ARTIFACT_KIND_LABELS[kind] ?? kind;
}

function linkKindLabel(kind: CodeLinkDto["kind"]): string {
  if (kind === "manual") return "manual";
  if (kind === "detected") return "detected";
  return "inferred";
}

interface TraceViewProps {
  projectId: string;
  moduleId: string;
  moduleName: string | null;
  onOpenArtifact?: (artifact: ArtifactDto) => void;
  api?: TraceApi;
}

export function TraceView({ projectId, moduleId, moduleName, onOpenArtifact, api }: TraceViewProps) {
  const backend = api ?? realTraceApi;
  const libraryToken = useRequirementsUi((s) => s.codeLibraryToken);
  const [model, setModel] = useState<TraceModel | null>(null);
  const [rootNames, setRootNames] = useState<Record<string, string>>({});
  const [missingRoots, setMissingRoots] = useState<Set<string>>(new Set());
  const [moduleNames, setModuleNames] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, LinkCheck>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapWarning, setSnapWarning] = useState<string | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    const epoch = ++epochRef.current;
    setLoading(true);
    setError(null);
    setSnapWarning(null);
    setModel(null);
    setChecks({});
    void (async () => {
      try {
        const [artifacts, links, snapshots, roots, modules] = await Promise.all([
          backend.listModuleArtifacts(projectId, moduleId),
          backend.listProjectLinks(projectId),
          backend.listSnapshots(projectId),
          backend.listRoots(),
          backend.listModules(projectId),
        ]);
        if (epochRef.current !== epoch) return;
        // Symbols from every snapshot; when one fails, warn and continue
        // with the rest (nothing is invented).
        const harvested = await Promise.allSettled(
          snapshots.map(async (meta) => {
            const full = await backend.getSnapshot(meta.id);
            return full.result.symbols.map((symbol) => ({
              id: symbol.id,
              name: symbol.name,
              kind: symbol.kind,
              rootId: symbol.rootId,
              rel: symbol.rel,
              snapshotId: meta.id,
              snapshotName: meta.name,
            }));
          }),
        );
        if (epochRef.current !== epoch) return;
        const failed = harvested.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          setSnapWarning(
            `${failed} snapshot${failed === 1 ? "" : "s"} could not be read: their code is missing from “unlinked”.`,
          );
        }
        const symbols = harvested.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
        setModel(
          buildTraceModel({
            moduleArtifacts: artifacts,
            moduleId,
            projectModuleLinks: links.moduleLinks,
            projectArtifactLinks: links.artifactLinks,
            snapshotSymbols: symbols,
          }),
        );
        setRootNames(Object.fromEntries(roots.map((root) => [root.id, root.name])));
        setMissingRoots(new Set(roots.filter((root) => root.missing).map((root) => root.id)));
        setModuleNames(Object.fromEntries(modules.map((m) => [m.id, m.name])));
        // Freshness of links with evidence (bounded, computed). Module
        // links carry no hash: never verified.
        const checkable = links.artifactLinks
          .filter((link) => link.symbol !== null)
          .slice(0, MAX_LINK_VERIFY);
        setChecks(
          Object.fromEntries(checkable.map((link) => [link.id, { state: "checking" as const }])),
        );
        for (const link of checkable) {
          try {
            const text = await backend.readFileText(link.rootId, link.rel);
            if (epochRef.current !== epoch) return;
            const fresh = link.symbol !== null && fnv1aHex(text) === link.symbol.hash;
            setChecks((prev) => ({ ...prev, [link.id]: { state: fresh ? "fresh" : "stale" } }));
          } catch (raw) {
            if (epochRef.current !== epoch) return;
            setChecks((prev) => ({
              ...prev,
              [link.id]: { state: "unreadable", message: normalizeCodeError(raw).message },
            }));
          }
        }
      } catch (raw) {
        if (epochRef.current !== epoch) return;
        setError(normalizeCodeError(raw).message);
      } finally {
        if (epochRef.current === epoch) setLoading(false);
      }
    })();
  }, [backend, projectId, moduleId, libraryToken]);

  const moduleLabel = useMemo(
    () => moduleName ?? moduleNames[moduleId] ?? moduleId,
    [moduleName, moduleNames, moduleId],
  );

  function handleOpenFile(rootId: string, rel: string) {
    useRequirementsUi.getState().requestCodeOpen(rootId, rel);
  }

  return (
    <div className="trace-view">
      <div className="panel-head">
        <h2>Traceability · {moduleLabel}</h2>
      </div>
      <p className="hint">
        Explicit links only: manual and detected with evidence. “Unlinked”
        means neither extra nor missing. Unlinked code covers saved
        snapshots only, not the whole repository.

      </p>
      {loading && <p className="hint">Loading traceability…</p>}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {snapWarning !== null && (
        <p className="notice" role="note">
          {snapWarning}
        </p>
      )}
      {model !== null && (
        <>
          <p className="hint" aria-label="Resumen de cobertura">
            {model.counts.artifacts} artifact{model.counts.artifacts === 1 ? "" : "s"} ·{" "}
            {model.counts.linkedArtifacts} linked · {model.counts.artifactLinks} link
            {model.counts.artifactLinks === 1 ? "" : "s"} · {model.counts.moduleLinks} module
            · {model.counts.orphanSymbols} unlinked symbol
            {model.counts.orphanSymbols === 1 ? "" : "s"}
          </p>

          {model.moduleLinks.length > 0 && (
            <section aria-label="Module links">
              <h3>Module links</h3>
              <ul className="pick-list">
                {model.moduleLinks.map((link) => (
                  <li key={link.id}>
                    <span title={`${link.rootName ?? link.rootId} / ${link.rel}`}>
                      <code>{link.rootName ?? link.rootId}</code>/{link.rel}
                    </span>{" "}
                    <span className="hint">{linkKindLabel(link.kind)}</span>
                    {link.rootMissing && <span className="hint"> · missing folder</span>}
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary small"
                        disabled={link.rootMissing}
                        onClick={() => handleOpenFile(link.rootId, link.rel)}
                      >
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model.linked.length > 0 && (
            <section aria-label="Linked artifacts">
              <h3>Linked artifacts</h3>
              <ul className="pick-list">
                {model.linked.map((row) => (
                  <li key={row.artifact.id}>
                    <span>
                      [{kindLabel(row.artifact.kind)}] <strong>{row.label}</strong>
                      {row.artifact.archived && <span className="hint"> (archived)</span>}
                    </span>
                    <ul className="struct-rel-list">
                      {row.links.map((link) => (
                        <li key={link.id}>
                          <span
                            title={`${link.rootName ?? link.rootId} / ${link.rel}${link.symbol !== null ? ` · ${link.symbol.name} (lines ${link.symbol.startLine}–${link.symbol.endLine})` : ""}`}
                          >
                            <code>{link.rootName ?? link.rootId}</code>/{link.rel}
                            {link.symbol !== null && (
                              <>
                                {" "}
                                <code>{link.symbol.name}</code>
                              </>
                            )}
                          </span>{" "}
                          <span className="hint">
                            {linkKindLabel(link.kind)}
                            {linkCheckLabel(checks[link.id] ?? { state: "unchecked" })}
                          </span>
                          {link.rootMissing && <span className="hint"> · missing folder</span>}
                          <div className="button-row">
                            <button
                              type="button"
                              className="secondary small"
                              disabled={link.rootMissing}
                              title={
                                link.rootMissing
                                  ? "The folder is no longer in the workspace"
                                  : "Open in the code view"
                              }
                              onClick={() => handleOpenFile(link.rootId, link.rel)}
                            >
                              Open
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {onOpenArtifact !== undefined && (
                      <div className="button-row">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => onOpenArtifact(row.artifact)}
                        >
                          View {kindLabel(row.artifact.kind)}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {model.unlinkedArtifacts.length > 0 && (
            <section aria-label="Unlinked artifacts">
              <h3>Unlinked artifacts</h3>
              <p className="hint">
                No linked code yet: link the active tab to the module or a
                symbol from Structure.
              </p>
              <ul className="pick-list">
                {model.unlinkedArtifacts.map((artifact) => (
                  <li key={artifact.id}>
                    <span>
                      [{kindLabel(artifact.kind)}] {artifact.title ?? artifact.id}
                      {artifact.archived && <span className="hint"> (archived)</span>}
                    </span>
                    {onOpenArtifact !== undefined && (
                      <div className="button-row">
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => onOpenArtifact(artifact)}
                        >
                          View {kindLabel(artifact.kind)}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Unlinked code">
            <h3>Unlinked code</h3>
            {model.orphanSymbols.length === 0 ? (
              <p className="hint">
                Nothing pending in the saved snapshots. It only covers what
                was analyzed and saved: analyze in Structure and save a
                snapshot to widen.
              </p>
            ) : (
              <>
                <p className="hint">
                  Symbols detected in snapshots with no linked artifact in
                  the project. To link them, analyze them in Structure (links
                  with fresh evidence can be made there).
                </p>
                {model.orphansTruncated && (
                  <p className="notice" role="note">
                    Truncated list: showing {model.orphanSymbols.length} of{" "}
                    {model.counts.orphanSymbols}. Link or narrow to see the rest.
                  </p>
                )}
                <ul className="pick-list">
                  {model.orphanSymbols.map((symbol) => (
                    <li key={symbol.id}>
                      <span
                        title={`${rootNames[symbol.rootId] ?? symbol.rootId} / ${symbol.rel} · snapshot ${symbol.snapshotName}`}
                      >
                        <code>{symbol.name}</code> ({symbol.kind}) ·{" "}
                        {rootNames[symbol.rootId] ?? symbol.rootId}/{symbol.rel}
                      </span>
                      {missingRoots.has(symbol.rootId) && (
                        <span className="hint"> · missing folder</span>
                      )}
                      <div className="button-row">
                        <button
                          type="button"
                          className="secondary small"
                          disabled={missingRoots.has(symbol.rootId)}
                          title={
                            missingRoots.has(symbol.rootId)
                              ? "The folder is no longer in the workspace"
                              : "Open the file (no jump: the saved range may be stale)"
                          }
                          onClick={() => handleOpenFile(symbol.rootId, symbol.rel)}
                        >
                          Open file
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {model.counts.artifacts === 0 && model.counts.orphanSymbols === 0 && (
            <p className="hint">
              The module has no artifacts and no symbols are saved. Create a
              requirement or analyze code in Structure to start.
            </p>
          )}
        </>
      )}
    </div>
  );
}
