interface UnsavedDialogProps {
  requirementId: string;
  author: string;
  busy: boolean;
  error: string | null;
  onAuthorChange: (author: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedDialog({
  requirementId,
  author,
  busy,
  error,
  onAuthorChange,
  onSave,
  onDiscard,
  onCancel,
}: UnsavedDialogProps) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
      <div className="modal">
        <h3 id="unsaved-title">Cambios sin guardar</h3>
        <p>
          El borrador de <code>{requirementId}</code> tiene cambios sin guardar
          como versión nueva. ¿Qué quieres hacer?
        </p>
        <label className="field">
          <span>Autoría para guardar</span>
          <input
            type="text"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            disabled={busy}
            placeholder="Tu nombre"
            autoComplete="off"
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onSave} disabled={busy}>
            {busy ? "Guardando…" : "Guardar y continuar"}
          </button>
          <button type="button" className="secondary" onClick={onDiscard} disabled={busy}>
            Descartar
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
