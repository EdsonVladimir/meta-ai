import type { ReactNode } from "react";
import type { RequirementDetail } from "./types";
import { approvalsForVersion, currentVersion } from "./types";

interface ReviewPanelProps {
  detail: RequirementDetail;
  reviewedVersionId: string | null;
  approver: string;
  dirty: boolean;
  busy: boolean;
  approveAllowed: boolean;
  approveError: string | null;
  viewingVersionId: string | null;
  /** Source versions of the current one (designs): shown, not edited. */
  sources?: string[] | null;
  /** Effectively archived: history stays readable, no approving. */
  archived: boolean;
  onToggleReview: (versionId: string, checked: boolean) => void;
  onApproverChange: (approver: string) => void;
  onApprove: () => void;
  onViewVersion: (versionId: string) => void;
}

export function ReviewPanel({
  detail,
  reviewedVersionId,
  approver,
  dirty,
  busy,
  approveAllowed,
  approveError,
  viewingVersionId,
  sources,
  archived,
  onToggleReview,
  onApproverChange,
  onApprove,
  onViewVersion,
}: ReviewPanelProps) {
  const current = currentVersion(detail);
  const currentApprovals = current ? approvalsForVersion(detail, current.id) : [];
  const ordered = [...detail.versions].reverse();

  return (
    <aside className="review" aria-label="Review and history">
      <section>
        <h3>Review (optional)</h3>
        <p className="hint">
          Informational: nothing requires reviewing to keep working. Past
          reviews are kept.
        </p>
        {archived && (
          <p className="notice" role="note">
            Archived: history stays readable, but nothing can be reviewed
            until restored.
          </p>
        )}
        {current === undefined ? (
          <p className="hint">No versions.</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>Current</dt>
                <dd>
                  <code>{current.id}</code> (v{current.number})
                </dd>
              </div>
              <div>
                <dt>Review</dt>
                <dd>
                  {currentApprovals.length === 0
                    ? "Not reviewed"
                    : currentApprovals.map((a) => `${a.approvedBy} · ${a.at}`).join("; ")}
                </dd>
              </div>
              {sources !== undefined && sources !== null && (
                <div>
                  <dt>Sources</dt>
                  <dd>
                    {sources.length === 0 ? (
                      "No dependencies"
                    ) : (
                      sources.map((s) => <code key={s}>{s}</code>).reduce<ReactNode[]>(
                        (acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]),
                        [],
                      )
                    )}
                  </dd>
                </div>
              )}
            </dl>
            <label className="check">
              <input
                type="checkbox"
                checked={reviewedVersionId === current.id}
                onChange={(e) => onToggleReview(current.id, e.target.checked)}
                disabled={busy || archived}
              />
              <span>
                I reviewed version <code>{current.id}</code>
              </span>
            </label>
            <label className="field">
              <span>Reviewer</span>
              <input
                type="text"
                value={approver}
                onChange={(e) => onApproverChange(e.target.value)}
                disabled={busy || archived}
                placeholder="Your name"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="primary"
              onClick={onApprove}
              disabled={!approveAllowed}
              title={
                archived
                  ? "Archived: restore it to review"
                  : dirty
                  ? "Save or discard the draft before reviewing"
                  : reviewedVersionId !== current.id
                    ? "Confirm the review of this exact version"
                    : undefined
              }
            >
              {busy ? "Reviewing…" : "Record review"}
            </button>
            {approveError && (
              <p className="error" role="alert">
                {approveError}
              </p>
            )}
            <p className="hint">
              Only the current, live version can be reviewed. The confirmation
              belongs to that exact version.
            </p>
          </>
        )}
      </section>

      <section>
        <h3>History</h3>
        <ul className="pick-list">
          {ordered.map((v) => {
            const approvals = approvalsForVersion(detail, v.id);
            const isCurrent = v.id === detail.currentVersionId;
            return (
              <li key={v.id}>
                <button
                  type="button"
                  className={v.id === viewingVersionId ? "picked" : undefined}
                  onClick={() => onViewVersion(v.id)}
                  aria-current={v.id === viewingVersionId}
                >
                  <code>
                    v{v.number} · {v.id}
                  </code>
                  <span className="hint">
                    {isCurrent ? "current · " : ""}
                    {approvals.length === 0
                      ? "unapproved"
                      : `approved by ${approvals.map((a) => a.approvedBy).join(", ")}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
