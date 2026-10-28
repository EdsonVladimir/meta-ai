// Asistente Meta: panel contextual que reutiliza los flujos IA existentes
// (proponer requisitos, generar flujo/ER, proponer actualización) sin
// rehacer servicios, propuestas ni persistencia.
//
// Sin clasificador silencioso: la acción se elige de forma explícita y el
// texto libre solo alimenta Proponer requisitos. Cada acción muestra qué
// versiones guardadas usará y avisa si hay borradores fuera del contexto.
// Las áreas usadas se mantienen montadas (ocultas) para no perder una
// generación en curso ni reasignar propuestas al cambiar de selección.
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
    lines.push(`requisito ${context.requirementId}${req !== null ? ` (v${req})` : ""}`);
  }
  const des = currentNumber(context.designDetail);
  if (context.designId !== null) {
    lines.push(`diseño ${context.designId}${des !== null ? ` (v${des})` : ""}`);
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

  // Historial del módulo: solo lectura, acotado. Sin llamadas al abrir
  // el panel ni al escribir: carga al desplegarlo o al pulsar Actualizar.
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
          ? "Elige una acción primero: el texto solo no ejecuta nada."
          : "Escribe qué quieres proponer antes de enviar.",
      );
      return;
    }
    markUsed(resolved.action);
    if (resolved.feedComposer) {
      setFedDescription(message.trim());
      setNotice("La descripción pasó al campo de Proponer requisitos: revísala y genera cuando quieras.");
    } else {
      setNotice(
        `«${assistantActionLabel(resolved.action)}» usa sus fuentes marcadas abajo, no este texto. Nada se ha ejecutado todavía.`,
      );
    }
    setMessage("");
  }

  const drafts = [
    props.draftsDirty.requirement && "requisito",
    props.draftsDirty.design && "diseño",
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
    <section className="assistant" aria-label="Asistente Meta">
      <div className="assistant-head">
        <h3>Asistente Meta</h3>
        <p className="hint">
          Módulo {props.moduleName}
          {context.length > 0 ? ` · ${context.join(" · ")}` : " · sin artefacto en contexto"}
        </p>
        {drafts.length > 0 && (
          <p className="notice" role="note">
            Borradores sin guardar ({drafts.join(", ")}): el contexto usa versiones guardadas.
          </p>
        )}
      </div>

      <div className="assistant-actions" role="group" aria-label="Acción">
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
            Elige una acción: cada una muestra sus fuentes guardadas y sus propuestas con dif,
            incorporar y descartar. Nada se envía a Meta hasta que pulses generar dentro de la
            acción.
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
                  Sin informe de impacto vigente: abre Impacto, elige el requisito origen y vuelve;
                  aquí aparecerán los diseños afectados.
                </p>
                <button type="button" className="secondary small" onClick={props.onOpenImpact}>
                  Abrir Impacto
                </button>
              </div>
            ) : updateTarget === null ? (
              <div>
                <p className="hint">
                  Diseños afectados que requieren revisión (origen{" "}
                  {props.impactReport.origin.artifact.id}):
                </p>
                {updateCandidates.length === 0 ? (
                  <p className="hint">Ninguno pendiente en este informe.</p>
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
          Historial del módulo{history !== null ? ` (${history.length})` : ""}
        </summary>
        <button
          type="button"
          className="secondary small"
          onClick={() => void loadHistory()}
          title="Recargar el historial del módulo"
        >
          Actualizar
        </button>
        {historyError !== null ? (
          <p className="error" role="alert">
            {historyError}
          </p>
        ) : history === null ? (
          <p className="hint">Cargando historial…</p>
        ) : history.length === 0 ? (
          <p className="hint">Aún no hay solicitudes en este módulo.</p>
        ) : (
          <ul className="assistant-history-list">
            {history.map((entry) => (
              <li key={entry.id}>
                <code>{entry.id}</code>{" "}
                {entry.kind === "requirements"
                  ? "requisitos"
                  : entry.kind === "design"
                    ? "diseño"
                    : "actualización"}{" "}
                · {entry.title} · {entry.model} · {entry.tokens}
                {entry.stale && <span className="pill"> desactualizada</span>}
                {entry.openCount > 0 && (
                  <span className="hint">
                    {" "}
                    · {entry.openCount} pendiente{entry.openCount === 1 ? "" : "s"}
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
          Describe un cambio
        </label>
        <input
          id="assistant-message"
          type="text"
          value={message}
          placeholder="Describe un cambio…"
          maxLength={2000}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button type="submit" className="primary small">
          Enviar
        </button>
      </form>
    </section>
  );
}
