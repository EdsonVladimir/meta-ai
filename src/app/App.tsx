import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BaselineDialog } from "../features/baseline/BaselineDialog";
import { ConnectionPanel } from "../features/connection/ConnectionPanel";
import { RequirementsWorkspace } from "../features/requirements/RequirementsWorkspace";
import {
  activeDocKey,
  dirtyDocKeys,
  headerSave,
} from "../features/requirements/saveStatus";
import { useRequirementsUi } from "../features/requirements/uiStore";
import { isTauriEnvironment } from "../lib/env";
import { WindowControls } from "./WindowControls";

async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauriEnvironment()) return;
  await getCurrentWindow().toggleMaximize();
}

/** Close through the existing flow: fires CloseRequested (terminals). */
function requestWindowClose(): void {
  if (!isTauriEnvironment()) return;
  void getCurrentWindow().close().catch(() => {});
}

export function App() {
  const [exportOpen, setExportOpen] = useState(false);
  const [exportGate, setExportGate] = useState(false);
  const [closeGate, setCloseGate] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  const docStatus = useRequirementsUi((s) => s.docStatus);
  const saveAllResult = useRequirementsUi((s) => s.saveAllResult);

  // After a successful Save-all, each gate continues on its way.
  useEffect(() => {
    if (saveAllResult === null || !saveAllResult.ok) return;
    if (exportGate) {
      useRequirementsUi.getState().resolveSaveAll(null);
      setExportGate(false);
      setExportOpen(true);
    } else if (closeGate) {
      useRequirementsUi.getState().resolveSaveAll(null);
      setCloseGate(false);
      requestWindowClose();
    }
  }, [saveAllResult, exportGate, closeGate]);

  function requestExport() {
    if (!projectId) return;
    if (dirtyDocKeys(docStatus).length > 0) {
      useRequirementsUi.getState().resolveSaveAll(null);
      setExportGate(true);
      return;
    }
    setExportOpen(true);
  }

  function requestClose() {
    // With drafts, warn and allow cancel; without them, straight to the
    // existing flow (which may still stop for active terminals).
    if (dirtyDocKeys(docStatus).length > 0) {
      useRequirementsUi.getState().resolveSaveAll(null);
      setCloseGate(true);
      return;
    }
    requestWindowClose();
  }

  return (
    <div className="page wide app">
      <header className="topbar">
        <div className="brand-mini">
          <span className="logo" aria-hidden="true">
            R
          </span>
          <h1>Ruth IDE</h1>
        </div>
        <Breadcrumb />
        <div className="topbar-right">
          <SaveStatus />
          <button
            type="button"
            className="export-button"
            onClick={requestExport}
            disabled={!projectId}
            title={projectId ? "Prepare deliveries and export" : "Choose a project first"}
            aria-label={
              projectId ? "Export: prepare deliveries" : "Export (choose a project first)"
            }
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M8 2v8M4.5 6.5 8 3l3.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
            Export
          </button>
          <div className="menu-wrap">
            <button
              type="button"
              className="menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="More options"
              title="More options"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="menu-popover" role="menu" aria-label="More options">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowConnection((shown) => !shown);
                  }}
                >
                  Meta connection
                </button>
              </div>
            )}
          </div>
          {showConnection && (
            <div className="conn-popover">
              <div className="panel-head conn-head">
                <h2>Meta connection</h2>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setShowConnection(false)}
                >
                  Close
                </button>
              </div>
              <ConnectionPanel />
            </div>
          )}
          <WindowControls
            onCloseRequest={requestClose}
            onToggleMaximize={toggleMaximizeWindow}
          />
        </div>
      </header>
      <main>
        <RequirementsWorkspace />
      </main>
      {exportGate && projectId && (
        <ExportGateDialog
          dirtyLabels={dirtyDocKeys(docStatus).map(
            (key) => docStatus[key]?.label ?? key,
          )}
          onSaveAll={() => useRequirementsUi.getState().requestSaveAll()}
          onExportSaved={() => {
            setExportGate(false);
            setExportOpen(true);
          }}
          onCancel={() => {
            useRequirementsUi.getState().resolveSaveAll(null);
            setExportGate(false);
          }}
        />
      )}
      {exportOpen && projectId && (
        <BaselineDialog
          projectId={projectId}
          moduleId={moduleId}
          onClose={() => setExportOpen(false)}
        />
      )}
      {closeGate && (
        <CloseGateDialog
          dirtyLabels={dirtyDocKeys(docStatus).map((key) => docStatus[key]?.label ?? key)}
          onSaveAll={() => useRequirementsUi.getState().requestSaveAll()}
          onDiscard={() => {
            useRequirementsUi.getState().resolveSaveAll(null);
            setCloseGate(false);
            requestWindowClose();
          }}
          onCancel={() => {
            useRequirementsUi.getState().resolveSaveAll(null);
            setCloseGate(false);
          }}
        />
      )}
    </div>
  );
}

/** Active document status + count of others with drafts. */
function SaveStatus() {
  const selection = useRequirementsUi((s) => s.selection);
  const centerView = useRequirementsUi((s) => s.centerView);
  const centerDoc = useRequirementsUi((s) => s.centerDoc);
  const docStatus = useRequirementsUi((s) => s.docStatus);
  const lastSave = useRequirementsUi((s) => s.lastSave);
  const activeKey = activeDocKey(selection, centerView, centerDoc);
  const { state, othersDirty, error } = headerSave(docStatus, activeKey);

  if (state === "none") {
    return (
      <span className="save-status hint" role="status">
        No document
        {othersDirty > 0 && (
          <span className="save-others"> · {othersDirty} with changes</span>
        )}
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      {state === "dirty" && (
        <span className="save-state warn" title="This document has unsaved changes">
          <span aria-hidden="true">●</span> Unsaved changes
        </span>
      )}
      {state === "saving" && <span className="save-state">Saving…</span>}
      {state === "saved" && (
        <span
          className="save-state ok-text"
          title={lastSave ? new Date(lastSave.at).toLocaleTimeString() : undefined}
        >
          Saved
        </span>
      )}
      {state === "error" && (
        <span className="save-state error-text">
          Save failed
          <button
            type="button"
            className="secondary small"
            onClick={() => useRequirementsUi.getState().requestSave()}
            title={error ?? "Retry saving"}
          >
            Retry
          </button>
        </span>
      )}
      <button
        type="button"
        className="secondary small"
        onClick={() => useRequirementsUi.getState().requestSave()}
        title="Save the active editor (Ctrl+S)"
      >
        Save
      </button>
      {othersDirty > 0 && (
        <span className="save-others" title="Other documents with unsaved changes">
          · {othersDirty} {othersDirty === 1 ? "document" : "documents"} with changes
        </span>
      )}
    </span>
  );
}

/**
 * Export gate with drafts: the package only includes persisted versions.
 * Save-all and continue, export what's saved, or cancel; it never
 * discards edits nor claims otherwise.
 */
function ExportGateDialog({
  dirtyLabels,
  onSaveAll,
  onExportSaved,
  onCancel,
}: {
  dirtyLabels: string[];
  onSaveAll: () => void;
  onExportSaved: () => void;
  onCancel: () => void;
}) {
  const saveAllResult = useRequirementsUi((s) => s.saveAllResult);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (saveAllResult !== null) setWaiting(false);
  }, [saveAllResult]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Export with unsaved changes"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Unsaved changes</h3>
        <p>
          The package only includes persisted versions. These documents have drafts and would{" "}
          <strong>not</strong> be included as-is:
        </p>
        <ul>
          {dirtyLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        {saveAllResult !== null && !saveAllResult.ok && (
          <p className="error" role="alert">
            {saveAllResult.message}
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={waiting}
            onClick={() => {
              setWaiting(true);
              onSaveAll();
            }}
          >
            {waiting ? "Saving…" : "Save all and continue"}
          </button>
          <button type="button" className="secondary" onClick={onExportSaved}>
            Export saved work
          </button>
          <button type="button" className="secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Close gate with drafts: save all and close, close without saving
 * (explicit, with the list shown), or cancel. Afterwards closing
 * continues through the existing flow (terminals).
 */
function CloseGateDialog({
  dirtyLabels,
  onSaveAll,
  onDiscard,
  onCancel,
}: {
  dirtyLabels: string[];
  onSaveAll: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  const saveAllResult = useRequirementsUi((s) => s.saveAllResult);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (saveAllResult !== null) setWaiting(false);
  }, [saveAllResult]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Close with unsaved changes"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Unsaved changes</h3>
        <p>These documents would lose their draft on close:</p>
        <ul>
          {dirtyLabels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        {saveAllResult !== null && !saveAllResult.ok && (
          <p className="error" role="alert">
            {saveAllResult.message}
          </p>
        )}
        <div className="button-row">
          <button
            type="button"
            className="primary"
            disabled={waiting}
            onClick={() => {
              setWaiting(true);
              onSaveAll();
            }}
          >
            {waiting ? "Saving…" : "Save all and close"}
          </button>
          <button type="button" className="danger" onClick={onDiscard}>
            Close without saving
          </button>
          <button type="button" className="secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Breadcrumb() {
  const projectId = useRequirementsUi((s) => s.selection.projectId);
  const moduleId = useRequirementsUi((s) => s.selection.moduleId);
  const projectName = useRequirementsUi((s) => s.contextNames.project);
  const moduleName = useRequirementsUi((s) => s.contextNames.module);
  return (
    <nav
      className="breadcrumb"
      aria-label="Location"
      data-tauri-drag-region
      onDoubleClick={() => void toggleMaximizeWindow()}
      title="Drag to move · double-click to maximize"
    >
      {projectId ? (
        <span title={projectName && projectName !== projectId ? `${projectName} — ${projectId}` : projectId}>
          {projectName ?? projectId}
        </span>
      ) : (
        <span className="hint">No project</span>
      )}
      {moduleId && (
        <>
          {" / "}
          <span title={moduleName && moduleName !== moduleId ? `${moduleName} — ${moduleId}` : moduleId}>
            {moduleName ?? moduleId}
          </span>
        </>
      )}
    </nav>
  );
}
