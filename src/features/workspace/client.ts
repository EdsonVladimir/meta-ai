// Saved workspaces client: `recent_*` Tauri commands.
// Without Tauri (browser), honest error: nothing is simulated.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import type { RecentWorkspaceDto, TouchRecentInput, WorkspaceError } from "./types";

export { isTauriEnvironment };
export type { RecentWorkspaceDto, TouchRecentInput, WorkspaceError };

function notDesktop(): WorkspaceError {
  return {
    kind: "not_tauri",
    message: "Saved workspaces need the Ruth IDE desktop app.",
  };
}

export function normalizeWorkspaceError(raw: unknown): WorkspaceError {
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "unknown";
    const message =
      typeof record.message === "string" ? record.message : "Unknown workspace error.";
    return { kind, message };
  }
  if (typeof raw === "string") return { kind: "unknown", message: raw };
  return { kind: "unknown", message: "Unknown workspace error." };
}

export async function listRecents(): Promise<RecentWorkspaceDto[]> {
  if (!isTauriEnvironment()) throw notDesktop();
  try {
    return await invoke<RecentWorkspaceDto[]>("recent_list");
  } catch (raw) {
    throw normalizeWorkspaceError(raw);
  }
}

export async function touchRecent(input: TouchRecentInput): Promise<RecentWorkspaceDto> {
  if (!isTauriEnvironment()) throw notDesktop();
  try {
    return await invoke<RecentWorkspaceDto>("recent_touch", {
      input: {
        id: input.id ?? null,
        label: input.label,
        projectId: input.projectId ?? null,
        rootPaths: input.rootPaths,
      },
    });
  } catch (raw) {
    throw normalizeWorkspaceError(raw);
  }
}

export async function removeRecent(id: string): Promise<void> {
  if (!isTauriEnvironment()) throw notDesktop();
  try {
    await invoke("recent_remove", { input: { id } });
  } catch (raw) {
    throw normalizeWorkspaceError(raw);
  }
}
