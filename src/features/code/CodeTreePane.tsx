// Left code panel: workspace folders. It shares the session with the
// editor through the provider (a single truth).
import { useMemo, useState } from "react";
import { activeProjectRoots } from "../workspace/activeProject";
import { normalizeCodeError, setRootAiBlocked } from "./client";
import { useCodeWorkspace } from "./useCodeWorkspace";
import { useRequirementsUi } from "../requirements/uiStore";
import { CodeTree } from "./CodeTree";
import { ReplicateDialog } from "./ReplicateDialog";
import { tabsOfRoot } from "./model";

export function CodeTreePane() {
  const {
    desktop,
    roots,
    rootsLoading,
    rootsError,
    reloadRoots,
    adding,
    addError,
    handleAddRoot,
    addConfirm,
    confirmAddFolder,
    cancelAddFolder,
    tabs,
    scopeNotice,
    treeReveal,
    treeRefresh,
    handleOpenFile,
    handleTerminalAt,
    handleAddToScope,
    projectNames,
    selectedProjectId,
    associatingRootId,
    handleSetRootProject,
    confirmRemove,
    setConfirmRemove,
    removing,
    removeDirtyCount,
    doRemoveRoot,
    handleRemoveRootSaveFirst,
    replicateRoot,
    setReplicateRoot,
    handleReplicated,
  } = useCodeWorkspace();
  const mapHidden = useRequirementsUi((s) => s.mapHiddenRoots);
  const toggleMapRoot = useRequirementsUi((s) => s.toggleMapRoot);
  const archScope = useRequirementsUi((s) => s.archScope);
  const setArchScope = useRequirementsUi((s) => s.setArchScope);
  const folderSelection = useRequirementsUi((s) => s.codeFolderSelection);
  const setCodeFolderSelection = useRequirementsUi((s) => s.setCodeFolderSelection);
  const setMuseTarget = useRequirementsUi((s) => s.setMuseTarget);
  const [aiBlockError, setAiBlockError] = useState<string | null>(null);
  const hiddenProjects = useRequirementsUi((s) => s.mapHiddenProjects);
  const openedProjects = useRequirementsUi((s) => s.mapOpenedProjects);
  const setMapProjectHidden = useRequirementsUi((s) => s.setMapProjectHidden);
  const recordMapProjectOpened = useRequirementsUi((s) => s.recordMapProjectOpened);
  // Opening a service (name click or eye) records it, so it starts
  // open from then on; closing only hides it.
  function openService(rootId: string, rel: string) {
    const key = `${rootId}::${rel}`;
    setMapProjectHidden(key, false);
    recordMapProjectOpened(key);
  }
  // One active project: other projects' folders and loose folders stay
  // stored but hidden (their flags, including Never send to Muse, are
  // untouched and still enforced in the backend).
  const visibleRoots = useMemo(
    () => activeProjectRoots(roots, selectedProjectId),
    [roots, selectedProjectId],
  );

  if (!desktop) {
    return <p className="hint">The code workspace requires desktop Ruth IDE.</p>;
  }

  return (
    <>
      <CodeTree
        roots={visibleRoots}
        loading={rootsLoading}
        error={rootsError}
        onRetry={() => void reloadRoots()}
        onAddRoot={() => void handleAddRoot()}
        adding={adding}
        onRemoveRoot={setConfirmRemove}
        onOpenFile={handleOpenFile}
        onTerminalAt={handleTerminalAt}
        onAddToScope={handleAddToScope}
        reveal={treeReveal}
        refresh={treeRefresh}
        projectNames={projectNames}
        currentProjectId={selectedProjectId}
        currentProjectName={
          selectedProjectId === null ? null : (projectNames[selectedProjectId] ?? null)
        }
        onSetRootProject={(root, projectId) => void handleSetRootProject(root, projectId)}
        associatingRootId={associatingRootId}
        onReplicateRoot={setReplicateRoot}
        mapHidden={mapHidden}
        onToggleMapRoot={toggleMapRoot}
        archScope={archScope}
        onFocusProject={(rootId, rel) => {
          // Focusing opens the eye, records the service, and narrows
          // the board to it; the eye alone never changes the scope.
          openService(rootId, rel);
          setArchScope({ kind: "project", rootId, rel });
        }}
        folderSelection={folderSelection}
        onSelectFolder={(rootId, rel) => setCodeFolderSelection({ rootId, rel })}
        onAnalyzeFolder={(rootId, rel) => setArchScope({ kind: "folder", rootId, rel })}
        onAskMuse={(rootId, rel, kind) => setMuseTarget({ rootId, rel, kind })}
        onSetRootAiBlocked={(root, blocked) => {
          void setRootAiBlocked(root.id, blocked)
            .then(() => useRequirementsUi.getState().bumpCodeLibrary())
            .catch((raw) => setAiBlockError(normalizeCodeError(raw).message));
        }}
        hiddenProjects={hiddenProjects}
        openedProjects={openedProjects}
        onToggleMapProject={(key, show) => {
          if (show) {
            const sep = key.indexOf("::");
            openService(key.slice(0, sep), key.slice(sep + 2));
          } else {
            setMapProjectHidden(key, true);
          }
        }}
      />
      {aiBlockError !== null && (
        <p className="error" role="alert">
          {aiBlockError}
        </p>
      )}
      {addError !== null && (
        <p className="error" role="alert">
          {addError}
        </p>
      )}
      {addConfirm !== null && (
        <div className="modal-backdrop" onClick={cancelAddFolder}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Move folder to this project"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Move folder to this project?</h3>
            <p>
              &ldquo;{addConfirm.root.name}&rdquo; already belongs to project &ldquo;
              {projectNames[addConfirm.fromProjectId] ?? addConfirm.fromProjectId}&rdquo;. Moving
              it here removes it from there. No file changes on disk.
            </p>
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={adding}
                onClick={() => void confirmAddFolder()}
              >
                {adding ? "Moving…" : "Move here"}
              </button>
              <button type="button" className="secondary" onClick={cancelAddFolder} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {scopeNotice !== null && (
        <p className="notice" role="status">
          {scopeNotice}
        </p>
      )}
      {confirmRemove !== null && (
        <div className="modal-backdrop" onClick={() => setConfirmRemove(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Remove folder from the workspace"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Remove folder from the workspace</h3>
            <p>
              "{confirmRemove.name}" will disappear from Ruth. No file is deleted on disk.
              {tabsOfRoot(tabs, confirmRemove.id).length > 0 &&
                ` ${tabsOfRoot(tabs, confirmRemove.id).length} tabs from this folder will close.`}
              {removeDirtyCount > 0 &&
                ` ${removeDirtyCount} have unsaved changes.`}
            </p>
            <div className="button-row">
              {removeDirtyCount > 0 ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    disabled={removing}
                    onClick={() => void handleRemoveRootSaveFirst(confirmRemove)}
                  >
                    {removing ? "Saving…" : "Save all and remove"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={removing}
                    onClick={() => void doRemoveRoot(confirmRemove)}
                  >
                    Remove without saving
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary"
                  disabled={removing}
                  onClick={() => void doRemoveRoot(confirmRemove)}
                >
                  {removing ? "Removing…" : "Remove"}
                </button>
              )}
              <button type="button" className="secondary" onClick={() => setConfirmRemove(null)} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {replicateRoot !== null && (
        <ReplicateDialog
          root={replicateRoot}
          onClose={() => setReplicateRoot(null)}
          onDone={handleReplicated}
        />
      )}
    </>
  );
}
