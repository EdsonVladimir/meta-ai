// Welcome screen: the launch state without an open workspace.
// Three explicit entries plus saved workspaces. No empty analysis
// panels, no forced requirements or modules.
import { AllProjectsList } from "./AllProjectsList";
import { RecentsList } from "./RecentsList";
import type { ProjectDto } from "../requirements/types";
import type { RecentWorkspaceDto } from "./types";

interface WelcomeScreenProps {
  recents: RecentWorkspaceDto[];
  recentsLoading: boolean;
  recentsError: string | null;
  projects: ProjectDto[];
  projectsLoading: boolean;
  projectsError: string | null;
  busy: boolean;
  busyRecentId: string | null;
  busyProjectId: string | null;
  error: string | null;
  onOpenProject: () => void;
  onOpenRecent: (recent: RecentWorkspaceDto) => void;
  onRemoveRecent: (id: string) => void;
  onNewProject: () => void;
  onOpenProjectById: (projectId: string) => void;
  onRetryRecents: () => void;
  onRetryProjects: () => void;
}

export function WelcomeScreen({
  recents,
  recentsLoading,
  recentsError,
  projects,
  projectsLoading,
  projectsError,
  busy,
  busyRecentId,
  busyProjectId,
  error,
  onOpenProject,
  onOpenRecent,
  onRemoveRecent,
  onNewProject,
  onOpenProjectById,
  onRetryRecents,
  onRetryProjects,
}: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <h2>Start with a project</h2>
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
        <div className="welcome-action">
        <button
          type="button"
          className="primary"
          disabled={busy}
          title="Pick a folder: reuses its project when known, otherwise registers it"
          onClick={onOpenProject}
        >
          Open project
        </button>
        <span className="hint">Use a folder you already have. It reuses its project if known.</span>
        </div>
        <div className="welcome-action">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          title="Start without folders or code; add them later"
          onClick={onNewProject}
        >
          New project
        </button>
        <span className="hint">Start with requirements and designs. Add code later.</span>
        </div>
      </div>
      <h3>Recent workspaces</h3>
      <p className="hint">A workspace is a saved project with its folders.</p>
      <RecentsList
        recents={recents}
        loading={recentsLoading}
        error={recentsError}
        busyId={busyRecentId ?? busyProjectId}
        restoreError={null}
        onOpen={onOpenRecent}
        onRemove={onRemoveRecent}
        onRetry={onRetryRecents}
      />
      <h3>All projects</h3>
      <p className="hint">Every stored project, with or without folders.</p>
      <AllProjectsList
        projects={projects}
        loading={projectsLoading}
        error={projectsError}
        busyId={busyProjectId}
        busyRecentId={busyRecentId}
        onOpen={onOpenProjectById}
        onRetry={onRetryProjects}
      />
    </div>
  );
}
