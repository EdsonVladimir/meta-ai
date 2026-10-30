// Saved workspaces (recents): DTOs shared by the welcome screen,
// the header selector and the restore flow. References only.
export interface RecentWorkspaceDto {
  id: string;
  label: string;
  projectId: string | null;
  rootPaths: string[];
  /** Stored paths that are not directories right now. */
  missingPaths: string[];
  lastOpened: string;
  createdAt: string;
}

export interface WorkspaceError {
  kind: string;
  message: string;
}

export interface TouchRecentInput {
  id?: string | null;
  label: string;
  projectId?: string | null;
  rootPaths: string[];
}
