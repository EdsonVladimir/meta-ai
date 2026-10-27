import type { RequirementDetail, VersionDto } from "./types";
import { approvalsForVersion, currentVersion } from "./types";

interface RequirementEditorProps {
  detail: RequirementDetail;
  draft: string;
  dirty: boolean;
  author: string;
  viewing: VersionDto | null;
  busy: boolean;
  error: string | null;
  onEdit: (content: string) => void;
  onAuthorChange: (author: string) => void;
  onSave: () => void;
  onBackToCurrent: () => void;
}

export function RequirementEditor({
  detail,
  draft,
  dirty,
  author,
  viewing,
  busy,
  error,
  onEdit,
  onAuthorChange,
  onSave,
  onBackToCurrent,
}: RequirementEditorProps) {
  const current = currentVersion(detail);

  if (viewing !== null) {
    const approvals = approvalsForVersion(detail, viewing.id);
    return (
      <section className="editor" aria-label="Lectura de versión anterior">
        <div className="editor-head">
          <h3>
            <code>{detail.artifact.id}</code> · v{viewing.number}{" "}
            <span className="badge">lectura</span>
          </h3>
          <button type="button" className="secondary small" onClick={onBackToCurrent}>
            Volver a la actual (v{current?.number})
          </button>
        </div>
        <p className="hint">
          Procedencia: {provenanceLabel(viewing)} ·{" "}
          {approvals.length === 0
            ? "sin aprobación"
            : approvals.map((a) => `aprobada por ${a.approvedBy} el ${a.at}`).join("; ")}
        </p>
        <pre className="readonly-box">{viewing.content}</pre>
        <p className="hint">Las versiones anteriores no se pueden editar ni aprobar como actuales.</p>
      </section>
    );
  }

  return (
    <section className="editor" aria-label="Editor del requisito">
      <div className="editor-head">
        <h3>
          <code>{detail.artifact.id}</code> · v{current?.number}{" "}
          <span className="badge">actual</span>
          {dirty && <span className="badge dirty">sin guardar</span>}
        </h3>
      </div>
      <label className="field">
        <span>Contenido (borrador local)</span>
        <textarea
          value={draft}
          onChange={(e) => onEdit(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              if (dirty && !busy) onSave();
            }
          }}
          rows={10}
          disabled={busy}
          placeholder="Describe el requisito…"
        />
      </label>
      <div className="editor-row">
        <label className="field inline">
          <span>Autoría de la versión</span>
          <input
            type="text"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            disabled={busy}
            placeholder="Tu nombre"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={onSave}
          disabled={busy || !dirty}
          title={!dirty ? "Sin cambios que guardar" : "Guardar nueva versión (Ctrl+S)"}
        >
          {busy ? "Guardando…" : "Guardar nueva versión"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Guardar crea una versión nueva sin modificar el historial. Registrar un
        nombre como autoría no equivale a autenticación.
      </p>
    </section>
  );
}

function provenanceLabel(version: VersionDto): string {
  return version.provenance.kind === "ai"
    ? `propuesta de IA (${version.provenance.by})`
    : version.provenance.by;
}
