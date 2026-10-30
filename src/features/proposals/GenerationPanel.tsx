// Assisted-generation panel: describe the module, propose requirements with
// Meta and accept proposals as persisted drafts. AI never approves:
// accepting creates an unapproved requirement, which follows the human flow.
//
// Drafts (description and edits) in local state: a failure keeps everything.
// Generations are Rust snapshots. Mounted with a per-module `key`, so a
// late response never touches another module.
import { useEffect, useRef, useState } from "react";
import { normalizeCoreError, type RequirementDetail } from "../requirements/types";
import {
  acceptProposal,
  discardProposal,
  generationContext,
  listGenerations,
  proposeRequirements,
} from "./client";
import {
  editFromProposal,
  isActionable,
  splitItems,
  upsertGeneration,
  type ProposalEdit,
} from "./coordination";
import type { GenerationContextPreview, GenerationDto, ProposalDto } from "./types";

interface GenerationPanelProps {
  projectId: string;
  moduleId: string;
  /** Archived module: history stays readable, no generating or accepting. */
  moduleArchived: boolean;
  onAccepted: (detail: RequirementDetail) => void;
  onOpenRequirement: (artifactId: string) => void;
  /**
   * Suggested description (e.g. from the assistant composer): only adopted
   * while the field stays pristine; never overwrites typing nor generates.
   */
  suggestedDescription?: string | null;
}

function editKey(generationId: string, tempId: string): string {
  return `${generationId}/${tempId}`;
}

export function GenerationPanel({
  projectId,
  moduleId,
  moduleArchived,
  onAccepted,
  onOpenRequirement,
  suggestedDescription = null,
}: GenerationPanelProps) {
  const [description, setDescription] = useState(suggestedDescription ?? "");
  const touchedRef = useRef(false);
  useEffect(() => {
    if (!touchedRef.current && suggestedDescription !== null) {
      setDescription(suggestedDescription);
    }
  }, [suggestedDescription]);
  const [preview, setPreview] = useState<GenerationContextPreview[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generations, setGenerations] = useState<GenerationDto[]>([]);
  const [edits, setEdits] = useState<Record<string, ProposalEdit>>({});
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      try {
        const [ctx, gens] = await Promise.all([
          generationContext(projectId, moduleId),
          listGenerations(projectId, moduleId),
        ]);
        if (cancelledRef.current) return;
        setPreview(ctx);
        setGenerations(gens);
      } catch (raw) {
        if (cancelledRef.current) return;
        setPreviewError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, moduleId]);

  function editFor(generationId: string, proposal: ProposalDto): ProposalEdit {
    return edits[editKey(generationId, proposal.tempId)] ?? editFromProposal(proposal);
  }

  function setEdit(generationId: string, tempId: string, patch: Partial<ProposalEdit>) {
    const key = editKey(generationId, tempId);
    setEdits((prev) => {
      const base =
        prev[key] ??
        editFromProposal(
          generations
            .find((g) => g.id === generationId)
            ?.proposals.find((p) => p.tempId === tempId) ?? {
            tempId,
            title: "",
            description: "",
            acceptance: [],
            assumptions: [],
            state: "pending",
            artifactId: null,
          },
        );
      return { ...prev, [key]: { ...base, ...patch } };
    });
  }

  async function handlePropose() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const created = await proposeRequirements({ projectId, moduleId, description });
      if (cancelledRef.current) return;
      setGenerations((prev) => upsertGeneration(prev, created));
    } catch (raw) {
      if (cancelledRef.current) return;
      // The description and earlier results stay intact.
      setGenerateError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setGenerating(false);
    }
  }

  async function refreshGenerations() {
    const gens = await listGenerations(projectId, moduleId);
    if (!cancelledRef.current) setGenerations(gens);
  }

  async function handleAccept(generation: GenerationDto, proposal: ProposalDto) {
    const key = editKey(generation.id, proposal.tempId);
    const edit = editFor(generation.id, proposal);
    setActing(key);
    setActionError(null);
    try {
      const detail = await acceptProposal({
        generationId: generation.id,
        tempId: proposal.tempId,
        title: edit.title,
        description: edit.description,
        acceptance: splitItems(edit.acceptance),
        assumptions: splitItems(edit.assumptions),
      });
      if (cancelledRef.current) return;
      onAccepted(detail);
      await refreshGenerations();
    } catch (raw) {
      if (cancelledRef.current) return;
      setActionError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setActing(null);
    }
  }

  async function handleDiscard(generation: GenerationDto, proposal: ProposalDto) {
    const key = editKey(generation.id, proposal.tempId);
    setActing(key);
    setActionError(null);
    try {
      await discardProposal({ generationId: generation.id, tempId: proposal.tempId });
      if (cancelledRef.current) return;
      await refreshGenerations();
    } catch (raw) {
      if (cancelledRef.current) return;
      setActionError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setActing(null);
    }
  }

  return (
    <section className="editor generation" aria-label="Assisted generation">
      <div className="editor-head">
        <h3>Propose requirements with AI</h3>
      </div>
      {moduleArchived && (
        <p className="notice" role="note">
          Archived module: you can read the saved generations, but not generate
          or accept proposals until restored.
        </p>
      )}

      <label className="field">
        <span>Describe the module</span>
        <textarea
          value={description}
          onChange={(e) => {
            touchedRef.current = true;
            setDescription(e.target.value);
          }}
          rows={4}
          disabled={generating || moduleArchived}
          placeholder="e.g. Product sales with stock control."
        />
      </label>

      <div className="context-preview">
        <h4>Context that will be sent</h4>
        {previewError !== null ? (
          <p className="error" role="alert">
            {previewError}
          </p>
        ) : preview === null ? (
          <p className="hint">Loading context…</p>
        ) : preview.length === 0 ? (
          <p className="hint">The module has no requirements yet: only the description travels.</p>
        ) : (
          <ul className="pick-list">
            {preview.map((item) => (
              <li key={item.artifactId}>
                {item.title !== null && item.title !== "" ? (
                  <>
                    {item.title} <code>{item.artifactId}</code>
                  </>
                ) : (
                  <code>{item.artifactId}</code>
                )}{" "}
                <code>{item.versionId}</code> · {item.chars} characters
                <br />
                <span className="hint">{item.excerpt}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="notice">
          The content goes to Meta: the description and this module's current
          requirements. No files, secrets or other projects travel. The key
          lives in Rust only and nothing is called without pressing the button.
        </p>
      </div>

      <div className="button-row">
        <button
          type="button"
          className="primary"
          onClick={() => void handlePropose()}
          disabled={generating || acting !== null || description.trim() === "" || moduleArchived}
          title={moduleArchived ? "Archived module: restore it to generate" : undefined}
        >
          {generating ? "Proposing…" : "Propose requirements"}
        </button>
      </div>
      {generateError && (
        <p className="error" role="alert">
          {generateError}
        </p>
      )}
      {actionError && (
        <p className="error" role="alert">
          {actionError}
        </p>
      )}

      {generations.length > 0 && (
        <div className="generations">
          <h4>Saved generations</h4>
          {generations.map((generation) => (
            <article key={generation.id} className="generation-card">
              <header>
                <code>{generation.id}</code> · {generation.model} · template v
                {generation.templateVersion}
                {generation.usage.totalTokens !== null &&
                  generation.usage.totalTokens !== undefined && (
                    <span>
                      {" "}
                      · {generation.usage.inputTokens ?? "?"} +{" "}
                      {generation.usage.outputTokens ?? "?"} = {generation.usage.totalTokens}{" "}
                      tokens
                    </span>
                  )}
              </header>
              {generation.stale ? (
                <p className="notice stale" role="note">
                  Stale: a requirement used as context changed. Its proposals
                  are bound to the original context and cannot be accepted.
                  Generate again with the current context.
                </p>
              ) : (
                <p className="hint">
                  Context: {generation.contextVersionIds.join(", ") || "no requirements"}.
                </p>
              )}
              {generation.questions.length > 0 && (
                <section className="questions" aria-label="Open questions">
                  <h5>Open questions</h5>
                  <ul>
                    {generation.questions.map((question, i) => (
                      <li key={i}>{question}</li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="proposals">
                {generation.proposals.map((proposal) => {
                  const key = editKey(generation.id, proposal.tempId);
                  const edit = editFor(generation.id, proposal);
                  const actionable = isActionable(
                    proposal,
                    generation.stale,
                    acting !== null,
                    moduleArchived,
                  );
                  const busyThis = acting === key;
                  return (
                    <article key={proposal.tempId} className="proposal-card">
                      <header>
                        <code>{proposal.tempId}</code>{" "}
                        <span className="proposal-state">{proposal.state}</span>
                        {proposal.state === "accepted" && proposal.artifactId && (
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              proposal.artifactId && onOpenRequirement(proposal.artifactId)
                            }
                          >
                            Open {proposal.artifactId}
                          </button>
                        )}
                      </header>
                      {proposal.state === "pending" ? (
                        <>
                          <label className="field">
                            <span>Title</span>
                            <input
                              type="text"
                              value={edit.title}
                              onChange={(e) =>
                                setEdit(generation.id, proposal.tempId, { title: e.target.value })
                              }
                              disabled={!actionable && !busyThis}
                            />
                          </label>
                          <label className="field">
                            <span>Description</span>
                            <textarea
                              value={edit.description}
                              onChange={(e) =>
                                setEdit(generation.id, proposal.tempId, {
                                  description: e.target.value,
                                })
                              }
                              rows={3}
                              disabled={!actionable && !busyThis}
                            />
                          </label>
                          <label className="field">
                            <span>Acceptance criteria (one per line)</span>
                            <textarea
                              value={edit.acceptance}
                              onChange={(e) =>
                                setEdit(generation.id, proposal.tempId, {
                                  acceptance: e.target.value,
                                })
                              }
                              rows={3}
                              disabled={!actionable && !busyThis}
                            />
                          </label>
                          <label className="field">
                            <span>Assumptions (one per line, optional)</span>
                            <textarea
                              value={edit.assumptions}
                              onChange={(e) =>
                                setEdit(generation.id, proposal.tempId, {
                                  assumptions: e.target.value,
                                })
                              }
                              rows={2}
                              disabled={!actionable && !busyThis}
                            />
                          </label>
                          <div className="button-row">
                            <button
                              type="button"
                              className="primary small"
                              onClick={() => void handleAccept(generation, proposal)}
                              disabled={!actionable}
                              title={
                                generation.stale
                                  ? "Stale: generate again"
                                  : "Creates an unapproved draft"
                              }
                            >
                              {busyThis ? "Accepting…" : "Accept as draft"}
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => void handleDiscard(generation, proposal)}
                              disabled={!actionable}
                            >
                              Discard
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <p>
                            <strong>{proposal.title}</strong>
                          </p>
                          <p>{proposal.description}</p>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
