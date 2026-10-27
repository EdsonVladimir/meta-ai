// Panel de diseño del módulo: seleccionar requisitos aprobados, generar
// una propuesta de flujo o ER con Meta, revisarla (diagrama, fuente,
// explicación, preguntas), editar su JSON con validación y aceptarla como
// borrador (artefacto nuevo o nueva versión). Aceptar no aprueba.
//
// Borradores (selección, JSON, objetivo) en estado local: un fallo conserva
// todo. Las generaciones son instantáneas de Rust. Se monta con `key` por
// módulo, así que una respuesta tardía jamás toca otro módulo.
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
  designContext,
  generateDesign,
  listDesigns,
  validateDesign,
} from "./client";
import {
  designTargets,
  isDesignActionable,
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
  onAccepted: (detail: RequirementDetail) => void;
  onOpenDesign: (artifactId: string) => void;
}

export function DesignPanel({
  projectId,
  moduleId,
  artifacts,
  onAccepted,
  onOpenDesign,
}: DesignPanelProps) {
  const [context, setContext] = useState<DesignContextPreview[] | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
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
        const [ctx, gens] = await Promise.all([
          designContext(projectId, moduleId),
          listDesigns(projectId, moduleId),
        ]);
        if (cancelledRef.current) return;
        setContext(ctx);
        // Preselección: todos los aprobados; la persona ajusta.
        const initial: Record<string, boolean> = {};
        for (const item of ctx) initial[item.artifactId] = item.approved;
        setSelected(initial);
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

  function jsonFor(generation: DesignGenerationDto): string {
    return jsonEdits[generation.id] ?? prettySpec(generation.proposal.spec);
  }

  function mermaidFor(generation: DesignGenerationDto): string {
    return validated[generation.id]?.mermaid ?? generation.proposal.mermaid;
  }

  function selectedIds(): string[] {
    return (context ?? [])
      .filter((item) => item.approved && selected[item.artifactId])
      .map((item) => item.artifactId);
  }

  async function handleGenerate(kind: DesignKind) {
    setGenerating(kind);
    setGenerateError(null);
    try {
      const created = await generateDesign({
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
      // Solo el resultado válido sustituye al anterior.
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
      // La versión esperada se lee en fresco: si cambió, Rust lo rechaza.
      const target = targets[generation.id] ?? "";
      let expectedVersionId: string | null = null;
      if (target !== "") {
        const current = await getRequirement(target);
        expectedVersionId = current.currentVersionId;
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

  const approvedCount = (context ?? []).filter((i) => i.approved).length;
  const chosenCount = selectedIds().length;
  const busy = generating !== null || acting !== null;

  return (
    <section className="editor design" aria-label="Diseño vinculado a requisitos">
      <div className="editor-head">
        <h3>Diseño del módulo</h3>
      </div>

      <div className="context-preview">
        <h4>Fuentes: requisitos aprobados</h4>
        {contextError !== null ? (
          <p className="error" role="alert">
            {contextError}
          </p>
        ) : context === null ? (
          <p className="hint">Cargando requisitos…</p>
        ) : context.length === 0 ? (
          <p className="hint">El módulo aún no tiene requisitos.</p>
        ) : (
          <ul className="pick-list">
            {context.map((item) => (
              <li key={item.artifactId}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected[item.artifactId] ?? false}
                    disabled={!item.approved || busy}
                    onChange={(e) =>
                      setSelected((prev) => ({ ...prev, [item.artifactId]: e.target.checked }))
                    }
                  />
                  <span>
                    <code>{item.artifactId}</code> <code>{item.versionId}</code>{" "}
                    {item.approved ? "" : "(sin aprobar: no genera) "}
                    <span className="hint">{item.excerpt}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="notice">
          Solo viajan a Meta los requisitos aprobados seleccionados (
          {chosenCount} de {approvedCount} aprobados). No se envían archivos,
          secretos ni otros proyectos. La clave vive solo en Rust y no se llama
          sin pulsar un botón de generación.
        </p>
      </div>

      <div className="button-row">
        {(["flow", "data_model"] as DesignKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="primary"
            onClick={() => void handleGenerate(kind)}
            disabled={busy || chosenCount === 0}
            title={chosenCount === 0 ? "Selecciona al menos una fuente aprobada" : undefined}
          >
            {generating === kind ? "Generando…" : `Generar ${DESIGN_KIND_LABELS[kind]}`}
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
          <h4>Generaciones guardadas</h4>
          {generations.map((generation) => {
            const actionable = isDesignActionable(
              generation.proposal,
              generation.stale,
              acting !== null,
            );
            const busyThis = acting === generation.id;
            const options = designTargets(artifacts, generation.kind);
            return (
              <article key={generation.id} className="generation-card">
                <header>
                  <code>{generation.id}</code> · {DESIGN_KIND_LABELS[generation.kind]} ·{" "}
                  {generation.model} · plantilla v{generation.templateVersion}
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
                    Desactualizada: cambió un requisito usado como contexto. La
                    propuesta sigue vinculada a su contexto original y no puede
                    aceptarse. Genera de nuevo con el contexto actual.
                  </p>
                ) : (
                  <p className="hint">
                    Contexto: {generation.contextVersionIds.join(", ") || "sin requisitos"}.
                  </p>
                )}
                <h5>{generation.proposal.title}</h5>
                <MermaidDiagram
                  source={mermaidFor(generation)}
                  diagramId={`gen-${generation.id}`}
                />
                <details>
                  <summary>Fuente Mermaid (solo lectura)</summary>
                  <pre className="readonly-box">{mermaidFor(generation)}</pre>
                </details>
                <p>{generation.proposal.explanation}</p>
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
                <p className="hint">
                  Sintaxis válida no garantiza corrección del diseño: revísalo
                  como experta antes de aceptarlo.
                </p>
                {generation.proposal.state === "pending" ? (
                  <>
                    <label className="field">
                      <span>Especificación JSON (autoritativa)</span>
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
                        {validateError[generation.id]} Se conserva el último resultado válido.
                      </p>
                    )}
                    <label className="field">
                      <span>Aceptar como</span>
                      <select
                        value={targets[generation.id] ?? ""}
                        onChange={(e) =>
                          setTargets((prev) => ({ ...prev, [generation.id]: e.target.value }))
                        }
                        disabled={!actionable}
                      >
                        <option value="">Artefacto nuevo</option>
                        {options.map((a) => (
                          <option key={a.id} value={a.id}>
                            Nueva versión de {a.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="button-row">
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => void handleValidate(generation)}
                        disabled={!actionable}
                      >
                        Validar y previsualizar
                      </button>
                      <button
                        type="button"
                        className="primary small"
                        onClick={() => void handleAccept(generation)}
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
                        onClick={() => void handleDiscard(generation)}
                        disabled={!actionable}
                      >
                        Descartar
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
                          Abrir {generation.proposal.artifactId}
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
