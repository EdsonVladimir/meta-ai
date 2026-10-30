// Detected links and project snapshots (Structure sidebar). Three
// honest sections:
// - Link symbol: the selected symbol → a module artifact. The link
//   saves range + origin hash as evidence; freshness is computed by
//   rereading the file, never with persisted flags.
// - Project links: manual and detected ones with their current state.
// - Snapshots: save the analyzed IR, list, verify and delete.
//   Snapshots are read-only: they are not loaded into the diagram.
// Without a selected project there is nothing to link or save.
import { useEffect, useRef, useState } from "react";
import { useRequirementsUi } from "../../requirements/uiStore";
import type { ArtifactDto, ModuleDto } from "../../requirements/types";
import { listModules, listRequirements } from "../../requirements/client";
import { listArtifacts } from "../../design/client";
import { fnv1aHex } from "../model";
import {
  addSymbolLink,
  deleteSnapshot,
  listProjectLinks,
  listSnapshots,
  normalizeCodeError,
  readCodeFile,
  removeCodeLink,
  saveSnapshot,
  verifySnapshot,
} from "../client";
import type {
  CodeLinkDto,
  ProjectCodeLinksDto,
  SnapshotMetaDto,
  SnapshotVerifyDto,
} from "../types";
import type { StructureRange, StructureResult } from "./structureTypes";

export interface SelectedSymbolRef {
  id: string;
  name: string;
  kind: string;
  rootId: string;
  rel: string;
  range: StructureRange;
  /** Analyzed file hash (origin evidence). */
  hash: string;
}

export interface ProjectCodeApi {
  listProjectLinks: (projectId: string) => Promise<ProjectCodeLinksDto>;
  addSymbolLink: (
    artifactId: string,
    rootId: string,
    rel: string,
    symbol: {
      id: string;
      name: string;
      kind: string;
      startLine: number;
      startCol: number;
      endLine: number;
      endCol: number;
      hash: string;
    },
  ) => Promise<CodeLinkDto>;
  removeCodeLink: (id: string) => Promise<string>;
  readFileText: (rootId: string, rel: string) => Promise<string>;
  listModules: (projectId: string) => Promise<ModuleDto[]>;
  listModuleArtifacts: (projectId: string, moduleId: string) => Promise<ArtifactDto[]>;
  saveSnapshot: (
    projectId: string | null,
    name: string,
    result: StructureResult,
  ) => Promise<SnapshotMetaDto>;
  listSnapshots: (projectId: string | null) => Promise<SnapshotMetaDto[]>;
  deleteSnapshot: (id: string) => Promise<string>;
  verifySnapshot: (id: string) => Promise<SnapshotVerifyDto>;
}

export const realProjectCodeApi: ProjectCodeApi = {
  listProjectLinks: (projectId) => listProjectLinks(projectId),
  addSymbolLink: (artifactId, rootId, rel, symbol) =>
    addSymbolLink(artifactId, rootId, rel, symbol),
  removeCodeLink: (id) => removeCodeLink(id),
  readFileText: async (rootId, rel) => (await readCodeFile(rootId, rel)).text,
  listModules: (projectId) => listModules(projectId),
  listModuleArtifacts: async (projectId, moduleId) => {
    const [requirements, artifacts] = await Promise.all([
      listRequirements(projectId, moduleId),
      listArtifacts(projectId, moduleId),
    ]);
    // No duplicates by id (both lists cover the module).
    const seen = new Set<string>();
    return [...requirements, ...artifacts].filter((artifact) =>
      seen.has(artifact.id) ? false : (seen.add(artifact.id), true),
    );
  },
  saveSnapshot: (projectId, name, result) => saveSnapshot(projectId, name, result),
  listSnapshots: (projectId) => listSnapshots(projectId),
  deleteSnapshot: (id) => deleteSnapshot(id),
  verifySnapshot: (id) => verifySnapshot(id),
};

export const ARTIFACT_KIND_LABELS: Record<string, string> = {
  requirement: "requirement",
  flow: "flow",
  data_model: "data model",
  mockup: "mockup",
};

/** Automatic link-verification cap (bounded reads). */
export const MAX_LINK_VERIFY = 50;

export type LinkCheck =
  | { state: "unchecked" }
  | { state: "checking" }
  | { state: "fresh" }
  | { state: "stale" }
  | { state: "unreadable"; message: string };

function linkKindLabel(kind: CodeLinkDto["kind"]): string {
  if (kind === "manual") return "manual";
  if (kind === "detected") return "detected";
  return "inferred";
}

export function linkCheckLabel(check: LinkCheck): string {
  if (check.state === "fresh") return "· matches the current file";
  if (check.state === "stale") return "· the file changed since the link";
  if (check.state === "checking") return "· checking…";
  if (check.state === "unreadable") return `· could not verify (${check.message})`;
  return "";
}

interface ProjectCodePanelProps {
  projectId: string | null;
  moduleId: string | null;
  selectedSymbol: SelectedSymbolRef | null;
  result: StructureResult | null;
  rootNames: Record<string, string>;
  onOpenFile: (rootId: string, rel: string) => void;
  api?: ProjectCodeApi;
}

export function ProjectCodePanel({
  projectId,
  moduleId,
  selectedSymbol,
  result,
  rootNames,
  onOpenFile,
  api,
}: ProjectCodePanelProps) {
  const backend = api ?? realProjectCodeApi;
  const [artifacts, setArtifacts] = useState<ArtifactDto[] | null>(null);
  const [artifactsError, setArtifactsError] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const [projectLinks, setProjectLinks] = useState<ProjectCodeLinksDto | null>(null);
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksError, setLinksError] = useState<string | null>(null);
  const [moduleNames, setModuleNames] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, LinkCheck>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const linksEpoch = useRef(0);
  const [linksToken, setLinksToken] = useState(0);

  const [snapshots, setSnapshots] = useState<SnapshotMetaDto[] | null>(null);
  const [snapsLoading, setSnapsLoading] = useState(false);
  const [snapsError, setSnapsError] = useState<string | null>(null);
  const [snapName, setSnapName] = useState("");
  const [snapBusy, setSnapBusy] = useState(false);
  const [verify, setVerify] = useState<
    Record<string, { busy: boolean; report: SnapshotVerifyDto | null; error: string | null }>
  >({});
  const [confirmSnap, setConfirmSnap] = useState<string | null>(null);
  const snapsEpoch = useRef(0);
  const [snapsToken, setSnapsToken] = useState(0);

  // Current-module artifacts ("link symbol" target).
  useEffect(() => {
    setArtifacts(null);
    setArtifactsError(null);
    setArtifactId("");
    if (projectId === null || moduleId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await backend.listModuleArtifacts(projectId, moduleId);
        if (cancelled) return;
        setArtifacts(next);
        if (next.length > 0) setArtifactId(next[0].id);
      } catch (raw) {
        if (cancelled) return;
        setArtifactsError(normalizeCodeError(raw).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backend, projectId, moduleId]);

  // Links + module names; bounded freshness verification.
  useEffect(() => {
    const epoch = ++linksEpoch.current;
    setProjectLinks(null);
    setLinksError(null);
    setConfirmRemove(null);
    setChecks({});
    if (projectId === null) return;
    setLinksLoading(true);
    void (async () => {
      try {
        const [links, modules] = await Promise.all([
          backend.listProjectLinks(projectId),
          backend.listModules(projectId),
        ]);
        if (linksEpoch.current !== epoch) return;
        setProjectLinks(links);
        setModuleNames(Object.fromEntries(modules.map((m) => [m.id, m.name])));
        const checkable = [...links.moduleLinks, ...links.artifactLinks]
          .filter((link) => link.symbol !== null)
          .slice(0, MAX_LINK_VERIFY);
        setChecks(
          Object.fromEntries(checkable.map((link) => [link.id, { state: "checking" as const }])),
        );
        for (const link of checkable) {
          try {
            const text = await backend.readFileText(link.rootId, link.rel);
            if (linksEpoch.current !== epoch) return;
            const fresh = link.symbol !== null && fnv1aHex(text) === link.symbol.hash;
            setChecks((prev) => ({ ...prev, [link.id]: { state: fresh ? "fresh" : "stale" } }));
          } catch (raw) {
            if (linksEpoch.current !== epoch) return;
            setChecks((prev) => ({
              ...prev,
              [link.id]: { state: "unreadable", message: normalizeCodeError(raw).message },
            }));
          }
        }
      } catch (raw) {
        if (linksEpoch.current !== epoch) return;
        setLinksError(normalizeCodeError(raw).message);
      } finally {
        if (linksEpoch.current === epoch) setLinksLoading(false);
      }
    })();
  }, [backend, projectId, linksToken]);

  // Project snapshots.
  useEffect(() => {
    const epoch = ++snapsEpoch.current;
    setSnapshots(null);
    setSnapsError(null);
    setVerify({});
    setConfirmSnap(null);
    if (projectId === null) return;
    setSnapsLoading(true);
    void (async () => {
      try {
        const next = await backend.listSnapshots(projectId);
        if (snapsEpoch.current !== epoch) return;
        setSnapshots(next);
      } catch (raw) {
        if (snapsEpoch.current !== epoch) return;
        setSnapsError(normalizeCodeError(raw).message);
      } finally {
        if (snapsEpoch.current === epoch) setSnapsLoading(false);
      }
    })();
  }, [backend, projectId, snapsToken]);

  async function handleAddSymbolLink() {
    if (selectedSymbol === null || artifactId === "" || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    setLinkNotice(null);
    try {
      await backend.addSymbolLink(artifactId, selectedSymbol.rootId, selectedSymbol.rel, {
        id: selectedSymbol.id,
        name: selectedSymbol.name,
        kind: selectedSymbol.kind,
        startLine: selectedSymbol.range.startLine,
        startCol: selectedSymbol.range.startCol,
        endLine: selectedSymbol.range.endLine,
        endCol: selectedSymbol.range.endCol,
        hash: selectedSymbol.hash,
      });
      setLinkNotice(`"${selectedSymbol.name}" linked with origin evidence.`);
      setLinksToken((t) => t + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setLinkError(normalizeCodeError(raw).message);
    } finally {
      setLinkBusy(false);
    }
  }

  async function handleRemoveLink(id: string) {
    if (removeBusy) return;
    setRemoveBusy(true);
    setLinksError(null);
    try {
      await backend.removeCodeLink(id);
      setConfirmRemove(null);
      setLinksToken((t) => t + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setLinksError(normalizeCodeError(raw).message);
    } finally {
      setRemoveBusy(false);
    }
  }

  function defaultSnapshotName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `Analysis ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  async function handleSaveSnapshot() {
    if (projectId === null || result === null || snapBusy) return;
    // The base requires an origin hash per file: unreadable ones out.
    const files = result.files.filter((file) => file.hash !== "");
    if (files.length === 0) {
      setSnapsError("The result has no readable files with an origin hash.");
      return;
    }
    setSnapBusy(true);
    setSnapsError(null);
    try {
      const name = snapName.trim() === "" ? defaultSnapshotName() : snapName.trim();
      await backend.saveSnapshot(projectId, name, { ...result, files });
      setSnapName("");
      setSnapsToken((t) => t + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setSnapsError(normalizeCodeError(raw).message);
    } finally {
      setSnapBusy(false);
    }
  }

  async function handleVerifySnapshot(id: string) {
    setVerify((prev) => ({ ...prev, [id]: { busy: true, report: null, error: null } }));
    try {
      const report = await backend.verifySnapshot(id);
      setVerify((prev) => ({ ...prev, [id]: { busy: false, report, error: null } }));
    } catch (raw) {
      setVerify((prev) => ({
        ...prev,
        [id]: { busy: false, report: null, error: normalizeCodeError(raw).message },
      }));
    }
  }

  async function handleDeleteSnapshot(id: string) {
    if (snapBusy) return;
    setSnapBusy(true);
    setSnapsError(null);
    try {
      await backend.deleteSnapshot(id);
      setConfirmSnap(null);
      setSnapsToken((t) => t + 1);
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setSnapsError(normalizeCodeError(raw).message);
    } finally {
      setSnapBusy(false);
    }
  }

  function handleOpen(link: CodeLinkDto) {
    onOpenFile(link.rootId, link.rel);
  }

  const artifactById = new Map((artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  const allLinks =
    projectLinks === null ? [] : [...projectLinks.moduleLinks, ...projectLinks.artifactLinks];

  function ownerLabel(link: CodeLinkDto): string {
    if (link.scope === "module") {
      return moduleNames[link.ownerId] !== undefined
        ? `module ${moduleNames[link.ownerId]}`
        : `module ${link.ownerId}`;
    }
    const artifact = artifactById.get(link.ownerId);
    if (artifact !== undefined) {
      const label = artifact.title ?? link.ownerId;
      return `${ARTIFACT_KIND_LABELS[artifact.kind] ?? artifact.kind} "${label}"`;
    }
    return `artifact ${link.ownerId}`;
  }

  return (
    <div className="project-code-panel">
      <section aria-label="Link symbol">
        <div className="panel-head">
          <h2>Link symbol</h2>
        </div>
        {projectId === null || moduleId === null ? (
          <p className="hint">Select a project and a module to link symbols.</p>
        ) : selectedSymbol === null ? (
          <p className="hint">Select a diagram symbol to link it to an artifact.</p>
        ) : (
          <>
            <p className="hint">
              "{selectedSymbol.name}" ({selectedSymbol.kind}) · {selectedSymbol.rel} · lines{" "}
              {selectedSymbol.range.startLine}–{selectedSymbol.range.endLine}
            </p>
            {artifactsError !== null && (
              <p className="error" role="alert">
                {artifactsError}
              </p>
            )}
            {artifacts !== null && artifacts.length === 0 && (
              <p className="hint">The module has no artifacts: create one in Design first.</p>
            )}
            {artifacts !== null && artifacts.length > 0 && (
              <div className="button-row">
                <label className="hint" htmlFor="symbol-link-target">
                  Artifact
                </label>
                <select
                  id="symbol-link-target"
                  value={artifactId}
                  onChange={(event) => setArtifactId(event.target.value)}
                >
                  {artifacts.map((artifact) => (
                    <option key={artifact.id} value={artifact.id}>
                      [{ARTIFACT_KIND_LABELS[artifact.kind] ?? artifact.kind}]{" "}
                      {artifact.title ?? artifact.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary small"
                  disabled={linkBusy || artifactId === ""}
                  onClick={() => void handleAddSymbolLink()}
                >
                  {linkBusy ? "Linking…" : "Link"}
                </button>
              </div>
            )}
            {linkNotice !== null && (
              <p className="notice" role="status">
                {linkNotice}
              </p>
            )}
            {linkError !== null && (
              <p className="error" role="alert">
                {linkError}
              </p>
            )}
          </>
        )}
      </section>

      <section aria-label="Project links">
        <div className="panel-head">
          <h2>Project links</h2>
        </div>
        {projectId === null ? (
          <p className="hint">Select a project to see its code links.</p>
        ) : (
          <>
            {linksLoading && <p className="hint">Loading links…</p>}
            {linksError !== null && (
              <p className="error" role="alert">
                {linksError}
              </p>
            )}
            {projectLinks !== null && !linksLoading && allLinks.length === 0 && (
              <p className="hint">No links yet: associate folders and link symbols.</p>
            )}
            {allLinks.length > 0 && (
              <ul className="pick-list">
                {allLinks.map((link) => (
                  <li key={link.id}>
                    <span
                      title={`${link.rootName ?? link.rootId} / ${link.rel}${link.symbol !== null ? ` · ${link.symbol.name} (lines ${link.symbol.startLine}–${link.symbol.endLine})` : ""}`}
                    >
                      {ownerLabel(link)} → <code>{link.rootName ?? link.rootId}</code>/{link.rel}
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
                            : "Open in the code perspective"
                        }
                        onClick={() => handleOpen(link)}
                      >
                        Open
                      </button>
                      {confirmRemove === link.id ? (
                        <>
                          <button
                            type="button"
                            className="danger small"
                            disabled={removeBusy}
                            onClick={() => void handleRemoveLink(link.id)}
                          >
                            {removeBusy ? "Unlinking…" : "Confirm"}
                          </button>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() => setConfirmRemove(null)}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary small"
                          title="Remove this link (files are untouched)"
                          onClick={() => setConfirmRemove(link.id)}
                        >
                          Unlink
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-label="Analysis snapshots">
        <div className="panel-head">
          <h2>Snapshots</h2>
        </div>
        {projectId === null ? (
          <p className="hint">Select a project to save and view snapshots.</p>
        ) : (
          <>
            <p className="hint">
              They save the detected result (types and relations, without file
              contents) for later comparison. Read-only: they are not loaded into the diagram.
            </p>
            <div className="button-row">
              <label className="hint" htmlFor="snapshot-name">
                Name
              </label>
              <input
                id="snapshot-name"
                type="text"
                value={snapName}
                placeholder={defaultSnapshotName()}
                onChange={(event) => setSnapName(event.target.value)}
              />
              <button
                type="button"
                className="secondary small"
                disabled={snapBusy || result === null}
                title={
                  result === null
                    ? "Analyze first to have a result to save"
                    : "Save the current result as a snapshot"
                }
                onClick={() => void handleSaveSnapshot()}
              >
                {snapBusy ? "Saving…" : "Save snapshot"}
              </button>
            </div>
            {snapsLoading && <p className="hint">Loading snapshots…</p>}
            {snapsError !== null && (
              <p className="error" role="alert">
                {snapsError}
              </p>
            )}
            {snapshots !== null && !snapsLoading && snapshots.length === 0 && (
              <p className="hint">No saved snapshots.</p>
            )}
            {snapshots !== null && snapshots.length > 0 && (
              <ul className="pick-list">
                {snapshots.map((snapshot) => {
                  const state = verify[snapshot.id];
                  return (
                    <li key={snapshot.id}>
                      <span>
                        <strong>{snapshot.name}</strong>{" "}
                        <span className="hint">
                          {snapshot.files.length} file{snapshot.files.length === 1 ? "" : "s"} ·{" "}
                          {snapshot.symbolCount} symbols · {snapshot.relationCount} relations ·{" "}
                          {snapshot.createdAt}
                        </span>
                      </span>
                      <div className="button-row">
                        <button
                          type="button"
                          className="secondary small"
                          disabled={state?.busy === true}
                          title="Compare each file with its origin hash"
                          onClick={() => void handleVerifySnapshot(snapshot.id)}
                        >
                          {state?.busy === true ? "Verifying…" : "Verify"}
                        </button>
                        {confirmSnap === snapshot.id ? (
                          <>
                            <button
                              type="button"
                              className="danger small"
                              disabled={snapBusy}
                              onClick={() => void handleDeleteSnapshot(snapshot.id)}
                            >
                              {snapBusy ? "Deleting…" : "Confirm"}
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => setConfirmSnap(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="secondary small"
                            title="Delete this saved snapshot"
                            onClick={() => setConfirmSnap(snapshot.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      {state?.error !== undefined && state.error !== null && (
                        <p className="error" role="alert">
                          {state.error}
                        </p>
                      )}
                      {state?.report !== undefined && state.report !== null && (
                        <ul className="struct-rel-list" aria-label={`Verification of ${snapshot.name}`}>
                          {state.report.stale && (
                            <li>
                              <span className="hint">
                                Stale: some file changed since it was saved.
                              </span>
                            </li>
                          )}
                          {!state.report.stale && (
                            <li>
                              <span className="hint">
                                Current: every file matches its origin.
                              </span>
                            </li>
                          )}
                          {state.report.files.map((file) => (
                            <li key={`${file.rootId}::${file.rel}`}>
                              <code>
                                {rootNames[file.rootId] ?? file.rootId}/{file.rel}
                              </code>{" "}
                              <span className="hint">
                                {file.status === "fresh"
                                  ? "unchanged"
                                  : file.status === "stale"
                                    ? "changed"
                                    : file.status === "missing"
                                      ? "missing"
                                      : (file.message ?? "could not be read")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
