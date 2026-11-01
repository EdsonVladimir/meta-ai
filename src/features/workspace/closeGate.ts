// Close-gate decisions: when the gate shows, which mode it uses,
// and what it reports. Pure and tested; the workspace owns the
// dialog and the actions behind it.
import type { CenterView } from "../requirements/uiStore";

/** A switch lands on another project; a close lands on Welcome. */
export type CloseGateMode = "switch" | "close";

export function closeGateMode(hasAfterClose: boolean): CloseGateMode {
  return hasAfterClose ? "switch" : "close";
}

export interface CloseGateCopy {
  title: string;
  /** Null when nothing is saveable (no Save button). */
  saveLabel: string | null;
  closeLabel: string;
}

export function closeGateCopy(
  mode: CloseGateMode,
  dirty: boolean,
  saving: boolean,
): CloseGateCopy {
  if (mode === "switch") {
    return {
      title: "Switch project?",
      saveLabel: dirty ? (saving ? "Saving…" : "Save all and switch") : null,
      closeLabel: dirty ? "Switch without saving" : "Switch project",
    };
  }
  return {
    title: "Close workspace?",
    saveLabel: dirty ? (saving ? "Saving…" : "Save all and close") : null,
    closeLabel: dirty ? "Close without saving" : "Close workspace",
  };
}

export function needsCloseGate(args: {
  dirtyCount: number;
  terminalCount: number;
  terminalsUnknown: boolean;
  musePending: number;
}): boolean {
  return (
    args.dirtyCount > 0 ||
    args.terminalCount > 0 ||
    args.terminalsUnknown ||
    args.musePending > 0
  );
}

/**
 * Pending Muse work, in the thread-closing words: the proposal
 * survives in storage and reopens from Propose with Muse, but the
 * conversation itself lives in memory and goes with the switch.
 */
export function pendingMuseNotice(totalPending: number): string | null {
  if (totalPending <= 0) return null;
  const files = totalPending === 1 ? "1 file is" : `${totalPending} files are`;
  return (
    `${files} still pending. Closing removes these conversations, ` +
    `and those proposals can then only be reopened from Propose with Muse.`
  );
}

/** After a close the workspace is gone: errors belong on Welcome. */
export function postCloseErrorSurface(centerView: CenterView): "welcome" | "nav" {
  return centerView === "welcome" ? "welcome" : "nav";
}

/** A replication survived its cancelled switch: it waits in Recents. */
export function replicationCancelNotice(projectName: string): string {
  return `Project “${projectName}” was created. Open it from Recents on the Welcome screen.`;
}
