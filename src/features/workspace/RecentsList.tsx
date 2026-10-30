// Saved workspaces list: one-click reopen, per-entry restore state,
// honest missing-path badges. Removing forgets the reference only.
import type { RecentWorkspaceDto } from "./types";

interface RecentsListProps {
  recents: RecentWorkspaceDto[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  restoreError: string | null;
  onOpen: (recent: RecentWorkspaceDto) => void;
  onRemove: (id: string) => void;
  onRetry: () => void;
}

export function RecentsList({
  recents,
  loading,
  error,
  busyId,
  restoreError,
  onOpen,
  onRemove,
  onRetry,
}: RecentsListProps) {
  if (loading) {
    return (
      <p className="hint" role="status">
        Loading saved workspaces…
      </p>
    );
  }
  if (error !== null) {
    return (
      <p className="error" role="alert">
        {error}{" "}
        <button type="button" className="secondary small" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  if (recents.length === 0) {
    return <p className="hint">No saved workspaces yet. Open a folder or create a project.</p>;
  }
  return (
    <div className="recents">
      {restoreError !== null && (
        <p className="error" role="alert">
          {restoreError}
        </p>
      )}
      <ul className="recents-list">
        {recents.map((recent) => {
          const busy = busyId === recent.id;
          return (
            <li key={recent.id} className="recent-row">
              <button
                type="button"
                className="recent-open"
                disabled={busyId !== null}
                title={recent.rootPaths.join("\n") || "Project without folders"}
                onClick={() => onOpen(recent)}
              >
                <span className="recent-label">{recent.label}</span>
                <span className="hint">
                  {busy
                    ? "Opening…"
                    : recent.rootPaths.length === 0
                      ? "No folders"
                      : recent.rootPaths.length === 1
                        ? recent.rootPaths[0]
                        : `${recent.rootPaths.length} folders`}
                </span>
                {recent.missingPaths.length > 0 && (
                  <span className="recent-missing" role="note">
                    {recent.missingPaths.length} missing
                  </span>
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Forget ${recent.label}`}
                title="Forget (keeps the project and its files)"
                disabled={busyId !== null}
                onClick={() => onRemove(recent.id)}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
