// Module mockup index: every mockup with state and access, plus manual
// creation (title and authorship; the drawing starts blank). Creation
// calls Rust and hands the detail to the workspace, which selects the
// new mockup and refreshes the tree.
import { useState } from "react";
import type { ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { artifactLabel } from "../requirements/names";
import { normalizeCoreError, type ArtifactDto, type RequirementDetail } from "../requirements/types";
import { createMockup } from "./client";
import { ScreenProposals } from "./ScreenProposals";

interface MockupsPanelProps {
  projectId: string;
  moduleId: string;
  moduleName: string;
  mockups: ArtifactDto[];
  graph: ModuleGraph | null;
  meta: Record<string, ArtifactMeta>;
  /** Archived module: browsable index, no creation. */
  moduleArchived: boolean;
  onOpenMockup: (mockupId: string) => void;
  onCreatedMockup: (detail: RequirementDetail) => void;
}

export function MockupsPanel({
  projectId,
  moduleId,
  moduleName,
  mockups,
  graph,
  meta,
  moduleArchived,
  onOpenMockup,
  onCreatedMockup,
}: MockupsPanelProps) {
  const [creating, setCreating] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createTitle = moduleArchived ? "Archived module: restore it to create" : undefined;

  async function handleCreate() {
    if (title.trim() === "" || author.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await createMockup({
        projectId,
        moduleId,
        author: author.trim(),
        spec: { title: title.trim(), screens: [] },
        sourceVersionIds: [],
      });
      setTitle("");
      setCreating(false);
      onCreatedMockup(detail);
    } catch (raw) {
      setError(normalizeCoreError(raw).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="module-designs">
      <div className="modal-actions" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
        <button
          type="button"
          className="primary"
          onClick={() => {
            setError(null);
            setCreating((v) => !v);
          }}
          disabled={moduleArchived}
          title={createTitle}
          aria-expanded={creating}
        >
          Create mockup
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setProposing((v) => !v)}
          disabled={moduleArchived}
          title={createTitle}
          aria-expanded={proposing}
        >
          Propose screens
        </button>
        <span className="hint">in {moduleName}</span>
      </div>
      {proposing && (
        <ScreenProposals
          key={`${projectId}/${moduleId}`}
          projectId={projectId}
          moduleId={moduleId}
          moduleArchived={moduleArchived}
          onAccepted={onCreatedMockup}
          onOpenMockup={onOpenMockup}
        />
      )}
      {moduleArchived && (
        <p className="notice" role="note">
          Archived module: mockups can be browsed, but not created or edited.
        </p>
      )}
      {creating && !moduleArchived && (
        <form
          className="create-form"
          aria-label="Create mockup"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              maxLength={200}
              placeholder="e.g. New booking"
              autoComplete="off"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Authorship</span>
            <input
              type="text"
              value={author}
              placeholder="Your name"
              autoComplete="off"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <p className="hint">
            Starts blank: draw screens and declare their sources in the editor.
          </p>
          {error !== null && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="primary"
              disabled={busy || title.trim() === "" || author.trim() === ""}
              onClick={() => void handleCreate()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setCreating(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {mockups.length === 0 ? (
        <p className="hint">This module has no mockups yet.</p>
      ) : (
        <ul className="pick-list">
          {mockups.map((mockup) => {
            const stale = graph?.index?.freshness[mockup.id]?.stale ?? null;
            const sources = graph?.index?.freshness[mockup.id]?.pins.length ?? null;
            const label = artifactLabel(mockup.title, meta[mockup.id]?.label ?? null, mockup.id);
            return (
              <li key={mockup.id}>
                <button type="button" onClick={() => onOpenMockup(mockup.id)} title={mockup.id}>
                  <span className="design-row">
                    <code>{label}</code>
                    {label !== mockup.id && (
                      <span className="hint">
                        <code>{mockup.id}</code>
                      </span>
                    )}
                    <span className="kind-badge">mockup</span>
                    {stale === true && <span className="stale-badge">stale</span>}
                    {stale === false && sources !== null && (
                      <span className="hint">
                        {sources} {sources === 1 ? "source" : "sources"}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
