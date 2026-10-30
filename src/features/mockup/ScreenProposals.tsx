// Screen proposals with Meta: pick saved requirements (or the whole
// module), show the context that will travel, generate up to three
// screens and incorporate them individually as new mockups. AI never
// approves or replaces screens: incorporating creates a new artifact
// with AI provenance, which follows the human flow. Drafts in local
// state; generations, Rust snapshots. Mounted with a per-module `key`:
// a late response never touches another one.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { DesignContextPreview } from "../design/types";
import { normalizeCoreError, type RequirementDetail } from "../requirements/types";
import { useRequirementsUi } from "../requirements/uiStore";
import {
  acceptMockupScreen,
  discardMockupScreen,
  listMockupGenerations,
  mockupContext,
  proposeMockups,
} from "./client";
import { autoMockupLayout, parseMockupSpec } from "./mockupModel";
import { buildScreenNodes } from "./screenNodes";
import type { MockupGeneration, MockupScreenProposal } from "./types";

const MockupCanvas = lazy(() =>
  import("./MockupCanvas").then((module) => ({ default: module.MockupCanvas })),
);

interface ScreenProposalsProps {
  projectId: string;
  moduleId: string;
  /** Archived module: browsable history, no generating or accepting. */
  moduleArchived: boolean;
  onAccepted: (detail: RequirementDetail) => void;
  onOpenMockup: (mockupId: string) => void;
}

function actionKey(generationId: string, tempId: string): string {
  return `${generationId}/${tempId}`;
}

function upsertGeneration(
  generations: MockupGeneration[],
  incoming: MockupGeneration,
): MockupGeneration[] {
  const index = generations.findIndex((g) => g.id === incoming.id);
  if (index === -1) return [...generations, incoming];
  return generations.map((g, i) => (i === index ? incoming : g));
}

export function ScreenProposals({
  projectId,
  moduleId,
  moduleArchived,
  onAccepted,
  onOpenMockup,
}: ScreenProposalsProps) {
  const [context, setContext] = useState<DesignContextPreview[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [generations, setGenerations] = useState<MockupGeneration[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const docStatus = useRequirementsUi((s) => s.docStatus);
  const requestSaveAll = useRequirementsUi((s) => s.requestSaveAll);
  const dirtyDocs = useMemo(
    () => Object.entries(docStatus).filter(([, v]) => v.dirty).map(([k]) => k),
    [docStatus],
  );

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      try {
        const [ctx, gens] = await Promise.all([
          mockupContext(projectId, moduleId),
          listMockupGenerations(projectId, moduleId),
        ]);
        if (cancelledRef.current) return;
        setContext(ctx.requirements);
        setSelected((prev) => prev ?? ctx.requirements.map((r) => r.artifactId));
        setGenerations(gens);
      } catch (raw) {
        if (cancelledRef.current) return;
        setContextError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, moduleId]);

  function toggle(id: string): void {
    setSelected((prev) => {
      const base = prev ?? [];
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    });
  }

  async function handlePropose() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const created = await proposeMockups({
        projectId,
        moduleId,
        requirementIds: selected ?? [],
      });
      if (cancelledRef.current) return;
      setGenerations((prev) => upsertGeneration(prev, created));
    } catch (raw) {
      if (cancelledRef.current) return;
      setGenerateError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setGenerating(false);
    }
  }

  async function refreshGenerations() {
    const gens = await listMockupGenerations(projectId, moduleId);
    if (!cancelledRef.current) setGenerations(gens);
  }

  async function handleAccept(generation: MockupGeneration, proposal: MockupScreenProposal) {
    const key = actionKey(generation.id, proposal.tempId);
    setActing(key);
    setActionError(null);
    try {
      const detail = await acceptMockupScreen({
        generationId: generation.id,
        tempId: proposal.tempId,
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

  async function handleDiscard(generation: MockupGeneration, proposal: MockupScreenProposal) {
    const key = actionKey(generation.id, proposal.tempId);
    setActing(key);
    setActionError(null);
    try {
      await discardMockupScreen({ generationId: generation.id, tempId: proposal.tempId });
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
    <section className="editor generation" aria-label="Propose screens">
      <div className="editor-head">
        <h3>Propose screens with AI</h3>
      </div>
      {moduleArchived && (
        <p className="notice" role="note">
          Archived module: you can browse the saved generations, but not
          generate or incorporate screens until restoring it.
        </p>
      )}

      <div className="context-preview">
        <h4>Context to send</h4>
        {contextError !== null ? (
          <p className="error" role="alert">
            {contextError}
          </p>
        ) : context === null ? (
          <p className="hint">Loading context…</p>
        ) : context.length === 0 ? (
          <p className="hint">The module has no saved requirements yet: nothing to send.</p>
        ) : (
          <ul className="pick-list">
            {context.map((item) => (
              <li key={item.artifactId}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={(selected ?? []).includes(item.artifactId)}
                    disabled={generating || moduleArchived}
                    onChange={() => toggle(item.artifactId)}
                  />
                  {item.title !== null && item.title !== "" ? (
                    <>
                      {item.title} <code>{item.artifactId}</code>
                    </>
                  ) : (
                    <code>{item.artifactId}</code>
                  )}{" "}
                  <code>{item.versionId}</code>
                  {!item.approved && <span className="hint"> (review not required)</span>}
                </label>
                <br />
                <span className="hint">{item.excerpt}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          With nothing checked the whole module is used. Only saved
          versions travel, even unapproved ones: review is informational.
        </p>
        <p className="notice">
          The content will go to Meta: the checked requirements of this
          module. No files, secrets or other projects are sent. The key
          lives only in Rust and no call happens without pressing the button.
        </p>
      </div>

      {dirtyDocs.length > 0 && (
        <p className="notice" role="note">
          {dirtyDocs.length} {dirtyDocs.length === 1 ? "document" : "documents"} with
          unsaved changes ({dirtyDocs.join(", ")}): the context uses
          saved versions.{" "}
          <button type="button" className="secondary small" onClick={requestSaveAll}>
            Save drafts
          </button>
        </p>
      )}

      <div className="button-row">
        <button
          type="button"
          className="primary"
          onClick={() => void handlePropose()}
          disabled={
            generating || acting !== null || context === null || context.length === 0 || moduleArchived
          }
          title={moduleArchived ? "Archived module: restore it to generate" : undefined}
        >
          {generating ? "Proposing…" : "Propose screens"}
        </button>
        <span className="hint">At most 3 screens per request.</span>
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
                  Stale: a requirement used as context changed. Its screens
                  are bound to the original context and cannot be
                  incorporated. Generate again with the current context.
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
                  const key = actionKey(generation.id, proposal.tempId);
                  const actionable =
                    proposal.state === "pending" &&
                    !generation.stale &&
                    acting === null &&
                    !moduleArchived;
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
                              proposal.artifactId && onOpenMockup(proposal.artifactId)
                            }
                          >
                            Open {proposal.artifactId}
                          </button>
                        )}
                      </header>
                      <p>
                        <strong>{proposal.title}</strong>
                      </p>
                      <p className="hint">{proposal.explanation}</p>
                      <ScreenPreview spec={proposal.spec} title={proposal.title} />
                      {proposal.state === "pending" && (
                        <div className="button-row">
                          <button
                            type="button"
                            className="primary small"
                            onClick={() => void handleAccept(generation, proposal)}
                            disabled={!actionable}
                            title={
                              generation.stale
                                ? "Stale: generate again"
                                : "Creates a new mockup without touching existing ones"
                            }
                          >
                            {busyThis ? "Incorporating…" : "Incorporate screen"}
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

/** Read-only preview of the proposed screen (auto layout). */
function ScreenPreview({ spec, title }: { spec: unknown; title: string }) {
  const nodes = useMemo(() => {
    const parsed = parseMockupSpec(spec);
    const screen = parsed?.screens[0];
    if (!parsed || !screen) return null;
    const layout = autoMockupLayout(parsed, screen.id);
    const positions: Record<string, { x: number; y: number; w?: number; h?: number }> = {};
    for (const [id, entry] of Object.entries(layout)) positions[id] = entry;
    return buildScreenNodes(screen, positions, { readOnly: true });
  }, [spec]);
  if (nodes === null) {
    return (
      <p className="error" role="alert">
        The saved screen could not be read: it will not be incorporated.
      </p>
    );
  }
  return (
    <div className="mockup-preview" style={{ height: "320px" }}>
      <Suspense fallback={<p className="hint">Loading preview…</p>}>
        <MockupCanvas nodes={nodes} readOnly fitSignal={0} ariaLabel={`Preview of ${title}`} />
      </Suspense>
    </div>
  );
}
