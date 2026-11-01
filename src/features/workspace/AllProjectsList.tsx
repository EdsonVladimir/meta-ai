// All-projects list: every stored project opens from here, with or
// without a Recents entry or folders. No project becomes
// unreachable; forgetting a recent never touches this list.
import type { ProjectDto } from "../requirements/types";

interface AllProjectsListProps {
  projects: ProjectDto[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  busyRecentId: string | null;
  onOpen: (projectId: string) => void;
  onRetry: () => void;
}

export function AllProjectsList({
  projects,
  loading,
  error,
  busyId,
  busyRecentId,
  onOpen,
  onRetry,
}: AllProjectsListProps) {
  if (loading) {
    return (
      <p className="hint" role="status">
        Loading projects…
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
  if (projects.length === 0) {
    return <p className="hint">No projects yet. Open a folder or create a project.</p>;
  }
  const busy = busyId !== null || busyRecentId !== null;
  return (
    <ul className="recents-list">
      {projects.map((project) => (
        <li key={project.id} className="recent-row">
          <button
            type="button"
            className="recent-open"
            disabled={busy}
            title={busyId === project.id ? "Opening…" : `Open ${project.name}`}
            onClick={() => onOpen(project.id)}
          >
            <span className="recent-label">{project.name}</span>
            <span className="hint">{busyId === project.id ? "Opening…" : "Stored project"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
