import { describe, expect, it } from "vitest";
import {
  canApprove,
  draftReducer,
  EMPTY_DRAFT,
  EMPTY_REVIEW,
  needsConfirm,
  resolveSaveTarget,
  reviewReducer,
  saveState,
  shouldApplyResponse,
} from "./coordination";
import { approvalsForVersion, currentVersion, normalizeCoreError } from "./types";

describe("shouldApplyResponse", () => {
  it("applies the latest response of the current selection", () => {
    expect(
      shouldApplyResponse({ key: "req-1", epoch: 3 }, { key: "req-1", epoch: 3 }),
    ).toBe(true);
  });

  it("discards responses from another requirement", () => {
    expect(
      shouldApplyResponse({ key: "req-2", epoch: 3 }, { key: "req-1", epoch: 3 }),
    ).toBe(false);
  });

  it("discards stale responses from the same requirement", () => {
    expect(
      shouldApplyResponse({ key: "req-1", epoch: 4 }, { key: "req-1", epoch: 3 }),
    ).toBe(false);
  });
});

describe("needsConfirm", () => {
  it("allows navigating without a dirty draft", () => {
    expect(needsConfirm(false, "req-1", "req-2")).toBe(false);
  });

  it("allows re-selecting the same requirement", () => {
    expect(needsConfirm(true, "req-1", "req-1")).toBe(false);
  });

  it("asks for confirmation when switching with a dirty draft", () => {
    expect(needsConfirm(true, "req-1", "req-2")).toBe(true);
    expect(needsConfirm(true, "req-1", null)).toBe(true);
  });
});

describe("draftReducer", () => {
  it("editing marks the draft as dirty", () => {
    const next = draftReducer(
      { requirementId: "req-1", content: "a", base: "a", rev: 0, dirty: false },
      { type: "edit", content: "b" },
    );
    expect(next).toEqual({ requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true });
  });

  it("rewriting the saved content clears what is pending", () => {
    const dirty = { requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true };
    expect(draftReducer(dirty, { type: "edit", content: "a" })).toEqual({
      requirementId: "req-1",
      content: "a",
      base: "a",
      rev: 2,
      dirty: false,
    });
  });

  it("a refresh does not overwrite the dirty draft", () => {
    const dirty = { requirementId: "req-1", content: "mine", base: "v1", rev: 1, dirty: true };
    expect(
      draftReducer(dirty, { type: "snapshot", requirementId: "req-1", content: "otro" }),
    ).toBe(dirty);
  });

  it("a refresh adopts content with a clean draft", () => {
    expect(
      draftReducer(EMPTY_DRAFT, {
        type: "snapshot",
        requirementId: "req-1",
        content: "v3",
      }),
    ).toEqual({ requirementId: "req-1", content: "v3", base: "v3", rev: 0, dirty: false });
  });

  it("a failed save keeps the draft", () => {
    const dirty = { requirementId: "req-1", content: "mine", base: "v1", rev: 1, dirty: true };
    expect(draftReducer(dirty, { type: "saveFailed" })).toBe(dirty);
  });

  it("the result only clears its own request", () => {
    const dirty = { requirementId: "req-1", content: "b", base: "a", rev: 1, dirty: true };
    expect(
      draftReducer(dirty, { type: "saved", requirementId: "req-1", content: "b", rev: 1 }),
    ).toEqual({ requirementId: "req-1", content: "b", base: "b", rev: 1, dirty: false });
  });

  it("edits made during the save survive the earlier result", () => {
    const edited = { requirementId: "req-1", content: "c", base: "a", rev: 2, dirty: true };
    // The `saved` belonged to rev 1: it never touches the new content.
    expect(
      draftReducer(edited, { type: "saved", requirementId: "req-1", content: "b", rev: 1 }),
    ).toBe(edited);
    // Nor another requirement's.
    expect(
      draftReducer(edited, { type: "saved", requirementId: "req-9", content: "c", rev: 2 }),
    ).toBe(edited);
  });

  it("explicit discard resyncs unconditionally", () => {
    const dirty = { requirementId: "req-1", content: "mine", base: "v1", rev: 4, dirty: true };
    expect(
      draftReducer(dirty, { type: "discard", requirementId: "req-1", content: "v1" }),
    ).toEqual({ requirementId: "req-1", content: "v1", base: "v1", rev: 4, dirty: false });
  });

  it("changing selection clears the draft", () => {
    const dirty = { requirementId: "req-1", content: "mine", base: "v1", rev: 3, dirty: true };
    expect(draftReducer(dirty, { type: "select", requirementId: "req-2" })).toEqual({
      requirementId: "req-2",
      content: "",
      base: "",
      rev: 0,
      dirty: false,
    });
  });
});

describe("reviewReducer", () => {
  it("checking pins the reviewed version and unchecking clears it", () => {
    const on = reviewReducer(
      EMPTY_REVIEW,
      { type: "toggle", versionId: "req-1-v2", checked: true },
    );
    expect(on.reviewedVersionId).toBe("req-1-v2");
    expect(
      reviewReducer(on, { type: "toggle", versionId: "req-1-v2", checked: false }),
    ).toEqual(EMPTY_REVIEW);
  });

  it("reset clears the confirmation", () => {
    expect(reviewReducer({ reviewedVersionId: "req-1-v2" }, { type: "reset" })).toEqual(
      EMPTY_REVIEW,
    );
  });
});

describe("canApprove", () => {
  const base = {
    reviewedVersionId: "req-1-v2",
    currentVersionId: "req-1-v2",
    dirty: false,
    approver: "ana",
    busy: false,
  };

  it("allows approving with a current confirmation and a clean draft", () => {
    expect(canApprove(base)).toBe(true);
  });

  it("forbids approving with unsaved changes", () => {
    expect(canApprove({ ...base, dirty: true })).toBe(false);
  });

  it("forbids approving a version other than the confirmed one", () => {
    expect(canApprove({ ...base, currentVersionId: "req-1-v3" })).toBe(false);
  });

  it("forbids approving without an author or while an operation runs", () => {
    expect(canApprove({ ...base, approver: "  " })).toBe(false);
    expect(canApprove({ ...base, busy: true })).toBe(false);
  });
});

describe("normalizeCoreError", () => {
  it("keeps a stable kind and message", () => {
    expect(normalizeCoreError({ kind: "stale_version", message: "changed" })).toEqual({
      kind: "stale_version",
      message: "changed",
    });
  });

  it("degrades unknown shapes to unexpected", () => {
    expect(normalizeCoreError("boom")).toEqual({
      kind: "unexpected",
      message: "Unexpected operation error.",
    });
    expect(normalizeCoreError({ kind: 7 })).toEqual({
      kind: "unexpected",
      message: "Unexpected operation error.",
    });
  });
});

describe("detail selectors", () => {
  const detail = {
    artifact: { id: "req-1", projectId: "proy-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
    versions: [
      { id: "req-1-v1", number: 1, content: "a", provenance: { kind: "human", by: "ana" }, sources: [] },
      { id: "req-1-v2", number: 2, content: "b", provenance: { kind: "human", by: "ana" }, sources: [] },
    ],
    approvals: [{ versionId: "req-1-v1", approvedBy: "bruno", at: "2026-10-27" }],
    currentVersionId: "req-1-v2",
  };

  it("finds the current version", () => {
    expect(currentVersion(detail)?.id).toBe("req-1-v2");
  });

  it("derives approvals per version without flags", () => {
    expect(approvalsForVersion(detail, "req-1-v1")).toHaveLength(1);
    expect(approvalsForVersion(detail, "req-1-v2")).toHaveLength(0);
  });
});

describe("saveState", () => {
  it("idles without a selection", () => {
    expect(
      saveState({ hasSelection: false, saving: false, error: null, dirty: false }),
    ).toBe("idle");
  });

  it("tells local draft and saved apart", () => {
    expect(
      saveState({ hasSelection: true, saving: false, error: null, dirty: true }),
    ).toBe("draft");
    expect(
      saveState({ hasSelection: true, saving: false, error: null, dirty: false }),
    ).toBe("saved");
  });

  it("saving takes priority over draft and error", () => {
    expect(
      saveState({ hasSelection: true, saving: true, error: "x", dirty: true }),
    ).toBe("saving");
  });

  it("the error shows until the next attempt", () => {
    expect(
      saveState({ hasSelection: true, saving: false, error: "failure", dirty: true }),
    ).toBe("error");
  });
});

describe("resolveSaveTarget", () => {
  const base = {
    requirementId: "req-1",
    designId: "flujo-1",
    mockupId: "mock-1",
    requirementDirty: false,
    designDirty: false,
    designKeyOk: true,
    mockupDirty: false,
    mockupKeyOk: true,
  };

  it("routes to each dirty editor and to none when clean", () => {
    expect(
      resolveSaveTarget({ ...base, centerView: "requirements", requirementDirty: true }),
    ).toBe("requirement");
    expect(
      resolveSaveTarget({ ...base, centerView: "design", designDirty: true }),
    ).toBe("design");
    expect(
      resolveSaveTarget({ ...base, centerView: "mockups", mockupDirty: true }),
    ).toBe("mockup");
    expect(resolveSaveTarget({ ...base, centerView: "requirements" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "design" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "impact" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "traceability" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "overview" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "architecture" })).toBeNull();
    expect(resolveSaveTarget({ ...base, centerView: "welcome" })).toBeNull();
  });

  it("never saves detached designs or without a selection", () => {
    expect(
      resolveSaveTarget({ ...base, centerView: "design", designDirty: true, designKeyOk: false }),
    ).toBeNull();
    expect(
      resolveSaveTarget({
        ...base,
        centerView: "design",
        designDirty: true,
        designId: null,
      }),
    ).toBeNull();
    expect(
      resolveSaveTarget({
        ...base,
        centerView: "mockups",
        mockupDirty: true,
        mockupKeyOk: false,
      }),
    ).toBeNull();
  });
});
