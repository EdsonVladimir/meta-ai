// Design-update proposal for a pending design, inside the impact
// inspector: snapshot preview, explicit generation, comparison (diagrams +
// structural diff) and acceptance as a new version of the SAME artifact.
// Reuses the design-generation cycle; only the review flow lives here.
// JSON edits are lifted via props so navigation keeps them; the rest is
// ephemeral and rederivable.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptDesign,
  designDiff,
  discardDesign,
  listDesigns,
  proposeDesignUpdate,
  updateContext,
  validateDesign,
} from "../design/client";
import {
  isDesignActionable,
  parseSpecText,
  prettySpec,
  resumableUpdate,
  updateGenerationsFor,
  upsertDesignGeneration,
} from "../design/coordination";
import { MermaidDiagram } from "../design/MermaidDiagram";
import {
  type DesignDiffDto,
  type DesignGenerationDto,
  type UpdateContextPreview,
  type ValidatedDesignDto,
} from "../design/types";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type RequirementDetail,
} from "../requirements/types";
import { kindName } from "./ImpactTab";
import type { ImpactedDto } from "./types";

function diffKindLabel(kind: string): string {
  switch (kind) {
    case "title":
      return "Title";
    case "node":
      return "Node";
    case "edge":
      return "Edge";
    case "entity":
      return "Entity";
    case "attribute":
      return "Attribute";
    case "relation":
      return "Relation";
    default:
      return kind;
  }
}

interface Props {
  projectId: string;
  moduleId: string;
  target: ImpactedDto;
  originArtifactId: string;
  originFromVersionId: string;
  edits: Record<string, string>;
  onEdit: (generationId: string, text: string | null) => void;
  onAccepted: (detail: RequirementDetail) => void;
  onOpenArtifact: (artifactId: string, kind: string) => void;
  onSelectNode: (id: string | null) => void;
  onClose: () => void;
}

export function UpdateProposal(props: Props) {
  const { target } = props;
  const targetId = target.artifact.id;
  const wanted = useRef("");

  const [preview, setPreview] = useState<UpdateContextPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DesignGenerationDto[]>([]);
  const [generation, setGeneration] = useState<DesignGenerationDto | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [validated, setValidated] = useState<ValidatedDesignDto | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [diff, setDiff] = useState<DesignDiffDto | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [currentMermaid, setCurrentMermaid] = useState<string | null>(null);
  const [side, setSide] = useState<"current" | "proposed">("proposed");
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveDetail, setLiveDetail] = useState<RequirementDetail | null>(null);

  const key = `${props.moduleId}/${targetId}`;

  // Advisory snapshot + saved proposals. A resumable one opens directly;
  // otherwise the preview shows for generation.
  useEffect(() => {
    wanted.current = key;
    setPreview(null);
    setPreviewError(null);
    setGeneration(null);
    setValidated(null);
    setValidateError(null);
    setDiff(null);
    setDiffError(null);
    setCurrentMermaid(null);
    setLiveDetail(null);
    setPreviewBusy(true);
    void (async () => {
      try {
        const [ctx, gens] = await Promise.all([
          updateContext({
            projectId: props.projectId,
            artifactId: targetId,
            originArtifactId: props.originArtifactId,
            originFromVersionId: props.originFromVersionId,
          }),
          listDesigns(props.projectId, props.moduleId),
        ]);
        if (wanted.current !== key) return;
        setPreview(ctx);
        setSaved(gens);
        setGeneration(resumableUpdate(gens, targetId));
      } catch (raw) {
        if (wanted.current !== key) return;
        setPreviewError(normalizeCoreError(raw).message);
      } finally {
        if (wanted.current === key) setPreviewBusy(false);
      }
    })();
  }, [key, props.projectId, props.moduleId, targetId, props.originArtifactId, props.originFromVersionId]);

  // Live current-design diagram for comparison.
  useEffect(() => {
    if (preview === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await validateDesign({
          kind: preview.kind,
          spec: preview.currentSpec,
          generationId: null,
        });
        if (!cancelled && wanted.current === key) setCurrentMermaid(result.mermaid);
      } catch {
        if (!cancelled && wanted.current === key) setCurrentMermaid(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, key]);

  // Live target detail: snapshot previous sources and version.
  useEffect(() => {
    if (generation === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await getRequirement(targetId);
        if (!cancelled && wanted.current === key && detail.artifact.id === targetId) {
          setLiveDetail(detail);
        }
      } catch {
        if (!cancelled && wanted.current === key) setLiveDetail(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, targetId, key]);

  const editedSpec = useMemo((): unknown | null => {
    if (generation === null) return null;
    const text = props.edits[generation.id];
    if (text === undefined) return generation.proposal.spec;
    const parsed = parseSpecText(text);
    return parsed.ok ? parsed.value : null;
  }, [generation, props.edits]);

  // Structural diff of current vs proposal (or its validated edit).
  useEffect(() => {
    if (preview === null || generation === null || editedSpec === null) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await designDiff({
          kind: generation.kind,
          oldSpec: preview.currentSpec,
          newSpec: editedSpec,
        });
        if (!cancelled && wanted.current === key) {
          setDiff(result);
          setDiffError(null);
        }
      } catch (raw) {
        if (!cancelled && wanted.current === key) {
          setDiff(null);
          setDiffError(normalizeCoreError(raw).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [preview, generation, editedSpec, key]);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const created = await proposeDesignUpdate({
        projectId: props.projectId,
        artifactId: targetId,
        originArtifactId: props.originArtifactId,
        originFromVersionId: props.originFromVersionId,
      });
      if (wanted.current !== key) return;
      setSaved((prev) => upsertDesignGeneration(prev, created));
      setGeneration(created);
      setValidated(null);
      setValidateError(null);
    } catch (raw) {
      if (wanted.current !== key) return;
      setGenerateError(normalizeCoreError(raw).message);
    } finally {
      if (wanted.current === key) setGenerating(false);
    }
  }

  async function refreshSaved(): Promise<DesignGenerationDto[]> {
    const gens = await listDesigns(props.projectId, props.moduleId);
    if (wanted.current !== key) return saved;
    setSaved(gens);
    setGeneration((current) => {
      if (current === null) return resumableUpdate(gens, targetId);
      return gens.find((g) => g.id === current.id) ?? current;
    });
    return gens;
  }

  async function handleValidate() {
    if (generation === null) return;
    const text = props.edits[generation.id] ?? prettySpec(generation.proposal.spec);
    const parsed = parseSpecText(text);
    if (!parsed.ok) {
      setValidateError(`${parsed.error} The last valid result is kept.`);
      return;
    }
    setActing(true);
    setValidateError(null);
    try {
      const result = await validateDesign({
        kind: generation.kind,
        spec: parsed.value,
        generationId: generation.id,
      });
      if (wanted.current !== key) return;
      setValidated(result);
    } catch (raw) {
      if (wanted.current !== key) return;
      setValidateError(`${normalizeCoreError(raw).message} The last valid result is kept.`);
    } finally {
      if (wanted.current === key) setActing(false);
    }
  }

  async function handleAccept() {
    if (generation === null || generation.targetArtifactId == null) return;
    const text = props.edits[generation.id] ?? prettySpec(generation.proposal.spec);
    const parsed = parseSpecText(text);
    if (!parsed.ok) {
      setActionError(parsed.error);
      return;
    }
    setActing(true);
    setActionError(null);
    try {
      const detail = await acceptDesign({
        generationId: generation.id,
        spec: parsed.value,
        targetArtifactId: generation.targetArtifactId,
        expectedVersionId: generation.targetVersionId,
      });
      if (wanted.current !== key) return;
      props.onEdit(generation.id, null);
      props.onAccepted(detail);
      await refreshSaved();
    } catch (raw) {
      if (wanted.current !== key) return;
      setActionError(normalizeCoreError(raw).message);
      void refreshSaved();
    } finally {
      if (wanted.current === key) setActing(false);
    }
  }

  async function handleDiscard() {
    if (generation === null) return;
    setActing(true);
    setActionError(null);
    try {
      await discardDesign(generation.id);
      if (wanted.current !== key) return;
      props.onEdit(generation.id, null);
      setValidated(null);
      const gens = await refreshSaved();
      setGeneration(resumableUpdate(gens, targetId));
    } catch (raw) {
      if (wanted.current !== key) return;
      setActionError(normalizeCoreError(raw).message);
    } finally {
      if (wanted.current === key) setActing(false);
    }
  }

  const others = updateGenerationsFor(saved, targetId).filter((g) => g.id !== generation?.id);
  const proposedMermaid = generation === null ? null : (validated?.mermaid ?? generation.proposal.mermaid);
  const actionable =
    generation !== null && isDesignActionable(generation.proposal, generation.stale, acting || generating);
  const snapshotSources = useMemo(() => {
    if (liveDetail === null || generation?.targetVersionId == null) return null;
    return liveDetail.versions.find((v) => v.id === generation.targetVersionId)?.sources ?? null;
  }, [liveDetail, generation]);

  return (
    <section className="update-proposal" aria-label={`Update proposal for ${targetId}`}>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={props.onClose}>
          ← Back to inspector
        </button>
      </div>

      {previewBusy && preview === null && <p className="hint">Loading snapshot…</p>}
      {previewError !== null && (
        <p className="error" role="alert">
          {previewError}
        </p>
      )}

      {preview !== null && generation === null && (
        <>
          <h4>
            Update {targetId} <span className="hint">({kindName(preview.kind)})</span>
          </h4>
          <p className="hint">
            Current version <code>{preview.currentVersionId}</code>. The proposal keeps the
            same source set with their current versions; nothing is added or removed alone.
          </p>
          <h5>Used vs current sources</h5>
          {preview.sources.length === 0 ? (
            <p className="hint">The current design declares no sources.</p>
          ) : (
            <ul className="pin-list">
              {preview.sources.map((source) => (
                <li key={source.artifactId} className={source.changed ? "stale" : ""}>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => props.onSelectNode(source.artifactId)}
                    title="Select in the map"
                  >
                    {source.artifactId}
                  </button>{" "}
                  <span className="mono">{source.usedVersionId}</span>
                  {source.changed && (
                    <span className="hint">
                      {" "}
                      → <span className="mono">{source.currentVersionId}</span>
                    </span>
                  )}
                  {!source.currentApproved && (
                    <span
                      className="badge warn"
                      title="Informational: does not block generation"
                    >
                      unreviewed
                    </span>
                  )}
                  {!source.currentValid && <span className="badge warn">outdated</span>}
                </li>
              ))}
            </ul>
          )}
          {preview.origin !== null && preview.origin !== undefined && (
            <>
              <h5>
                Origin change · {preview.origin.artifactId} ({preview.origin.fromVersionId} →{" "}
                {preview.origin.currentVersionId})
              </h5>
              <div className="before-after single-col">
                <section aria-label="Before">
                  <h6>Before</h6>
                  <pre className="readonly-box">{preview.origin.fromContent}</pre>
                </section>
                <section aria-label="Now">
                  <h6>Now</h6>
                  <pre className="readonly-box">{preview.origin.currentContent}</pre>
                </section>
              </div>
            </>
          )}
          {preview.paths.length > 0 && (
            <>
              <h5>Relevant paths</h5>
              <ol className="path-list">
                {preview.paths.map((path, i) => (
                  <li key={i}>{path.join(" → ")}</li>
                ))}
              </ol>
            </>
          )}
          {preview.blockers.length > 0 && (
            <div role="alert">
              {preview.blockers.map((blocker, i) => (
                <p key={i} className="error">
                  {blocker.message}{" "}
                  {blocker.artifactId !== null && blocker.artifactId !== undefined && (
                    <button
                      type="button"
                      className="linklike"
                      onClick={() => props.onSelectNode(blocker.artifactId ?? null)}
                    >
                      See {blocker.artifactId} on the map
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
          <p className="notice">
            Meta receives the current design, the sources with both versions and the origin change.
            No files, secrets or other modules are sent. No automatic retries.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary small"
              onClick={() => void handleGenerate()}
              disabled={!preview.canGenerate || generating}
            >
              {generating ? "Generating…" : "Generate proposal"}
            </button>
          </div>
          {generateError !== null && (
            <p className="error" role="alert">
              {generateError}
            </p>
          )}
          {others.length > 0 && (
            <p className="hint">
              {others.length} saved proposal{others.length === 1 ? "" : "s"} for this design (
              {others.map((g) => g.id).join(", ")}); generate again for a fresh one.
            </p>
          )}
        </>
      )}

      {generation !== null && (
        <>
          <h4>
            Proposal <code>{generation.id}</code>
          </h4>
          <p className="hint">
            {generation.model} · template v{generation.templateVersion}
            {generation.usage.totalTokens !== null && generation.usage.totalTokens !== undefined && (
              <span>
                {" "}
                · {generation.usage.inputTokens ?? "?"} + {generation.usage.outputTokens ?? "?"} ={" "}
                {generation.usage.totalTokens} tokens
              </span>
            )}
          </p>
          {generation.stale && generation.proposal.state === "pending" && (
            <p className="notice stale" role="note">
              Stale: the design or a source changed during generation or review. The
              proposal is kept but cannot be accepted.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generate again
              </button>
            </p>
          )}
          {generation.proposal.state === "accepted" && (
            <p className="notice" role="note">
              Accepted as a draft of <code>{generation.proposal.artifactId}</code>. Approval
              remains a later step from its view.{" "}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  const id = generation.proposal.artifactId;
                  if (id !== null && id !== undefined) props.onOpenArtifact(id, generation.kind);
                }}
              >
                Open design
              </button>
            </p>
          )}
          {generation.proposal.state === "discarded" && (
            <p className="notice" role="note">
              Discarded: cannot be accepted.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generate again
              </button>
            </p>
          )}
          {generation.proposal.state === "pending" && !generation.stale && (
            <p className="hint">
              Proposal resumed from an earlier generation.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generate another proposal
              </button>
            </p>
          )}

          <div className="center-tabs" role="tablist" aria-label="Comparison">
            <button
              type="button"
              role="tab"
              aria-selected={side === "current"}
              className={side === "current" ? "active" : ""}
              onClick={() => setSide("current")}
            >
              Current
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={side === "proposed"}
              className={side === "proposed" ? "active" : ""}
              onClick={() => setSide("proposed")}
            >
              Proposal
            </button>
          </div>
          {side === "current" ? (
            currentMermaid === null ? (
              <p className="hint">The current design has no valid diagram.</p>
            ) : (
              <MermaidDiagram source={currentMermaid} diagramId={`upd-current-${generation.id}`} />
            )
          ) : proposedMermaid === null ? (
            <p className="hint">No proposed diagram.</p>
          ) : (
            <MermaidDiagram source={proposedMermaid} diagramId={`upd-proposed-${generation.id}`} />
          )}

          <h5>Structural differences</h5>
          {diffError !== null && (
            <p className="error" role="alert">
              {diffError}
            </p>
          )}
          {diff !== null && (
            <div className="structural-diff">
              {(
                [
                  ["added", "Added", diff.added],
                  ["removed", "Removed", diff.removed],
                  ["modified", "Modified", diff.modified],
                ] as const
              ).map(([key, label, items]) => (
                <section key={key} aria-label={label}>
                  <h6>
                    {label} ({items.length})
                  </h6>
                  {items.length === 0 ? (
                    <p className="hint">—</p>
                  ) : (
                    <ul className="diff-list">
                      {items.map((item) => (
                        <li key={`${item.kind}:${item.id}`}>
                          <span className="badge">{diffKindLabel(item.kind)}</span>{" "}
                          <span className="mono">{item.id}</span>
                          {item.detail !== "" && <span className="hint"> · {item.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          )}

          <h5>Previous and new sources</h5>
          <p className="hint">
            Previous:{" "}
            {snapshotSources === null ? (
              "loading…"
            ) : snapshotSources.length === 0 ? (
              "none"
            ) : (
              <span className="mono">{snapshotSources.join(", ")}</span>
            )}
            <br />
            New: <span className="mono">{generation.contextVersionIds.join(", ") || "none"}</span>
          </p>

          <h5>{generation.proposal.title}</h5>
          <p>{generation.proposal.explanation}</p>
          {generation.questions.length > 0 && (
            <section className="questions" aria-label="Open questions">
              <h6>Open questions</h6>
              <ul>
                {generation.questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="hint">
            The explanation is a proposal, not evidence of correctness: the structural diff
            and your review are what count.
          </p>

          {generation.proposal.state === "pending" && (
            <>
              <label className="field">
                <span>JSON spec (authoritative)</span>
                <textarea
                  className="json-editor"
                  value={props.edits[generation.id] ?? prettySpec(generation.proposal.spec)}
                  onChange={(e) => props.onEdit(generation.id, e.target.value)}
                  rows={10}
                  disabled={!actionable}
                  spellCheck={false}
                />
              </label>
              {validateError !== null && (
                <p className="error" role="alert">
                  {validateError}
                </p>
              )}
              {actionError !== null && (
                <p className="error" role="alert">
                  {actionError}
                </p>
              )}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => void handleValidate()}
                  disabled={!actionable}
                >
                  Validate and preview
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    props.onEdit(generation.id, null);
                    setValidated(null);
                    setValidateError(null);
                  }}
                  disabled={!actionable}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="primary small"
                  onClick={() => void handleAccept()}
                  disabled={!actionable}
                  title="Creates a version of the same artifact, unapproved"
                >
                  {acting ? "Accepting…" : "Accept as draft"}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => void handleDiscard()}
                  disabled={!actionable}
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
