// Manual module ↔ workspace folder/file links. The module "points" at
// paths; it moves or renames nothing on disk. Without a project there
// are no links; archived is browsed only. Creation uses the active code
// tab (perspective preserved).
import { useEffect, useRef, useState } from "react";
import { useRequirementsUi } from "../requirements/uiStore";
import {
  addModuleLink,
  listCodeLinks,
  normalizeCodeError,
  removeCodeLink,
} from "./client";
import type { CodeLinkDto } from "./types";

export interface ModuleLinksApi {
  listModuleLinks: (moduleId: string) => Promise<CodeLinkDto[]>;
  addModuleLink: (moduleId: string, rootId: string, rel: string) => Promise<CodeLinkDto>;
  removeCodeLink: (id: string) => Promise<string>;
}

export const realModuleLinksApi: ModuleLinksApi = {
  listModuleLinks: (moduleId) => listCodeLinks("module", moduleId),
  addModuleLink: (moduleId, rootId, rel) => addModuleLink(moduleId, rootId, rel),
  removeCodeLink: (id) => removeCodeLink(id),
};

interface ModuleCodeLinksProps {
  moduleId: string;
  moduleName: string | null;
  /** Effectively archived: read-only, no linking or unlinking. */
  archived: boolean;
  api?: ModuleLinksApi;
}

export function ModuleCodeLinks({ moduleId, moduleName, archived, api }: ModuleCodeLinksProps) {
  const backend = api ?? realModuleLinksApi;
  const activeFile = useRequirementsUi((s) => s.codeActiveFile);
  const [links, setLinks] = useState<CodeLinkDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    const epoch = ++epochRef.current;
    setLoading(true);
    setError(null);
    setConfirmId(null);
    void (async () => {
      try {
        const next = await backend.listModuleLinks(moduleId);
        if (epochRef.current !== epoch) return;
        setLinks(next);
      } catch (raw) {
        if (epochRef.current !== epoch) return;
        setError(normalizeCodeError(raw).message);
      } finally {
        if (epochRef.current === epoch) setLoading(false);
      }
    })();
  }, [backend, moduleId]);

  async function handleAdd() {
    if (activeFile === null || busy || archived) return;
    setBusy(true);
    setError(null);
    try {
      const created = await backend.addModuleLink(moduleId, activeFile.rootId, activeFile.rel);
      setLinks((prev) => (prev === null ? [created] : [...prev, created]));
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setError(normalizeCodeError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    if (busy || archived) return;
    setBusy(true);
    setError(null);
    try {
      await backend.removeCodeLink(id);
      setLinks((prev) => (prev === null ? prev : prev.filter((link) => link.id !== id)));
      setConfirmId(null);
      useRequirementsUi.getState().bumpCodeLibrary();
    } catch (raw) {
      setError(normalizeCodeError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  function handleOpen(rootId: string, rel: string) {
    useRequirementsUi.getState().requestCodeOpen(rootId, rel);
  }

  const addTitle = archived
    ? "Archived module: restore it to link code"
    : activeFile === null
      ? "Open a file in the code perspective first"
      : `Link ${activeFile.rootName}/${activeFile.rel} to this module`;

  return (
    <section className="module-links" aria-label="Module code links">
      <h3>Linked code{moduleName !== null ? ` · ${moduleName}` : ""}</h3>
      <p className="hint">
        Manual links to folders or files. They move nothing on disk; removing
        the folder from the workspace requires unlinking it first.
      </p>
      {loading && <p className="hint">Loading links…</p>}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {links !== null && !loading && links.length === 0 && (
        <p className="hint">No links. Open a file in Code and link it here.</p>
      )}
      {links !== null && links.length > 0 && (
        <ul className="pick-list">
          {links.map((link) => (
            <li key={link.id}>
              <span title={`${link.rootName ?? link.rootId} / ${link.rel}`}>
                <code>{link.rootName ?? link.rootId}</code>/{link.rel}
              </span>{" "}
              <span className="hint">manual</span>
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
                  onClick={() => handleOpen(link.rootId, link.rel)}
                >
                  Open
                </button>
                {confirmId === link.id ? (
                  <>
                    <button
                      type="button"
                      className="danger small"
                      disabled={busy || archived}
                      onClick={() => void handleRemove(link.id)}
                    >
                      {busy ? "Unlinking…" : "Confirm"}
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => setConfirmId(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="secondary small"
                    disabled={archived}
                    title={
                      archived
                        ? "Archived module: restore it to unlink"
                        : "Remove this link (files are untouched)"
                    }
                    onClick={() => setConfirmId(link.id)}
                  >
                    Unlink
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row">
        <button
          type="button"
          className="secondary"
          disabled={busy || archived || activeFile === null}
          title={addTitle}
          onClick={() => void handleAdd()}
        >
          {busy
            ? "Linking…"
            : activeFile === null
              ? "Link active tab"
              : `Link ${activeFile.rootName}/${activeFile.rel}`}
        </button>
      </div>
    </section>
  );
}
