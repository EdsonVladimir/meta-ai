// Meta Assistant: contextual panel reusing the existing AI flows (propose
// requirements, generate flow/ER, propose updates) without redoing
// services, proposals or persistence.
//
// No silent classifier: the action is picked explicitly and free text only
// feeds Propose requirements. Each action shows which saved versions it
// will use and warns about drafts outside the context. Used areas stay
// mounted (hidden) so an ongoing generation is never lost and proposals
// are never reassigned when the selection changes.
import { useEffect, useRef, useState } from "react";
import { DesignPanel } from "../design/DesignPanel";
import { listDesigns } from "../design/client";
import { UpdateProposal } from "../impact/UpdateProposal";
import type { ImpactReportDto } from "../impact/types";
import { GenerationPanel } from "../proposals/GenerationPanel";
import { listGenerations } from "../proposals/client";
import {
  normalizeCoreError,
  type ArtifactDto,
  type RequirementDetail,
} from "../requirements/types";
import { assistantActionLabel, mergeAssistantHistory, resolveSend } from "./coordination";
import {
  ASSISTANT_ACTIONS,
  type AssistantAction,
  type AssistantHistoryEntry,
} from "./types";

export interface AssistantContext {
  requirementId: string | null;
  designId: string | null;
  mockupId: string | null;
  requirementDetail: RequirementDetail | null;
  designDetail: RequirementDetail | null;
  mockupDetail: RequirementDetail | null;
}

interface AssistantPanelProps {
  projectId: string;
  moduleId: string;
  moduleName: string;
  moduleArchived: boolean;
  artifacts: ArtifactDto[];
  context: AssistantContext;
  draftsDirty: { requirement: boolean; design: boolean; mockup: boolean };
  impactReport: ImpactReportDto | null;
  onAcceptedRequirement: (detail: RequirementDetail) => void;
  onAcceptedDesign: (detail: RequirementDetail) => void;
  onOpenRequirement: (artifactId: string) => void;
  onOpenDesign: (artifactId: string) => void;
  onOpenImpactArtifact: (artifactId: string, kind: string) => void;
  onOpenImpact: () => void;
}

function currentNumber(detail: RequirementDetail | null): number | null {
  if (detail === null) return null;
  const found = detail.versions.find((v) => v.id === detail.currentVersionId);
  return found?.number ?? null;
}

function contextLines(context: AssistantContext): string[] {
  const lines: string[] = [];
  const req = currentNumber(context.requirementDetail);
  if (context.requirementId !== null) {
    lines.push(`requirement ${context.requirementId}${req !== null ? ` (v${req})` : ""}`);
  }
  const des = currentNumber(context.designDetail);
  if (context.designId !== null) {
    lines.push(`design ${context.designId}${des !== null ? ` (v${des})` : ""}`);
  }
  const mock = currentNumber(context.mockupDetail);
  if (context.mockupId !== null) {
    lines.push(`mockup ${context.mockupId}${mock !== null ? ` (v${mock})` : ""}`);
  }
  return lines;
}

export function AssistantPanel(props: AssistantPanelProps) {
  const { projectId, moduleId } = props;
  const [action, setAction] = useState<AssistantAction | null>(null);
  const [used, setUsed] = useState<AssistantAction[]>([]);
  const [message, setMessage] = useState("");
  const [fedDescription, setFedDescription] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [history, setHistory] = useState<AssistantHistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [updateTargetId, setUpdateTargetId] = useState<string | null>(null);
  const [updateEdits, setUpdateEdits] = useState<Record<string, string>>({});
  const cancelledRef = useRef(false);

  function markUsed(next: AssistantAction) {
    setAction(next);
    setUsed((prev) => (prev.includes(next) ? prev : [...prev, next]));
    setNotice(null);
  }

  // Module history: read-only, bounded. No calls when opening the panel
  // or typing: loads on expand or when pressing Refresh.
  useEffect(() => {
    cancelledRef.current = false;
    setHistory(null);
    setHistoryError(null);
    return () => {
      cancelledRef.current = true;
    };
  }, [projectId, moduleId]);

  async function loadHistory() {
    setHistoryError(null);
    try {
      const [requirements, designs] = await Promise.all([
        listGenerations(projectId, moduleId),
        listDesigns(projectId, moduleId),
      ]);
      if (cancelledRef.current) return;
      setHistory(mergeAssistantHistory(requirements, designs));
    } catch (raw) {
      if (!cancelledRef.current) setHistoryError(normalizeCoreError(raw).message);
    }
  }

  function handleSend() {
    const resolved = resolveSend(action, message);
    if (!resolved.ok) {
      setNotice(
        resolved.reason === "no_action"
          ? "Pick an action first: text alone runs nothing."
          : "Write what you want to propose before sending.",
      );
      return;
    }
    markUsed(resolved.action);
    if (resolved.feedComposer) {
      setFedDescription(message.trim());
      setNotice("The description moved to the Propose requirements field: review it and generate whenever you want.");
    } else {
      setNotice(
        `"${assistantActionLabel(resolved.action)}" uses its marked sources below, not this text. Nothing has run yet.`,
      );
    }
    setMessage("");
  }

  const drafts = [
    props.draftsDirty.requirement && "requirement",
    props.draftsDirty.design && "design",
    props.draftsDirty.mockup && "mockup",
  ].filter((label): label is string => label !== false);
  const context = contextLines(props.context);
  const updateCandidates = (props.impactReport?.affected ?? []).filter(
    (item) =>
      (item.artifact.kind === "flow" || item.artifact.kind === "data_model") &&
      item.requiresReview,
  );
  const updateTarget =
    updateCandidates.find((item) => item.artifact.id === updateTargetId) ?? null;

  return (
    <section className="assistant" aria-label="Meta Assistant">
      <div className="assistant-head">
        <h3>Meta Assistant</h3>
        <p className="hint">
          Module {props.moduleName}
          {context.length > 0 ? ` · ${context.join(" · ")}` : " · no artifact in context"}
        </p>
        {drafts.length > 0 && (
          <p className="notice" role="note">
            Unsaved drafts ({drafts.join(", ")}): the context uses saved versions.
          </p>
        )}
      </div>

      <div className="assistant-actions" role="group" aria-label="Action">
        {ASSISTANT_ACTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={action === item.id ? "primary small" : "secondary small"}
            aria-pressed={action === item.id}
            onClick={() => markUsed(item.id)}
            title={item.hint}
          >
            {item.label}
          </button>
        ))}
      </div>
      {notice !== null && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}

      <div className="assistant-body">
        {action === null && (
          <p className="hint">
            Pick an action: each shows its saved sources and its proposals with diff,
            accept and discard. Nothing goes to Meta until you press generate inside
            the action.
          </p>
        )}
        {used.includes("requirements") && (
          <div hidden={action !== "requirements"}>
            <GenerationPanel
              key={`${projectId}/${moduleId}`}
              projectId={projectId}
              moduleId={moduleId}
              moduleArchived={props.moduleArchived}
              onAccepted={props.onAcceptedRequirement}
              onOpenRequirement={props.onOpenRequirement}
              suggestedDescription={fedDescription}
            />
          </div>
        )}
        {used.includes("design") && (
          <div hidden={action !== "design"}>
            <DesignPanel
              key={`${projectId}/${moduleId}`}
              projectId={projectId}
              moduleId={moduleId}
              artifacts={props.artifacts}
              preselectedRequirementIds={null}
              onAccepted={props.onAcceptedDesign}
              onOpenDesign={props.onOpenDesign}
            />
          </div>
        )}
        {used.includes("update") && (
          <div hidden={action !== "update"}>
            {props.impactReport === null ? (
              <div>
                <p className="hint">
                  No live impact report: open Impact, pick the origin requirement and come back;
                  affected designs will show here.
                </p>
                <button type="button" className="secondary small" onClick={props.onOpenImpact}>
                  Open Impact
                </button>
              </div>
            ) : updateTarget === null ? (
              <div>
                <p className="hint">
                  Affected designs needing review (origin{" "}
                  {props.impactReport.origin.artifact.id}):
                </p>
                {updateCandidates.length === 0 ? (
                  <p className="hint">None pending in this report.</p>
                ) : (
                  <ul className="pick-list">
                    {updateCandidates.map((item) => (
                      <li key={item.artifact.id}>
                        <button
                          type="button"
                          className="secondary small"
                          onClick={() => setUpdateTargetId(item.artifact.id)}
                        >
                          {item.artifact.title ?? item.artifact.id} (v{item.currentNumber})
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <UpdateProposal
                projectId={projectId}
                moduleId={moduleId}
                target={updateTarget}
                originArtifactId={props.impactReport.origin.artifact.id}
                originFromVersionId={props.impactReport.origin.fromVersion.id}
                edits={updateEdits}
                onEdit={(generationId, text) =>
                  setUpdateEdits((prev) => {
                    if (text === null) {
                      const next = { ...prev };
                      delete next[generationId];
                      return next;
                    }
                    return { ...prev, [generationId]: text };
                  })
                }
                onAccepted={props.onAcceptedDesign}
                onOpenArtifact={props.onOpenImpactArtifact}
                onSelectNode={() => {}}
                onClose={() => setUpdateTargetId(null)}
              />
            )}
          </div>
        )}
      </div>

      <details
        className="assistant-history"
        onToggle={(event) => {
          if ((event.target as HTMLDetailsElement).open && history === null) {
            void loadHistory();
          }
        }}
      >
        <summary>
          Module history{history !== null ? ` (${history.length})` : ""}
        </summary>
        <button
          type="button"
          className="secondary small"
          onClick={() => void loadHistory()}
          title="Reload the module history"
        >
          Refresh
        </button>
        {historyError !== null ? (
          <p className="error" role="alert">
            {historyError}
          </p>
        ) : history === null ? (
          <p className="hint">Loading history…</p>
        ) : history.length === 0 ? (
          <p className="hint">No requests in this module yet.</p>
        ) : (
          <ul className="assistant-history-list">
            {history.map((entry) => (
              <li key={entry.id}>
                <code>{entry.id}</code>{" "}
                {entry.kind === "requirements"
                  ? "requirements"
                  : entry.kind === "design"
                    ? "design"
                    : "update"}{" "}
                · {entry.title} · {entry.model} · {entry.tokens}
                {entry.stale && <span className="pill"> stale</span>}
                {entry.openCount > 0 && (
                  <span className="hint">
                    {" "}
                    · {entry.openCount} open
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          handleSend();
        }}
      >
        <label className="sr-only" htmlFor="assistant-message">
          Describe a change
        </label>
        <input
          id="assistant-message"
          type="text"
          value={message}
          placeholder="Describe a change…"
          maxLength={2000}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" className="primary small">
          Send
        </button>
      </form>
    </section>
  );
}
