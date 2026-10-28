// Panel de diseño del módulo: seleccionar requisitos guardados, generar
// una propuesta de flujo o ER con Meta, revisarla (diagrama, fuente,
// explicación, preguntas), editar su JSON con validación y aceptarla como
// borrador (artefacto nuevo o nueva versión). Aceptar no aprueba; la
// revisión es opcional y se muestra como información (diseño vivo).
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
   * Requisitos premarcados como fuentes (p. ej. el requisito en contexto).
   * Solo preselecciona: nunca genera automáticamente.
   */
  preselectedRequirementIds?: string[] | null;
  /**
   * Mockups premarcados como fuentes (p. ej. el mockup en contexto).
   * `null`/`undefined` = ninguno premarcado (se eligen a mano).
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
        // Preselección: requisitos indicados (o todos los guardados) y
        // mockups indicados (o ninguno: se añaden a mano). La persona
        // ajusta. Sin veto por revisión (diseño vivo).
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
      // Las actualizaciones aceptan sobre el objetivo y la versión del
      // snapshot (fijados); las creaciones leen la esperada en fresco.
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
    <section className="editor design" aria-label="Diseño vinculado a requisitos">
      <div className="editor-head">
        <h3>Diseño del módulo</h3>
      </div>

      <div className="context-preview">
        <h4>Fuentes: requisitos guardados</h4>
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
                        title="Se generará desde su versión guardada; la revisión es opcional"
                      >
                        sin revisar{" "}
                      </span>
                    )}
                    <span className="hint">{item.excerpt}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <h4>Fuentes: mockups guardados (opcional)</h4>
        {mockups === null ? (
          <p className="hint">Cargando mockups…</p>
        ) : mockups.length === 0 ? (
          <p className="hint">El módulo aún no tiene mockups: dibújalos en la vista Mockups.</p>
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
                        title="Se generará desde su versión guardada; la revisión es opcional"
                      >
                        sin revisar{" "}
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
          Solo viajan a Meta las fuentes guardadas seleccionadas ({chosenCount}{" "}
          {chosenCount === 1 ? "requisito" : "requisitos"}
          {chosenMockups.length > 0 &&
            ` y ${chosenMockups.length} ${chosenMockups.length === 1 ? "mockup" : "mockups"}`}
          ). Los mockups viajan como resumen legible, sin posiciones. No se envían archivos,
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
            disabled={busy || totalChosen === 0}
            title={totalChosen === 0 ? "Selecciona al menos una fuente guardada" : undefined}
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
            // ¿El contexto incluye mockups? El tipo se deriva del artefacto
            // (versión `{artefacto}-vN`): sin inventar, solo para mostrar.
            const kindsByArtifact = new Map(artifacts.map((a) => [a.id, a.kind]));
            const mockupsInContext = generation.contextVersionIds.filter(
              (versionId) =>
                kindsByArtifact.get(versionId.replace(/-v\d+$/, "")) === "mockup",
            ).length;
            return (
              <article key={generation.id} className="generation-card">
                <header>
                  <code>{generation.id}</code> · {DESIGN_KIND_LABELS[generation.kind]} ·{" "}
                  {generation.model} · plantilla v{generation.templateVersion}
                  {mockupsInContext > 0 && (
                    <span>
                      {" "}· desde {mockupsInContext}{" "}
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
                    Desactualizada: cambió una fuente usada como contexto. La
                    propuesta sigue vinculada a su contexto original y no puede
                    aceptarse. Genera de nuevo con el contexto actual.
                  </p>
                ) : (
                  <p className="hint">
                    Contexto: {generation.contextVersionIds.join(", ") || "sin fuentes"}.
                  </p>
                )}
                <h5>{generation.proposal.title}</h5>
                {isUpdateGeneration(generation) && (
                  <p className="hint">
                    Propuesta de actualización de <code>{generation.targetArtifactId}</code>{" "}
                    (sobre <code>{generation.targetVersionId}</code>): el objetivo está fijado
                    y no puede cambiarse aquí.
                  </p>
                )}
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
                    {isUpdateGeneration(generation) ? (
                      <p className="hint">
                        Al aceptar crea una versión de <code>{generation.targetArtifactId}</code>{" "}
                        con las fuentes del snapshot. La aprobación sigue siendo un paso posterior.
                      </p>
                    ) : (
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
                    )}
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
