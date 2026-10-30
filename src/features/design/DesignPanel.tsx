// Module design panel: select saved requirements, generate a flow or ER
// proposal with Meta, review it (diagram, source, explanation,
// questions), edit its JSON with validation and accept it as a draft
// (new artifact or new version). Accepting does not approve; review is
// optional and shows as information (living design). Drafts (selection,
// JSON, target) in local state: a failure keeps everything. Generations
// are Rust snapshots. Mounted with a per-module `key`, so a late
// response never touches another module.
import { useEffect, useRef, useState } from "react";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type ArtifactDto,
  type RequirementDetail,
} from "../requirements/types";
import {
  acceptDesign,
  discardDesign,
  generateDesign,
  listDesigns,
  validateDesign,
} from "./client";
import { generateDesignFromMockups, mockupContext } from "../mockup/client";
import {
  designTargets,
  isDesignActionable,
  isUpdateGeneration,
  parseSpecText,
  prettySpec,
  upsertDesignGeneration,
} from "./coordination";
import { MermaidDiagram } from "./MermaidDiagram";
import {
  DESIGN_KIND_LABELS,
  type DesignContextPreview,
  type DesignGenerationDto,
  type DesignKind,
  type ValidatedDesignDto,
} from "./types";

export type { DesignKind };

interface DesignPanelProps {
  projectId: string;
  moduleId: string;
  artifacts: ArtifactDto[];
  /**
   * Requirements preselected as sources (e.g. the requirement in context).
   * It only preselects: it never generates automatically.
   */
  preselectedRequirementIds?: string[] | null;
  /**
   * Mockups preselected as sources (e.g. the mockup in context).
   * `null`/`undefined` = none preselected (picked by hand).
   */
  preselectedMockupIds?: string[] | null;
  onAccepted: (detail: RequirementDetail) => void;
  onOpenDesign: (artifactId: string) => void;
}

export function DesignPanel({
  projectId,
  moduleId,
  preselectedMockupIds = null,
  artifacts,
  preselectedRequirementIds = null,
  onAccepted,
  onOpenDesign,
}: DesignPanelProps) {
  const [context, setContext] = useState<DesignContextPreview[] | null>(null);
  const [mockups, setMockups] = useState<DesignContextPreview[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectedMockups, setSelectedMockups] = useState<Record<string, boolean>>({});
  const [generations, setGenerations] = useState<DesignGenerationDto[]>([]);
  const [jsonEdits, setJsonEdits] = useState<Record<string, string>>({});
  const [validated, setValidated] = useState<Record<string, ValidatedDesignDto>>({});
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<DesignKind | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [validateError, setValidateError] = useState<Record<string, string>>({});
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      try {
        const [preview, gens] = await Promise.all([
          mockupContext(projectId, moduleId),
          listDesigns(projectId, moduleId),
        ]);
        if (cancelledRef.current) return;
        setContext(preview.requirements);
        setMockups(preview.mockups);
        // Preselection: the given requirements (or every saved one) and
        // the given mockups (or none: added by hand). The person adjusts.
        // No review veto (living design).
        const initial: Record<string, boolean> = {};
        for (const item of preview.requirements) {
          initial[item.artifactId] =
            preselectedRequirementIds === null
              ? true
              : preselectedRequirementIds.includes(item.artifactId);
        }
        setSelected(initial);
        const initialMockups: Record<string, boolean> = {};
        for (const item of preview.mockups) {
          initialMockups[item.artifactId] =
            preselectedMockupIds !== null &&
            preselectedMockupIds !== undefined &&
            preselectedMockupIds.includes(item.artifactId);
        }
        setSelectedMockups(initialMockups);
        setGenerations(gens);
      } catch (raw) {
        if (cancelledRef.current) return;
        setContextError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, moduleId, preselectedRequirementIds]);

  function jsonFor(generation: DesignGenerationDto): string {
    return jsonEdits[generation.id] ?? prettySpec(generation.proposal.spec);
  }

  function mermaidFor(generation: DesignGenerationDto): string {
    return validated[generation.id]?.mermaid ?? generation.proposal.mermaid;
  }

  function selectedIds(): string[] {
    return (context ?? [])
      .filter((item) => selected[item.artifactId])
      .map((item) => item.artifactId);
  }

  function selectedMockupIds(): string[] {
    return (mockups ?? [])
      .filter((item) => selectedMockups[item.artifactId])
      .map((item) => item.artifactId);
  }

  async function handleGenerate(kind: DesignKind) {
    setGenerating(kind);
    setGenerateError(null);
    try {
      const mockupIds = selectedMockupIds();
      const created =
        mockupIds.length > 0
          ? await generateDesignFromMockups({
              projectId,
              moduleId,
              kind,
              requirementIds: selectedIds(),
              mockupIds,
            })
          : await generateDesign({
              projectId,
              moduleId,
              kind,
              requirementIds: selectedIds(),
            });
      if (cancelledRef.current) return;
      setGenerations((prev) => upsertDesignGeneration(prev, created));
    } catch (raw) {
      if (cancelledRef.current) return;
      setGenerateError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setGenerating(null);
    }
  }

  async function refreshGenerations() {
    const gens = await listDesigns(projectId, moduleId);
    if (!cancelledRef.current) setGenerations(gens);
  }

  async function handleValidate(generation: DesignGenerationDto) {
    const parsed = parseSpecText(jsonFor(generation));
    if (!parsed.ok) {
      setValidateError((prev) => ({ ...prev, [generation.id]: parsed.error }));
      return;
    }
    setActing(`validate:${generation.id}`);
    setValidateError((prev) => {
      const next = { ...prev };
      delete next[generation.id];
      return next;
    });
    try {
      const result = await validateDesign({
        kind: generation.kind,
        spec: parsed.value,
        generationId: generation.id,
      });
      if (cancelledRef.current) return;
      // Only the valid result replaces the previous one.
      setValidated((prev) => ({ ...prev, [generation.id]: result }));
    } catch (raw) {
      if (cancelledRef.current) return;
      setValidateError((prev) => ({
        ...prev,
        [generation.id]: normalizeCoreError(raw).message,
      }));
    } finally {
      if (!cancelledRef.current) setActing(null);
    }
  }

  async function handleAccept(generation: DesignGenerationDto) {
    const parsed = parseSpecText(jsonFor(generation));
    if (!parsed.ok) {
      setActionError(parsed.error);
      return;
    }
    setActing(generation.id);
    setActionError(null);
    try {
      // Updates accept onto the snapshot target and version (fixed);
      // creations read the expected one fresh.
      const updating = isUpdateGeneration(generation);
      const target = updating
        ? (generation.targetArtifactId ?? "")
        : (targets[generation.id] ?? "");
      let expectedVersionId: string | null = null;
      if (target !== "") {
        if (updating) {
          expectedVersionId = generation.targetVersionId ?? null;
        } else {
          const current = await getRequirement(target);
          expectedVersionId = current.currentVersionId;
        }
      }
      const detail = await acceptDesign({
        generationId: generation.id,
        spec: parsed.value,
        targetArtifactId: target === "" ? null : target,
        expectedVersionId,
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

  async function handleDiscard(generation: DesignGenerationDto) {
    setActing(generation.id);
    setActionError(null);
    try {
      await discardDesign(generation.id);
      if (cancelledRef.current) return;
      await refreshGenerations();
    } catch (raw) {
      if (cancelledRef.current) return;
      setActionError(normalizeCoreError(raw).message);
    } finally {
      if (!cancelledRef.current) setActing(null);
    }
  }

  const chosenCount = selectedIds().length;
  const chosenMockups = selectedMockupIds();
  const totalChosen = chosenCount + chosenMockups.length;
  const busy = generating !== null || acting !== null;

  return (
    <section className="editor design" aria-label="Requirement-linked design">
      <div className="editor-head">
        <h3>Module design</h3>
      </div>

      <div className="context-preview">
        <h4>Sources: saved requirements</h4>
        {contextError !== null ? (
          <p className="error" role="alert">
            {contextError}
          </p>
        ) : context === null ? (
          <p className="hint">Loading requirements…</p>
        ) : context.length === 0 ? (
          <p className="hint">The module has no requirements yet.</p>
        ) : (
          <ul className="pick-list">
            {context.map((item) => (
              <li key={item.artifactId}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected[item.artifactId] ?? false}
                    disabled={busy}
                    onChange={(e) =>
                      setSelected((prev) => ({ ...prev, [item.artifactId]: e.target.checked }))
                    }
                  />
                  <span>
                    {item.title !== null && item.title !== "" ? (
                      <>
                        {item.title} <code>{item.artifactId}</code>
                      </>
                    ) : (
                      <code>{item.artifactId}</code>
                    )}{" "}
                    <code>{item.versionId}</code>{" "}
                    {item.approved ? (
                      ""
                    ) : (
                      <span
                        className="pill"
                        title="It will generate from its saved version; review is optional"
                      >
                        unreviewed{" "}
                      </span>
                    )}
                    <span className="hint">{item.excerpt}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <h4>Sources: saved mockups (optional)</h4>
        {mockups === null ? (
          <p className="hint">Loading mockups…</p>
        ) : mockups.length === 0 ? (
          <p className="hint">The module has no mockups yet: draw them in the Mockups view.</p>
        ) : (
          <ul className="pick-list">
            {mockups.map((item) => (
              <li key={item.artifactId}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selectedMockups[item.artifactId] ?? false}
                    disabled={busy}
                    onChange={(e) =>
                      setSelectedMockups((prev) => ({ ...prev, [item.artifactId]: e.target.checked }))
                    }
                  />
                  <span>
                    {item.title !== null && item.title !== "" ? (
                      <>
                        {item.title} <code>{item.artifactId}</code>
                      </>
                    ) : (
                      <code>{item.artifactId}</code>
                    )}{" "}
                    <code>{item.versionId}</code>{" "}
                    {!item.approved && (
                      <span
                        className="pill"
                        title="It will generate from its saved version; review is optional"
                      >
                        unreviewed{" "}
                      </span>
                    )}
                    <span className="hint">{item.excerpt}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="notice">
          Only the selected saved sources travel to Meta ({chosenCount}{" "}
          {chosenCount === 1 ? "requirement" : "requirements"}
          {chosenMockups.length > 0 &&
            ` and ${chosenMockups.length} ${chosenMockups.length === 1 ? "mockup" : "mockups"}`}
          ). Mockups travel as a readable summary, without positions. No files,
          secrets or other projects are sent. The key lives only in Rust and
          no call happens without pressing a generate button.
        </p>
      </div>

      <div className="button-row">
        {(["flow", "data_model"] as DesignKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="primary"
            onClick={() => void handleGenerate(kind)}
            disabled={busy || totalChosen === 0}
            title={totalChosen === 0 ? "Select at least one saved source" : undefined}
          >
            {generating === kind ? "Generating…" : `Generate ${DESIGN_KIND_LABELS[kind]}`}
          </button>
        ))}
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
          {generations.map((generation) => {
            const actionable = isDesignActionable(
              generation.proposal,
              generation.stale,
              acting !== null,
            );
            const busyThis = acting === generation.id;
            const options = designTargets(artifacts, generation.kind);
            // Does the context include mockups? The kind derives from the
            // (version `{artifact}-vN`): no inventing, display only.
            const kindsByArtifact = new Map(artifacts.map((a) => [a.id, a.kind]));
            const mockupsInContext = generation.contextVersionIds.filter(
              (versionId) =>
                kindsByArtifact.get(versionId.replace(/-v\d+$/, "")) === "mockup",
            ).length;
            return (
              <article key={generation.id} className="generation-card">
                <header>
                  <code>{generation.id}</code> · {DESIGN_KIND_LABELS[generation.kind]} ·{" "}
                  {generation.model} · template v{generation.templateVersion}
                  {mockupsInContext > 0 && (
                    <span>
                      {" "}· from {mockupsInContext}{" "}
                      {mockupsInContext === 1 ? "mockup" : "mockups"}
                    </span>
                  )}
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
                    Stale: a source used as context changed. The proposal
                    stays bound to its original context and cannot be
                    accepted. Generate again with the current context.
                  </p>
                ) : (
                  <p className="hint">
                    Context: {generation.contextVersionIds.join(", ") || "no sources"}.
                  </p>
                )}
                <h5>{generation.proposal.title}</h5>
                {isUpdateGeneration(generation) && (
                  <p className="hint">
                    Update proposal for <code>{generation.targetArtifactId}</code>{" "}
                    (on <code>{generation.targetVersionId}</code>): the target is fixed
                    and cannot be changed here.
                  </p>
                )}
                <MermaidDiagram
                  source={mermaidFor(generation)}
                  diagramId={`gen-${generation.id}`}
                />
                <details>
                  <summary>Mermaid source (read-only)</summary>
                  <pre className="readonly-box">{mermaidFor(generation)}</pre>
                </details>
                <p>{generation.proposal.explanation}</p>
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
                <p className="hint">
                  Valid syntax does not guarantee design correctness: review
                  it as an expert before accepting.
                </p>
                {generation.proposal.state === "pending" ? (
                  <>
                    <label className="field">
                      <span>JSON spec (authoritative)</span>
                      <textarea
                        className="json-editor"
                        value={jsonFor(generation)}
                        onChange={(e) =>
                          setJsonEdits((prev) => ({ ...prev, [generation.id]: e.target.value }))
                        }
                        rows={10}
                        disabled={!actionable && !busyThis}
                        spellCheck={false}
                      />
                    </label>
                    {validateError[generation.id] && (
                      <p className="error" role="alert">
                        {validateError[generation.id]} The last valid result is kept.
                      </p>
                    )}
                    {isUpdateGeneration(generation) ? (
                      <p className="hint">
                        Accepting creates a version of <code>{generation.targetArtifactId}</code>{" "}
                        with the snapshot sources. Approval remains a later step.
                      </p>
                    ) : (
                      <label className="field">
                        <span>Accept as</span>
                        <select
                          value={targets[generation.id] ?? ""}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, [generation.id]: e.target.value }))
                          }
                          disabled={!actionable}
                        >
                          <option value="">New artifact</option>
                          {options.map((a) => (
                            <option key={a.id} value={a.id}>
                              New version of {a.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => void handleValidate(generation)}
                        disabled={!actionable}
                      >
                        Validate and preview
                      </button>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => void handleAccept(generation)}
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
                        onClick={() => void handleDiscard(generation)}
                        disabled={!actionable}
                      >
                        Discard
                      </button>
                    </div>
                  </>
                ) : (
                  <p>
                    <span className="proposal-state">{generation.proposal.state}</span>{" "}
                    {generation.proposal.state === "accepted" &&
                      generation.proposal.artifactId && (
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() =>
                            generation.proposal.artifactId &&
                            onOpenDesign(generation.proposal.artifactId)
                          }
                        >
                          Open {generation.proposal.artifactId}
                        </button>
                      )}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
