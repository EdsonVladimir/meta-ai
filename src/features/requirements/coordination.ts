// Pure requirements-space coordination: which response to apply, when to
// ask for confirmation over an unsaved draft, and when approval is allowed.
// No React, no Tauri: tested with vitest without DOM.
import type { CenterView } from "./uiStore";

export interface ResponseMeta {
  key: string;
  epoch: number;
}

/**
 * A response only applies while it is still the latest one requested for
 * the current selection. That way a late response never replaces another
 * requirement's selection or content.
 */
export function shouldApplyResponse(
  current: ResponseMeta,
  incoming: ResponseMeta,
): boolean {
  return incoming.key === current.key && incoming.epoch === current.epoch;
}

/** Offer save/discard/cancel before switching targets? */
export function needsConfirm(
  dirty: boolean,
  currentRequirementId: string | null,
  targetRequirementId: string | null,
): boolean {
  if (!dirty) return false;
  return currentRequirementId !== targetRequirementId;
}

export interface DraftState {
  requirementId: string | null;
  content: string;
  /** Saved content to compare against: rewriting it clears. */
  base: string;
  /** Edit generation: a late `saved` only counts for its own `rev`. */
  rev: number;
  dirty: boolean;
}

export const EMPTY_DRAFT: DraftState = {
  requirementId: null,
  content: "",
  base: "",
  rev: 0,
  dirty: false,
};

export type DraftAction =
  | { type: "edit"; content: string }
  | { type: "snapshot"; requirementId: string; content: string }
  | { type: "saved"; requirementId: string; content: string; rev: number }
  | { type: "saveFailed" }
  | { type: "discard"; requirementId: string; content: string }
  | { type: "select"; requirementId: string | null };

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "edit":
      return { ...state, content: action.content, rev: state.rev + 1, dirty: action.content !== state.base };
    case "snapshot":
      // A refresh never overwrites a draft with unsaved changes.
      if (state.dirty) return state;
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "saved":
      // Only THIS request's result clears: if edits happened during the
      // save (different rev) or the draft belongs to another requirement,
      // the new content stays dirty and will save as another version.
      if (action.rev !== state.rev || action.requirementId !== state.requirementId) {
        return state;
      }
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "saveFailed":
      // An error (e.g. concurrency) keeps the draft intact.
      return state;
    case "discard":
      // The person's explicit discard: resyncs unconditionally.
      return {
        requirementId: action.requirementId,
        content: action.content,
        base: action.content,
        rev: state.rev,
        dirty: false,
      };
    case "select":
      return { requirementId: action.requirementId, content: "", base: "", rev: 0, dirty: false };
  }
}

export interface ReviewState {
  reviewedVersionId: string | null;
}

export const EMPTY_REVIEW: ReviewState = { reviewedVersionId: null };

export type ReviewAction =
  | { type: "toggle"; versionId: string; checked: boolean }
  | { type: "reset" };

export function reviewReducer(_state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "toggle":
      return { reviewedVersionId: action.checked ? action.versionId : null };
    case "reset":
      return EMPTY_REVIEW;
  }
}

/**
 * Visible save state: local draft, saving, saved or error. With no
 * requirement selected there is nothing to save (`idle`).
 */
export type SaveState = "idle" | "draft" | "saving" | "saved" | "error";

export function saveState(input: {
  hasSelection: boolean;
  saving: boolean;
  error: string | null;
  dirty: boolean;
}): SaveState {
  if (!input.hasSelection) return "idle";
  if (input.saving) return "saving";
  if (input.error !== null) return "error";
  if (input.dirty) return "draft";
  return "saved";
}

export interface ApprovalGate {
  reviewedVersionId: string | null;
  currentVersionId: string;
  dirty: boolean;
  approver: string;
  busy: boolean;
}

/**
 * The UI only eases the operation: it requires confirmation of that exact
 * version, a clean draft and an author. Rust revalidates the invariants.
 */
export function canApprove(gate: ApprovalGate): boolean {
  if (gate.busy || gate.dirty) return false;
  if (gate.approver.trim() === "") return false;
  return gate.reviewedVersionId === gate.currentVersionId;
}

/** Document Ctrl+S should target, or none. */
export type SaveTarget = "requirement" | "design" | "mockup";

/**
 * Resolves the Save target (Ctrl+S or button) from the active view, the
 * selection and which drafts hold semantic changes. Pure and tested: no
 * changes, no save (never identical versions).
 */
export function resolveSaveTarget(input: {
  centerView: CenterView;
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
  requirementDirty: boolean;
  designDirty: boolean;
  designKeyOk: boolean;
  mockupDirty: boolean;
  mockupKeyOk: boolean;
}): SaveTarget | null {
  if (input.centerView === "requirements") {
    if (input.requirementId !== null && input.requirementDirty) return "requirement";
    return null;
  }
  if (input.centerView === "design") {
    if (input.designId !== null && input.designDirty && input.designKeyOk) return "design";
    return null;
  }
  if (input.centerView === "mockups") {
    if (input.mockupId !== null && input.mockupDirty && input.mockupKeyOk) return "mockup";
    return null;
  }
  return null;
}
