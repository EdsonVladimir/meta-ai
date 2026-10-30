// Welcome screen: the launch state without an open workspace.
// Three explicit entries plus saved workspaces. No empty analysis
// panels, no forced requirements or modules.
import { RecentsList } from "./RecentsList";
import type { RecentWorkspaceDto } from "./types";

interface WelcomeScreenProps {
  recents: RecentWorkspaceDto[];
  recentsLoading: boolean;
  recentsError: string | null;
  busy: boolean;
  busyRecentId: string | null;
  error: string | null;
  onOpenProject: () => void;
  onOpenRecent: (recent: RecentWorkspaceDto) => void;
  onRemoveRecent: (id: string) => void;
  onNewProject: () => void;
  onRetryRecents: () => void;
}

export function WelcomeScreen({
  recents,
  recentsLoading,
  recentsError,
  busy,
  busyRecentId,
  error,
  onOpenProject,
  onOpenRecent,
  onRemoveRecent,
  onNewProject,
  onRetryRecents,
}: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <h2>Open a workspace to start</h2>
      <p className="hint">
        Ruth keeps requirements, mockups, diagrams and code as connected views of the same
        project. Nothing here creates files in your repositories.
      </p>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="welcome-actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          title="Pick a folder: reuses its project when known, otherwise registers it"
          onClick={onOpenProject}
        >
          Open project
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          title="Start without folders or code; add them later"
          onClick={onNewProject}
        >
          New project
        </button>
      </div>
      <h3>Recent workspaces</h3>
      <RecentsList
        recents={recents}
        loading={recentsLoading}
        error={recentsError}
        busyId={busyRecentId}
        restoreError={null}
        onOpen={onOpenRecent}
        onRemove={onRemoveRecent}
        onRetry={onRetryRecents}
      />
    </div>
  );
}
