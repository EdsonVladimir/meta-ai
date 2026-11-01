// @vitest-environment jsdom
// Close-gate decisions: mode, wording, trigger, pending Muse
// notice, post-close error surface, replication notice.
import { describe, expect, it } from "vitest";
import {
  closeGateCopy,
  closeGateMode,
  needsCloseGate,
  pendingMuseNotice,
  postCloseErrorSurface,
  replicationCancelNotice,
} from "./closeGate";

describe("closeGateMode", () => {
  it("calls a switch a switch and a close a close", () => {
    expect(closeGateMode(true)).toBe("switch");
    expect(closeGateMode(false)).toBe("close");
  });
});

describe("closeGateCopy", () => {
  it("matches the switch button to the switch title", () => {
    expect(closeGateCopy("switch", false, false)).toEqual({
      title: "Switch project?",
      saveLabel: null,
      closeLabel: "Switch project",
    });
    expect(closeGateCopy("switch", true, false)).toEqual({
      title: "Switch project?",
      saveLabel: "Save all and switch",
      closeLabel: "Switch without saving",
    });
    expect(closeGateCopy("switch", true, true).saveLabel).toBe("Saving…");
  });

  it("keeps Close workspace for a real close", () => {
    expect(closeGateCopy("close", false, false)).toEqual({
      title: "Close workspace?",
      saveLabel: null,
      closeLabel: "Close workspace",
    });
    expect(closeGateCopy("close", true, false).saveLabel).toBe("Save all and close");
    expect(closeGateCopy("close", true, false).closeLabel).toBe("Close without saving");
  });
});

describe("needsCloseGate", () => {
  const clean = { dirtyCount: 0, terminalCount: 0, terminalsUnknown: false, musePending: 0 };
  it("stays shut when nothing needs settling", () => {
    expect(needsCloseGate(clean)).toBe(false);
  });

  it("opens for dirty documents, terminals, or unknown terminals", () => {
    expect(needsCloseGate({ ...clean, dirtyCount: 1 })).toBe(true);
    expect(needsCloseGate({ ...clean, terminalCount: 2 })).toBe(true);
    expect(needsCloseGate({ ...clean, terminalsUnknown: true })).toBe(true);
  });

  it("opens for pending Muse files", () => {
    expect(needsCloseGate({ ...clean, musePending: 3 })).toBe(true);
  });
});

describe("pendingMuseNotice", () => {
  it("says nothing without pending files", () => {
    expect(pendingMuseNotice(0)).toBeNull();
  });

  it("reuses the thread-closing words", () => {
    expect(pendingMuseNotice(1)).toBe(
      "1 file is still pending. Closing removes these conversations, " +
        "and those proposals can then only be reopened from Propose with Muse.",
    );
    expect(pendingMuseNotice(2)).toContain("2 files are still pending.");
  });
});

describe("postCloseErrorSurface", () => {
  it("sends post-close errors to Welcome and the rest to the navigator", () => {
    expect(postCloseErrorSurface("welcome")).toBe("welcome");
    expect(postCloseErrorSurface("architecture")).toBe("nav");
    expect(postCloseErrorSurface("requirements")).toBe("nav");
  });
});

describe("replicationCancelNotice", () => {
  it("names the project and where to find it", () => {
    expect(replicationCancelNotice("Shop")).toBe(
      "Project “Shop” was created. Open it from Recents on the Welcome screen.",
    );
  });
});
