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

/** Cierre por el flujo existente: dispara CloseRequested (terminales). */
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

  // Tras un Guardar-todo con éxito, cada puerta sigue su camino.
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
    // Con borradores se avisa y se puede cancelar; sin ellos, directo al
    // flujo existente (que aún puede frenar por terminales activas).
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
            title={projectId ? "Preparar entregas y exportar" : "Elige un proyecto primero"}
            aria-label={
              projectId ? "Exportar: preparar entregas" : "Exportar (elige un proyecto primero)"
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
            Exportar
          </button>
          <div className="menu-wrap">
            <button
              type="button"
              className="menu-button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Más opciones"
              title="Más opciones"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="menu-popover" role="menu" aria-label="Más opciones">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowConnection((shown) => !shown);
                  }}
                >
                  Conexión con Meta
                </button>
              </div>
            )}
          </div>
          {showConnection && (
            <div className="conn-popover">
              <div className="panel-head conn-head">
                <h2>Conexión con Meta</h2>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => setShowConnection(false)}
                >
                  Cerrar
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

/** Estado del documento activo + contador de otros con borrador. */
function SaveStatus() {
  const selection = useRequirementsUi((s) => s.selection);
  const centerView = useRequirementsUi((s) => s.centerView);
  const docStatus = useRequirementsUi((s) => s.docStatus);
  const lastSave = useRequirementsUi((s) => s.lastSave);
  const activeKey = activeDocKey(selection, centerView);
  const { state, othersDirty, error } = headerSave(docStatus, activeKey);

  if (state === "none") {
    return (
      <span className="save-status hint" role="status">
        Sin documento
        {othersDirty > 0 && (
          <span className="save-others"> · {othersDirty} con cambios</span>
        )}
      </span>
    );
  }
  return (
    <span className="save-status" role="status">
      {state === "dirty" && (
        <span className="save-state warn" title="Hay cambios sin guardar en este documento">
          <span aria-hidden="true">●</span> Cambios sin guardar
        </span>
      )}
      {state === "saving" && <span className="save-state">Guardando…</span>}
      {state === "saved" && (
        <span
          className="save-state ok-text"
          title={lastSave ? new Date(lastSave.at).toLocaleTimeString() : undefined}
        >
          Guardado
        </span>
      )}
      {state === "error" && (
        <span className="save-state error-text">
          Error al guardar
          <button
            type="button"
            className="secondary small"
            onClick={() => useRequirementsUi.getState().requestSave()}
            title={error ?? "Reintentar el guardado"}
          >
            Reintentar
          </button>
        </span>
      )}
      <button
        type="button"
        className="secondary small"
        onClick={() => useRequirementsUi.getState().requestSave()}
        title="Guardar el editor activo (Ctrl+S)"
      >
        Guardar
      </button>
      {othersDirty > 0 && (
        <span className="save-others" title="Otros documentos con cambios sin guardar">
          · {othersDirty} {othersDirty === 1 ? "documento" : "documentos"} con cambios
        </span>
      )}
    </span>
  );
}

/**
 * Puerta de exportación con borradores: el paquete solo incluye versiones
 * persistidas. Guardar-todo y continuar, exportar lo guardado o cancelar;
 * nunca descarta ediciones ni afirma lo contrario.
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
        aria-label="Exportar con cambios sin guardar"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Cambios sin guardar</h3>
        <p>
          El paquete solo incluye versiones persistidas. Estos documentos tienen borrador y{" "}
          <strong>no</strong> entrarían tal cual:
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
            {waiting ? "Guardando…" : "Guardar todo y continuar"}
          </button>
          <button type="button" className="secondary" onClick={onExportSaved}>
            Exportar lo guardado
          </button>
          <button type="button" className="secondary" onClick={onCancel} autoFocus>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Puerta de cierre con borradores: guardar todo y cerrar, cerrar sin
 * guardar (explícito, con la lista delante) o cancelar. Tras ella, el
 * cierre sigue por el flujo existente (terminales).
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
        aria-label="Cerrar con cambios sin guardar"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Cambios sin guardar</h3>
        <p>Estos documentos perderían su borrador al cerrar:</p>
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
            {waiting ? "Guardando…" : "Guardar todo y cerrar"}
          </button>
          <button type="button" className="danger" onClick={onDiscard}>
            Cerrar sin guardar
          </button>
          <button type="button" className="secondary" onClick={onCancel} autoFocus>
            Cancelar
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
      aria-label="Ubicación"
      data-tauri-drag-region
      onDoubleClick={() => void toggleMaximizeWindow()}
      title="Arrastra para mover · doble clic para maximizar"
    >
      {projectId ? (
        <span title={projectName && projectName !== projectId ? `${projectName} — ${projectId}` : projectId}>
          {projectName ?? projectId}
        </span>
      ) : (
        <span className="hint">Sin proyecto</span>
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
