// Impact tab (center): header with the change, Before/Now comparison,
// dependency map and artifact table. Presents the Rust report; all query
// state lives above to keep context when coming back.
import { useEffect, useMemo, useRef, useState } from "react";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type ArtifactDto,
  type RequirementDetail,
} from "../requirements/types";
import { ImpactGraph } from "./ImpactGraph";
import { countPendingUnique, impactStatus, paginate } from "./coordination";
import { layoutImpactGraph } from "./layout";
import type { ImpactReportDto, ImpactedDto } from "./types";

const PAGE_SIZE = 8;

export function StatusBadge({ item }: { item: ImpactedDto }) {
  const status = impactStatus(item);
  if (status === "pending") return <span className="badge warn">! Needs review</span>;
  if (status === "awaiting_approval")
    return <span className="badge awaiting">◷ Sources current, review pending</span>;
  return <span className="badge ok">✓ Current</span>;
}

export function kindName(kind: string): string {
  switch (kind) {
    case "requirement":
      return "Requirement";
    case "flow":
      return "Flow";
    case "data_model":
      return "ER model";
    case "mockup":
      return "Mockup";
    default:
      return kind;
  }
}

interface Props {
  projectId: string;
  moduleId: string;
  requirements: ArtifactDto[];
  originId: string | null;
  fromVersionId: string | null;
  report: ImpactReportDto | null;
  busy: boolean;
  error: string | null;
  selectedId: string | null;
  /** Each increment scrolls the view to the comparison. */
  diffSignal: number;
  onOriginChange: (id: string) => void;
  onFromChange: (id: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onOpenArtifact: (artifactId: string, kind: string) => void;
}

export function ImpactTab(props: Props) {
  const { report, originId } = props;
  const [originDetail, setOriginDetail] = useState<RequirementDetail | null>(null);
  const [page, setPage] = useState(0);
  const diffRef = useRef<HTMLDivElement>(null);
  const firstSignal = useRef(props.diffSignal);

  // Origin versions to pick the comparison base.
  useEffect(() => {
    if (originId === null) {
      setOriginDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await getRequirement(originId);
        if (!cancelled && detail.artifact.id === originId) setOriginDetail(detail);
      } catch (raw) {
        if (!cancelled) setOriginDetail(null);
        void normalizeCoreError(raw);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [originId]);

  useEffect(() => {
    setPage(0);
  }, [report]);

  useEffect(() => {
    if (props.diffSignal === firstSignal.current) return;
    diffRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [props.diffSignal]);

  const layout = useMemo(() => {
    if (report === null) return null;
    return layoutImpactGraph({
      originId: report.origin.artifact.id,
      originKind: report.origin.artifact.kind,
      originTitle: report.origin.artifact.title,
      affected: report.affected.map((a) => ({
        id: a.artifact.id,
        kind: a.artifact.kind,
        requiresReview: a.requiresReview,
        awaitingApproval: impactStatus(a) === "awaiting_approval",
        title: a.artifact.title,
      })),
      paths: report.affected.flatMap((a) => a.paths),
    });
  }, [report]);

  const pending = report === null ? 0 : countPendingUnique(report);
  const slice = report === null ? null : paginate(report.affected.length, page, PAGE_SIZE);
  const rows =
    report === null || slice === null ? [] : report.affected.slice(slice.start, slice.end);

  return (
    <div className="impact-tab">
      <header className="impact-head">
        <div className="field">
          <label htmlFor="impact-origin">Requirement</label>
          <select
            id="impact-origin"
            value={originId ?? ""}
            disabled={props.busy || props.requirements.length === 0}
            onChange={(e) => props.onOriginChange(e.target.value)}
          >
            {props.requirements.length === 0 && <option value="">No requirements</option>}
            {props.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="impact-from">Compare from</label>
          <select
            id="impact-from"
            value={props.fromVersionId ?? ""}
            disabled={props.busy || originDetail === null}
            onChange={(e) =>
              props.onFromChange(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">Before current (automatic)</option>
            {(originDetail?.versions ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number} · {v.id}
              </option>
            ))}
          </select>
        </div>
        {report !== null && (
          <p className="pending-badge" role="status">
            <strong>{pending}</strong> pending of{" "}
            {report.affected.length} related
          </p>
        )}
      </header>

      {props.busy && report === null && <p className="hint">Computing impact…</p>}
      {props.error !== null && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
      {report !== null && (
        <>
          <div
            id="impact-diff"
            ref={diffRef}
            className={props.diffSignal > firstSignal.current ? "diff-flash" : undefined}
          >
            <div className="before-after">
              <section aria-label="Before">
                <h4>
                  Before · v{report.origin.fromVersion.number} ({report.origin.fromVersion.id})
                </h4>
                <pre className="readonly-box">{report.origin.fromVersion.content}</pre>
              </section>
              <section aria-label="Now">
                <h4>
                  Now · v{report.origin.currentVersion.number} (
                  {report.origin.currentVersion.id})
                </h4>
                <pre className="readonly-box">{report.origin.currentVersion.content}</pre>
              </section>
            </div>
            {report.origin.fromVersion.id === report.origin.currentVersion.id && (
              <p className="hint">
                The requirement has a single version: nothing to compare yet.
              </p>
            )}
          </div>

          {report.affected.length === 0 ? (
            <p className="notice">
              No dependents: no artifact derives from this requirement, so the change
              reaches nobody.
            </p>
          ) : (
            <>
              {layout !== null && (
                <ImpactGraph
                  layout={layout}
                  selectedId={props.selectedId}
                  onSelect={props.onSelectNode}
                />
              )}
              {layout?.truncated === true && (
                <p className="notice stale" role="note">
                  Truncated map: showing {layout.shown} of {layout.total} artifacts. The table
                  below keeps the full list.
                </p>
              )}
              <table className="impact-table">
                <caption>Related artifacts and pending items</caption>
                <thead>
                  <tr>
                    <th scope="col">Artifact</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Current version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Approval</th>
                    <th scope="col">Sources current</th>
                    <th scope="col">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const fresh = item.pins.filter((p) => !p.stale).length;
                    const selected = props.selectedId === item.artifact.id;
                    return (
                      <tr key={item.artifact.id} className={selected ? "selected" : ""}>
                        <td>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => props.onSelectNode(selected ? null : item.artifact.id)}
                            aria-pressed={selected}
                            title={item.artifact.title ?? item.artifact.id}
                          >
                            {item.artifact.title ?? item.artifact.id}
                          </button>
                        </td>
                        <td>{kindName(item.artifact.kind)}</td>
                        <td>
                          v{item.currentNumber} · {item.currentVersionId}
                        </td>
                        <td>
                          <StatusBadge item={item} />
                        </td>
                        <td>
                          {item.approvals.length > 0
                            ? `✓ ${item.approvals.map((a) => `${a.versionId} by ${a.approvedBy}`).join(", ")}`
                            : item.approvedBefore
                              ? "Historical (earlier version)"
                              : "—"}
                        </td>
                        <td>
                          {item.pins.length === 0
                            ? "—"
                            : `${fresh}/${item.pins.length}`}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              props.onOpenArtifact(item.artifact.id, item.artifact.kind)
                            }
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {slice !== null && slice.pages > 1 && (
                <div className="button-row" role="navigation" aria-label="Table pages">
                  <button
                    type="button"
                    className="secondary small"
                    disabled={slice.page === 0}
                    onClick={() => setPage(slice.page - 1)}
                  >
                    Previous
                  </button>
                  <span className="hint" aria-live="polite">
                    Page {slice.page + 1} of {slice.pages} · {report.affected.length}{" "}
                    artifacts
                  </span>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={slice.page >= slice.pages - 1}
                    onClick={() => setPage(slice.page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
