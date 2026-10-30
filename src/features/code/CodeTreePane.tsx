// Left code panel: workspace folders. It shares the session with the
// editor through the provider (a single truth).
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
  const hiddenProjects = useRequirementsUi((s) => s.mapHiddenProjects);
  const toggleMapProject = useRequirementsUi((s) => s.toggleMapProject);

  if (!desktop) {
    return <p className="hint">The code workspace requires desktop Ruth IDE.</p>;
  }

  return (
    <>
      <CodeTree
        roots={roots}
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
        onArchScope={setArchScope}
        folderSelection={folderSelection}
        onSelectFolder={(rootId, rel) => setCodeFolderSelection({ rootId, rel })}
        onAnalyzeFolder={(rootId, rel) => setArchScope({ kind: "folder", rootId, rel })}
        hiddenProjects={hiddenProjects}
        onToggleMapProject={toggleMapProject}
      />
      {addError !== null && (
        <p className="error" role="alert">
          {addError}
        </p>
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
