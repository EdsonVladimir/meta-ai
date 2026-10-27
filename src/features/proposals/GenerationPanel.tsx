// Panel de generación asistida: describe el módulo, propone requisitos con
// Meta y acepta propuestas como borradores persistidos. La IA nunca aprueba:
// aceptar crea un requisito sin aprobación, que sigue el flujo humano.
//
// Borradores (descripción y ediciones) en estado local: un fallo conserva
// todo. Las generaciones son instantáneas de Rust. Se monta con `key` por
// módulo, así que una respuesta tardía jamás toca otro módulo.
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
  onAccepted: (detail: RequirementDetail) => void;
  onOpenRequirement: (artifactId: string) => void;
}

function editKey(generationId: string, tempId: string): string {
  return `${generationId}/${tempId}`;
}

export function GenerationPanel({
  projectId,
  moduleId,
  onAccepted,
  onOpenRequirement,
}: GenerationPanelProps) {
  const [description, setDescription] = useState("");
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
      // La descripción y los resultados anteriores se conservan intactos.
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
    <section className="editor generation" aria-label="Generación asistida">
      <div className="editor-head">
        <h3>Proponer requisitos con IA</h3>
      </div>

      <label className="field">
        <span>Describe el módulo</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          disabled={generating}
          placeholder="p. ej. Ventas de productos con control de stock."
        />
      </label>

      <div className="context-preview">
        <h4>Contexto que se enviará</h4>
        {previewError !== null ? (
          <p className="error" role="alert">
            {previewError}
          </p>
        ) : preview === null ? (
          <p className="hint">Cargando contexto…</p>
        ) : preview.length === 0 ? (
          <p className="hint">El módulo aún no tiene requisitos: solo viajará la descripción.</p>
        ) : (
          <ul className="pick-list">
            {preview.map((item) => (
              <li key={item.artifactId}>
                <code>{item.artifactId}</code> <code>{item.versionId}</code> · {item.chars}{" "}
                caracteres
                <br />
                <span className="hint">{item.excerpt}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="notice">
          El contenido se enviará a Meta: la descripción y los requisitos
          actuales de este módulo. No se envían archivos, secretos ni otros
          proyectos. La clave vive solo en Rust y no se llama sin pulsar el
          botón.
        </p>
      </div>

      <div className="button-row">
        <button
          type="button"
          className="primary"
          onClick={() => void handlePropose()}
          disabled={generating || acting !== null || description.trim() === ""}
        >
          {generating ? "Proponiendo…" : "Proponer requisitos"}
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
          <h4>Generaciones guardadas</h4>
          {generations.map((generation) => (
            <article key={generation.id} className="generation-card">
              <header>
                <code>{generation.id}</code> · {generation.model} · plantilla v
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
                  Desactualizada: cambió un requisito usado como contexto. Sus
                  propuestas están vinculadas al contexto original y no pueden
                  aceptarse. Genera de nuevo con el contexto actual.
                </p>
              ) : (
                <p className="hint">
                  Contexto: {generation.contextVersionIds.join(", ") || "sin requisitos"}.
                </p>
              )}
              {generation.questions.length > 0 && (
                <section className="questions" aria-label="Preguntas pendientes">
                  <h5>Preguntas pendientes</h5>
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
                  const actionable = isActionable(proposal, generation.stale, acting !== null);
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
                            Abrir {proposal.artifactId}
                          </button>
                        )}
                      </header>
                      {proposal.state === "pending" ? (
                        <>
                          <label className="field">
                            <span>Título</span>
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
                            <span>Descripción</span>
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
                            <span>Criterios de aceptación (uno por línea)</span>
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
                            <span>Supuestos (uno por línea, opcional)</span>
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
                                  ? "Desactualizada: genera de nuevo"
                                  : "Crea un borrador sin aprobar"
                              }
                            >
                              {busyThis ? "Aceptando…" : "Aceptar como borrador"}
                            </button>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => void handleDiscard(generation, proposal)}
                              disabled={!actionable}
                            >
                              Descartar
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
