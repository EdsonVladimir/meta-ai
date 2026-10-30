interface UnsavedDialogProps {
  /** "requirement req-1" or "design flow-1": which draft is protected. */
  subject: string;
  /** Layout only (no new version): asks no authorship. */
  layoutOnly: boolean;
  author: string;
  busy: boolean;
  error: string | null;
  onAuthorChange: (author: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedDialog({
  subject,
  layoutOnly,
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
        <h3 id="unsaved-title">Unsaved changes</h3>
        <p>
          The draft of <code>{subject}</code>{" "}
          {layoutOnly
            ? "has unsaved layout changes. What do you want to do?"
            : "has changes not saved as a new version. What do you want to do?"}
        </p>
        {!layoutOnly && (
          <label className="field">
            <span>Authorship for saving</span>
            <input
              type="text"
              value={author}
              onChange={(e) => onAuthorChange(e.target.value)}
              disabled={busy}
              placeholder="Your name"
              autoComplete="off"
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="primary" onClick={onSave} disabled={busy}>
            {busy ? "Saving…" : layoutOnly ? "Save layout and continue" : "Save and continue"}
          </button>
          <button type="button" className="secondary" onClick={onDiscard} disabled={busy}>
            Discard
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
