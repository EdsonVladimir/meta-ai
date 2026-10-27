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
  /** Versiones fuente de la versión actual (diseños): se muestran, no se editan. */
  sources?: string[] | null;
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
  onToggleReview,
  onApproverChange,
  onApprove,
  onViewVersion,
}: ReviewPanelProps) {
  const current = currentVersion(detail);
  const currentApprovals = current ? approvalsForVersion(detail, current.id) : [];
  const ordered = [...detail.versions].reverse();

  return (
    <aside className="review" aria-label="Revisión e historial">
      <section>
        <h3>Revisión</h3>
        {current === undefined ? (
          <p className="hint">Sin versiones.</p>
        ) : (
          <>
            <dl className="facts">
              <div>
                <dt>Actual</dt>
                <dd>
                  <code>{current.id}</code> (v{current.number})
                </dd>
              </div>
              <div>
                <dt>Aprobación</dt>
                <dd>
                  {currentApprovals.length === 0
                    ? "Sin aprobar"
                    : currentApprovals.map((a) => `${a.approvedBy} · ${a.at}`).join("; ")}
                </dd>
              </div>
              {sources !== undefined && sources !== null && (
                <div>
                  <dt>Fuentes</dt>
                  <dd>
                    {sources.length === 0 ? (
                      "Sin dependencias"
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
                disabled={busy}
              />
              <span>
                He revisado la versión <code>{current.id}</code>
              </span>
            </label>
            <label className="field">
              <span>Persona que aprueba</span>
              <input
                type="text"
                value={approver}
                onChange={(e) => onApproverChange(e.target.value)}
                disabled={busy}
                placeholder="Tu nombre"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className="primary"
              onClick={onApprove}
              disabled={!approveAllowed}
              title={
                dirty
                  ? "Guarda o descarta el borrador antes de aprobar"
                  : reviewedVersionId !== current.id
                    ? "Confirma la revisión de esta versión concreta"
                    : undefined
              }
            >
              {busy ? "Aprobando…" : "Aprobar versión actual"}
            </button>
            {approveError && (
              <p className="error" role="alert">
                {approveError}
              </p>
            )}
            <p className="hint">
              Solo se puede aprobar la versión actual y vigente. La confirmación
              corresponde a esa versión concreta.
            </p>
          </>
        )}
      </section>

      <section>
        <h3>Historial</h3>
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
                    {isCurrent ? "actual · " : ""}
                    {approvals.length === 0
                      ? "sin aprobar"
                      : `aprobada por ${approvals.map((a) => a.approvedBy).join(", ")}`}
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
