// Impact inspector (right): why the selection is affected, which sources
// it has and real navigation to the artifact. No chat or fake repair
// buttons: reading and navigation only.
import { useEffect, useRef, useState } from "react";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type RequirementDetail,
} from "../requirements/types";
import { kindName, StatusBadge } from "./ImpactTab";
import type { ImpactReportDto, ImpactedDto } from "./types";
import { UpdateProposal } from "./UpdateProposal";

interface Props {
  report: ImpactReportDto;
  projectId: string;
  moduleId: string;
  selectedId: string | null;
  edits: Record<string, string>;
  onEdit: (generationId: string, text: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onOpenArtifact: (artifactId: string, kind: string) => void;
  onShowDiff: () => void;
  onAccepted: (detail: RequirementDetail) => void;
}

export function ImpactInspector(props: Props) {
  const { report, selectedId, onSelectNode, onOpenArtifact, onShowDiff } = props;
  const origin = report.origin;
  const isOrigin = selectedId === origin.artifact.id;
  const selected: ImpactedDto | null =
    selectedId === null || isOrigin
      ? null
      : (report.affected.find((a) => a.artifact.id === selectedId) ?? null);

  // Design in update mode (edits live above and survive).
  const [updating, setUpdating] = useState<string | null>(null);
  const updateTarget =
    updating !== null && selected?.artifact.id === updating ? selected : null;

  const [showSources, setShowSources] = useState(true);
  const [diff, setDiff] = useState<RequirementDetail | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const wanted = useRef<string | null>(null);

  // Switching nodes folds what was loaded: each diff belongs to its node.
  useEffect(() => {
    wanted.current = selectedId;
    setDiff(null);
    setDiffError(null);
    setDiffBusy(false);
    setDiffOpen(false);
    setShowSources(true);
  }, [selectedId]);

  async function loadDiff(artifactId: string) {
    wanted.current = artifactId;
    setDiffOpen(true);
    setDiffBusy(true);
    setDiffError(null);
    try {
      const detail = await getRequirement(artifactId);
      if (wanted.current !== artifactId) return;
      setDiff(detail);
    } catch (raw) {
      if (wanted.current !== artifactId) return;
      setDiffError(normalizeCoreError(raw).message);
    } finally {
      if (wanted.current === artifactId) setDiffBusy(false);
    }
  }

  if (selectedId === null) {
    return (
      <aside className="review" aria-label="Impact inspector">
        <h3>Impact</h3>
        <p className="hint">
          Select a map node or a table row to see why it is affected, which
          sources it has and how to navigate to its design.
        </p>
        <dl className="facts">
          <div>
            <dt>Origin</dt>
            <dd>
              {origin.artifact.title !== null && origin.artifact.title !== ""
                ? `${origin.artifact.title} (${origin.artifact.id})`
                : origin.artifact.id}
            </dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>
              v{origin.fromVersion.number} → v{origin.currentVersion.number}
            </dd>
          </div>
          <div>
            <dt>Related</dt>
            <dd>{report.affected.length}</dd>
          </div>
        </dl>
        <p className="hint">
          Related is not an error: it means the change reaches the artifact through
          its registered dependencies.
        </p>
      </aside>
    );
  }

  if (isOrigin) {
    return (
      <aside className="review" aria-label="Impact inspector">
        <h3>
          {origin.artifact.title !== null && origin.artifact.title !== "" ? (
            <>
              {origin.artifact.title} <code>{origin.artifact.id}</code>
            </>
          ) : (
            origin.artifact.id
          )}
        </h3>
        <p>
          <span className="badge">◉ Change origin</span>
        </p>
        <p className="hint">
          {kindName(origin.artifact.kind)} · v{origin.fromVersion.number} → v
          {origin.currentVersion.number}
        </p>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={onShowDiff}>
            View differences
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => onOpenArtifact(origin.artifact.id, origin.artifact.kind)}
          >
            Open requirement
          </button>
          <button type="button" className="secondary small" onClick={() => onSelectNode(null)}>
            Drop selection
          </button>
        </div>
      </aside>
    );
  }

  if (selected === null) {
    return (
      <aside className="review" aria-label="Impact inspector">
        <h3>Impact</h3>
        <p className="error" role="alert">
          The selection ({selectedId}) is no longer in the report: the report changed. Select
          a node again.
        </p>
        <button type="button" className="secondary small" onClick={() => onSelectNode(null)}>
          Clear selection
        </button>
      </aside>
    );
  }

  const openLabel =
    selected.artifact.kind === "requirement"
      ? "Open requirement"
      : selected.artifact.kind === "mockup"
        ? "Open mockup"
        : "Open design";
  const versions = diff?.versions ?? [];
  const prev = versions.length >= 2 ? versions[versions.length - 2] : null;
  const curr = versions.length >= 1 ? versions[versions.length - 1] : null;
  const canProposeUpdate =
    (selected.artifact.kind === "flow" || selected.artifact.kind === "data_model") &&
    selected.requiresReview;

  if (updateTarget !== null) {
    return (
      <aside className="review" aria-label="Impact inspector">
        <UpdateProposal
          projectId={props.projectId}
          moduleId={props.moduleId}
          target={updateTarget}
          originArtifactId={origin.artifact.id}
          originFromVersionId={origin.fromVersion.id}
          edits={props.edits}
          onEdit={props.onEdit}
          onAccepted={props.onAccepted}
          onOpenArtifact={onOpenArtifact}
          onSelectNode={onSelectNode}
          onClose={() => setUpdating(null)}
        />
      </aside>
    );
  }

  return (
    <aside className="review" aria-label="Inspector de impacto">
      <h3>
        {selected.artifact.title !== null && selected.artifact.title !== "" ? (
          <>
            {selected.artifact.title} <code>{selected.artifact.id}</code>
          </>
        ) : (
          selected.artifact.id
        )}
      </h3>
      <p>
        <StatusBadge item={selected} />{" "}
        <span className="hint">{kindName(selected.artifact.kind)}</span>
      </p>
      {selected.approvedBefore && (
        <p className="hint">
          {selected.approvals.length > 0
            ? `Approved: ${selected.approvals.map((a) => `${a.versionId} by ${a.approvedBy}`).join(", ")}.`
            : "Historically approved in an earlier version."}{" "}
          {selected.requiresReview &&
            "The historical approval is kept, but the current version uses old sources."}
        </p>
      )}

      <h4>Why it is affected</h4>
      {selected.paths.length === 0 ? (
        <p className="hint">No recorded paths.</p>
      ) : (
        <ol className="path-list">
          {selected.paths.map((path, i) => (
            <li key={i}>
              {path.map((node, j) => (
                <span key={`${node}-${j}`}>
                  {j > 0 && <span aria-hidden="true"> → </span>}
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => onSelectNode(node)}
                    title="Select on the map"
                  >
                    {node}
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}

      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          onClick={() => void loadDiff(selected.artifact.id)}
          disabled={diffBusy}
        >
          {diffBusy ? "Loading…" : "View differences"}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => setShowSources((v) => !v)}
          aria-pressed={showSources}
        >
          {showSources ? "Hide sources" : "View sources"}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => onOpenArtifact(selected.artifact.id, selected.artifact.kind)}
        >
          {openLabel}
        </button>
        {canProposeUpdate && (
          <button
            type="button"
            className="primary small"
            onClick={() => setUpdating(selected.artifact.id)}
            title="Ask Meta for a design tweak, to review and accept as a draft"
          >
            Propose update
          </button>
        )}
      </div>

      {showSources && (
        <section aria-label="Used versus current sources">
          <h4>
            Sources ({selected.pins.filter((p) => !p.stale).length}/{selected.pins.length} current)
          </h4>
          {selected.pins.length === 0 ? (
            <p className="hint">The current version declares no sources.</p>
          ) : (
            <ul className="pin-list">
              {selected.pins.map((pin) => (
                <li key={pin.usedVersionId} className={pin.stale ? "stale" : ""}>
                  <span className="mono">{pin.usedVersionId}</span>
                  {pin.currentVersionId !== null &&
                  pin.currentVersionId !== pin.usedVersionId ? (
                    <span className="hint">
                      {" "}
                      → current: <span className="mono">{pin.currentVersionId}</span>
                    </span>
                  ) : (
                    <span className="hint"> · is current</span>
                  )}
                  {pin.stale && <span className="badge warn">stale</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {diffOpen && (
        <section aria-label="Artifact differences">
          <h4>
            Differences · {selected.artifact.id}
          </h4>
          {diffBusy && diff === null && <p className="hint">Loading history…</p>}
          {diffError !== null && (
            <p className="error" role="alert">
              {diffError}
            </p>
          )}
          {diff !== null && curr !== null && (
            <>
              <h5>
                Before · {prev === null ? "—" : `v${prev.number} (${prev.id})`}
              </h5>
              <pre className="readonly-box">
                {prev === null ? "No earlier version: it is the first." : prev.content}
              </pre>
              <h5>
                Now · v{curr.number} ({curr.id})
              </h5>
              <pre className="readonly-box">{curr.content}</pre>
              <p className="hint">
                Resolving the pending item requires saving a reviewed version with the
                right sources from its view; this report modifies nothing.
              </p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
