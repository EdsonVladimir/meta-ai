// Workspace close gate: dirty documents are saved or discarded with
// confirmation; active terminals are reported (they keep running);
// pending Muse files are reported (memory-only conversations go
// with the switch, while the proposals stay stored). One dialog,
// explicit choice, cancel always available.
import { closeGateCopy, type CloseGateMode } from "./closeGate";

interface WorkspaceCloseDialogProps {
  mode: CloseGateMode;
  dirtyLabels: string[];
  terminalCount: number;
  terminalCwds: string[];
  terminalsUnknown?: boolean;
  museNotice?: string | null;
  saving: boolean;
  saveError: string | null;
  onSaveAndClose: () => void;
  onCloseWithoutSaving: () => void;
  onCancel: () => void;
}

export function WorkspaceCloseDialog({
  mode,
  dirtyLabels,
  terminalCount,
  terminalCwds,
  terminalsUnknown = false,
  museNotice = null,
  saving,
  saveError,
  onSaveAndClose,
  onCloseWithoutSaving,
  onCancel,
}: WorkspaceCloseDialogProps) {
  const copy = closeGateCopy(mode, dirtyLabels.length > 0, saving);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={copy.title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3>{copy.title}</h3>
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
        {museNotice !== null && (
          <p className="hint" role="note">
            {museNotice}
          </p>
        )}
        {saveError !== null && (
          <p className="error" role="alert">
            {saveError}
          </p>
        )}
        <div className="button-row">
          {copy.saveLabel !== null && (
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={onSaveAndClose}
            >
              {copy.saveLabel}
            </button>
          )}
          <button
            type="button"
            className={dirtyLabels.length > 0 ? "danger" : "primary"}
            disabled={saving}
            onClick={onCloseWithoutSaving}
          >
            {copy.closeLabel}
          </button>
          <button type="button" className="secondary" disabled={saving} onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
