// Workspace close gate: dirty documents are saved or discarded with
// confirmation; active terminals are reported (they keep running).
// One dialog, explicit choice, cancel always available.
interface WorkspaceCloseDialogProps {
  dirtyLabels: string[];
  terminalCount: number;
  terminalCwds: string[];
  terminalsUnknown?: boolean;
  saving: boolean;
  saveError: string | null;
  onSaveAndClose: () => void;
  onCloseWithoutSaving: () => void;
  onCancel: () => void;
}

export function WorkspaceCloseDialog({
  dirtyLabels,
  terminalCount,
  terminalCwds,
  terminalsUnknown = false,
  saving,
  saveError,
  onSaveAndClose,
  onCloseWithoutSaving,
  onCancel,
}: WorkspaceCloseDialogProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Close workspace"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Close workspace?</h3>
        {dirtyLabels.length === 0 ? (
          <p>No unsaved changes.</p>
        ) : (
          <>
            <p>Unsaved changes in:</p>
            <ul className="gate-list">
              {dirtyLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
          </>
        )}
        {terminalCount > 0 && (
          <p className="hint" role="note">
            {terminalCount} active terminal{terminalCount === 1 ? "" : "s"} will keep running
            {terminalCwds.length > 0 ? ` (${terminalCwds.slice(0, 3).join(", ")})` : ""}.
          </p>
        )}
        {terminalsUnknown && terminalCount === 0 && (
          <p className="hint" role="note">
            The terminal list could not be checked; any sessions keep running.
          </p>
        )}
        {saveError !== null && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
        <div className="button-row">
          {dirtyLabels.length > 0 && (
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={onSaveAndClose}
            >
              {saving ? "Saving…" : "Save all and close"}
            </button>
          )}
          <button
            type="button"
            className={dirtyLabels.length > 0 ? "danger" : "primary"}
            disabled={saving}
            onClick={onCloseWithoutSaving}
          >
            {dirtyLabels.length > 0 ? "Close without saving" : "Close workspace"}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
