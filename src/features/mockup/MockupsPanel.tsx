// Índice de mockups del módulo: todos los mockups con estado y acceso,
// más creación manual (título y autoría; el dibujo empieza en blanco).
// La creación llama a Rust y entrega el detalle al workspace, que
// selecciona el mockup nuevo y refresca el árbol.
import { useState } from "react";
import type { ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { artifactLabel } from "../requirements/names";
import { normalizeCoreError, type ArtifactDto, type RequirementDetail } from "../requirements/types";
import { createMockup } from "./client";

interface MockupsPanelProps {
  projectId: string;
  moduleId: string;
  moduleName: string;
  mockups: ArtifactDto[];
  graph: ModuleGraph | null;
  meta: Record<string, ArtifactMeta>;
  /** Módulo archivado: índice consultable, sin crear. */
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
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createTitle = moduleArchived ? "Módulo archivado: restaúralo para crear" : undefined;

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
          Crear mockup
        </button>
        <span className="hint">en {moduleName}</span>
      </div>
      {moduleArchived && (
        <p className="notice" role="note">
          Módulo archivado: los mockups se consultan, pero no se crean ni editan.
        </p>
      )}
      {creating && !moduleArchived && (
        <form
          className="create-form"
          aria-label="Crear mockup"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <label className="field">
            <span>Título</span>
            <input
              type="text"
              value={title}
              maxLength={200}
              placeholder="p. ej. Nueva reserva"
              autoComplete="off"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Autoría</span>
            <input
              type="text"
              value={author}
              placeholder="Tu nombre"
              autoComplete="off"
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <p className="hint">
            Empieza en blanco: dibuja pantallas y declara sus fuentes en el editor.
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
              {busy ? "Creando…" : "Crear"}
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
              Cancelar
            </button>
          </div>
        </form>
      )}
      {mockups.length === 0 ? (
        <p className="hint">Este módulo aún no tiene mockups.</p>
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
                    {stale === true && <span className="stale-badge">desactualizado</span>}
                    {stale === false && sources !== null && (
                      <span className="hint">
                        {sources} {sources === 1 ? "fuente" : "fuentes"}
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
