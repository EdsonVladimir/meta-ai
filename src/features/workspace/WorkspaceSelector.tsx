// Header workspace selector: current workspace, one-click switching to
// saved workspaces, and open/new/close entries. Pure presentational:
// all flows are injected callbacks.
import { useState } from "react";
import type { RecentWorkspaceDto } from "./types";

interface WorkspaceSelectorProps {
  /** Current workspace label, or null when on welcome. */
  label: string | null;
  sublabel: string | null;
  recents: RecentWorkspaceDto[];
  busy: boolean;
  onOpenProject: () => void;
  onNewProject: () => void;
  onOpenRecent: (recent: RecentWorkspaceDto) => void;
  onSwitchWorkspace: () => void;
  onCloseWorkspace: () => void;
}

export function WorkspaceSelector({
  label,
  sublabel,
  recents,
  busy,
  onOpenProject,
  onNewProject,
  onOpenRecent,
  onSwitchWorkspace,
  onCloseWorkspace,
}: WorkspaceSelectorProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <div className="workspace-selector">
      <button
        type="button"
        className="workspace-current"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        title={label === null ? "Open a workspace" : `Workspace: ${label}`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="workspace-label">{label ?? "No workspace"}</span>
        {sublabel !== null && <span className="hint">{sublabel}</span>}
      </button>
      {open && (
        <div className="workspace-menu" role="menu" aria-label="Workspace">
          {recents.length > 0 && (
            <>
              <p className="workspace-menu-head" aria-hidden="true">
                Recent
              </p>
              {recents.slice(0, 8).map((recent) => (
                <button
                  key={recent.id}
                  type="button"
                  role="menuitem"
                  className="workspace-item"
                  title={recent.rootPaths.join("\n") || "Project without folders"}
                  onClick={() => {
                    close();
                    onOpenRecent(recent);
                  }}
                >
                  {recent.label}
                  {recent.missingPaths.length > 0 && (
                    <span className="hint"> · {recent.missingPaths.length} missing</span>
                  )}
                </button>
              ))}
            </>
          )}
          <p className="workspace-menu-head" aria-hidden="true">
            Workspace
          </p>
          <button
            type="button"
            role="menuitem"
            className="workspace-item"
            onClick={() => {
              close();
              onOpenProject();
            }}
          >
            Open project…
          </button>
          <button
            type="button"
            role="menuitem"
            className="workspace-item"
            onClick={() => {
              close();
              onNewProject();
            }}
          >
            New project
          </button>
          {label !== null && (
            <>
              <button
                type="button"
                role="menuitem"
                className="workspace-item"
                onClick={() => {
                  close();
                  onSwitchWorkspace();
                }}
              >
                Switch workspace
              </button>
              <button
                type="button"
                role="menuitem"
                className="workspace-item"
                onClick={() => {
                  close();
                  onCloseWorkspace();
                }}
              >
                Close workspace
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
