// Mockup detail: validates the shown version in Rust (structural, no API
// consumption), summarizes screens and components, and offers the visual
// editor in the second tab. Informs the review whether the shown version
// is validated: approval requires that state plus revalidation in Rust.
// Only the canonical mount edits (the rest and historic versions are
// read-only).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  approvalsForVersion,
  currentVersion,
  normalizeCoreError,
  type RequirementDetail,
  type VersionDto,
} from "../requirements/types";
import { validateMockup, type ValidatedMockupDto } from "./client";
import type { MockupDraftAction, MockupDraftState } from "./mockupDraft";
import type { MockupSaveState } from "./MockupEditor";

const MockupEditor = lazy(() =>
  import("./MockupEditor").then((module) => ({ default: module.MockupEditor })),
);

/** Draft wiring. Missing = read-only mount. */
export interface MockupDetailEditing {
  projectId: string;
  moduleId: string;
  draft: MockupDraftState | null;
  onAction: (action: MockupDraftAction) => void;
  save: MockupSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
  onDeclareSources: (pins: string[], allowed: string[]) => void;
}

interface MockupDetailProps {
  detail: RequirementDetail;
  viewing: VersionDto | null;
  onBackToCurrent: () => void;
  onValidatedVersion: (versionId: string, ok: boolean) => void;
  editing?: MockupDetailEditing;
  /**
   * Rename the mockup; missing = no action (reading, historic or
   * archived). Receives the detail to derive the target.
   */
  onRename?: () => void;
  /** Archived mockup: no renaming until restored. */
  renameDisabled?: boolean;
  /**
   * Open the "Generate design" dialog with this mockup preselected as a
   * source. Missing = no action (historic reading). Never generates alone.
   */
  onGenerateDesign?: () => void;
  /** Screen requested from outside (tree). */
  screenId?: string | null;
  onScreenChange?: (id: string | null) => void;
}

export function MockupDetail({
  detail,
  viewing,
  onBackToCurrent,
  onValidatedVersion,
  editing,
  onRename,
  renameDisabled = false,
  onGenerateDesign,
  screenId = null,
  onScreenChange,
}: MockupDetailProps) {
  const current = currentVersion(detail);
  const shown = viewing ?? current;
  const [validated, setValidated] = useState<ValidatedMockupDto | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "canvas">("summary");
  const cancelledRef = useRef(false);
  const notifyRef = useRef(onValidatedVersion);
  notifyRef.current = onValidatedVersion;

  const artifactId = detail.artifact.id;
  const title = detail.artifact.title;
  const shownId = shown?.id ?? "";
  const shownContent = shown?.content ?? "";

  useEffect(() => {
    cancelledRef.current = false;
    setValidated(null);
    setValidateError(null);
    notifyRef.current(shownId, false);
    if (shownId === "") return;
    void (async () => {
      let spec: unknown;
      try {
        spec = JSON.parse(shownContent) as unknown;
      } catch {
        if (cancelledRef.current) return;
        setValidateError("The saved content is not valid JSON.");
        return;
      }
      try {
        const result = await validateMockup(spec);
        if (cancelledRef.current) return;
        setValidated(result);
        notifyRef.current(shownId, true);
      } catch (raw) {
        if (cancelledRef.current) return;
        setValidateError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [artifactId, shownId, shownContent]);

  const approvals = shown ? approvalsForVersion(detail, shown.id) : [];

  useEffect(() => {
    setTab("summary");
  }, [artifactId]);

  return (
    <section className="editor design-detail" aria-label="Mockup detail">
      <div className="editor-head">
        <h3>
          {title !== null && title !== "" ? (
            <>
              {title} <code>{artifactId}</code>
            </>
          ) : (
            <code>{artifactId}</code>
          )}{" "}
          · mockup · v{shown?.number}{" "}
          {viewing !== null ? (
            <span className="badge">read-only</span>
          ) : (
            <span className="badge">current</span>
          )}
        </h3>
        {viewing !== null && (
          <button type="button" className="secondary small" onClick={onBackToCurrent}>
            Back to current (v{current?.number})
          </button>
        )}
        {onRename !== undefined && viewing === null && (
          <button
            type="button"
            className="secondary small"
            onClick={onRename}
            disabled={renameDisabled}
            title={renameDisabled ? "Restore the mockup before renaming it" : "Rename mockup"}
          >
            Rename
          </button>
        )}
        {onGenerateDesign !== undefined && viewing === null && (
          <button
            type="button"
            className="primary small"
            onClick={onGenerateDesign}
            title="Propose a flow or ER with Meta using this mockup as a source"
          >
            Generate design
          </button>
        )}
      </div>

      {shown && (
        <dl className="facts">
          <div>
            <dt>Origin</dt>
            <dd>
              {shown.provenance.kind === "ai"
                ? `AI proposal (${shown.provenance.by})`
                : shown.provenance.by}
            </dd>
          </div>
          <div>
            <dt>Review</dt>
            <dd>
              {approvals.length === 0
                ? "Unreviewed"
                : approvals.map((a) => `${a.approvedBy} · ${a.at}`).join("; ")}
            </dd>
          </div>
          <div>
            <dt>Sources</dt>
            <dd>
              {shown.sources.length === 0
                ? "No dependencies"
                : shown.sources.join(", ")}
            </dd>
          </div>
        </dl>
      )}

      <div className="tabs" role="tablist" aria-label="Mockup views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "summary"}
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "canvas"}
          className={tab === "canvas" ? "active" : ""}
          onClick={() => setTab("canvas")}
        >
          {editing !== undefined ? "Editor" : "Canvas"}
        </button>
      </div>

      {tab === "summary" ? (
        <>
          {validateError !== null && (
            <p className="error" role="alert">
              {validateError}
            </p>
          )}
          {validated !== null && (
            <dl className="facts">
              <div>
                <dt>Title</dt>
                <dd>{validated.title}</dd>
              </div>
              <div>
                <dt>Screens</dt>
                <dd>{validated.screens}</dd>
              </div>
              <div>
                <dt>Components</dt>
                <dd>{validated.components}</dd>
              </div>
            </dl>
          )}
          <p className="hint">
            The summary is validated in Rust when shown; draw and edit in the{" "}
            {editing !== undefined ? "Editor" : "Canvas"} tab.
          </p>
        </>
      ) : shown !== undefined && current !== undefined ? (
        <Suspense fallback={<p className="hint">Loading editor…</p>}>
          <MockupEditor
            projectId={editing?.projectId ?? detail.artifact.projectId}
            moduleId={editing?.moduleId ?? detail.artifact.moduleId}
            artifactId={artifactId}
            versionId={shown.id}
            currentVersionId={current.id}
            content={shown.content}
            currentPins={current.sources}
            editable={editing !== undefined}
            draft={editing?.draft ?? null}
            onAction={editing?.onAction ?? (() => {})}
            save={editing?.save ?? { busy: false, error: null }}
            onSave={editing?.onSave ?? (() => {})}
            onSaveLayoutOnly={editing?.onSaveLayoutOnly ?? (() => {})}
            onAdoptPins={editing?.onAdoptPins ?? (() => {})}
            onDeclareSources={editing?.onDeclareSources ?? (() => {})}
            screenId={screenId}
            onScreenChange={onScreenChange ?? (() => {})}
          />
        </Suspense>
      ) : (
        <p className="hint">No version to show.</p>
      )}
    </section>
  );
}
