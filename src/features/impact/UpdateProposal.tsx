// Propuesta de actualización de un diseño pendiente, dentro del inspector
// de impacto: vista previa del snapshot, generación explícita, comparación
// (diagramas + diff estructural) y aceptación como nueva versión del MISMO
// artefacto. Reutiliza el ciclo de generaciones de diseño; aquí solo vive
// el flujo de revisión. Las ediciones JSON se elevan por props para que
// navegar no las pierda; el resto es efímero y rederivable.
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
      return "Título";
    case "node":
      return "Nodo";
    case "edge":
      return "Arista";
    case "entity":
      return "Entidad";
    case "attribute":
      return "Atributo";
    case "relation":
      return "Relación";
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

  // Instantánea consultiva + propuestas guardadas. Si hay una retomable, se
  // abre directa; si no, se muestra la vista previa para generar.
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

  // Diagrama del diseño actual (vivo) para comparar.
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

  // Detalle vivo del objetivo: fuentes anteriores del snapshot y versión.
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

  // Diff estructural actual frente a propuesta (o su edición validada).
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
      setValidateError(`${parsed.error} Se conserva el último resultado válido.`);
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
      setValidateError(`${normalizeCoreError(raw).message} Se conserva el último resultado válido.`);
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
    <section className="update-proposal" aria-label={`Propuesta de actualización de ${targetId}`}>
      <div className="button-row">
        <button type="button" className="secondary small" onClick={props.onClose}>
          ← Volver al inspector
        </button>
      </div>

      {previewBusy && preview === null && <p className="hint">Cargando snapshot…</p>}
      {previewError !== null && (
        <p className="error" role="alert">
          {previewError}
        </p>
      )}

      {preview !== null && generation === null && (
        <>
          <h4>
            Actualizar {targetId} <span className="hint">({kindName(preview.kind)})</span>
          </h4>
          <p className="hint">
            Versión actual <code>{preview.currentVersionId}</code>. La propuesta conservará el
            mismo conjunto de fuentes con sus versiones actuales; nada se añade ni elimina solo.
          </p>
          <h5>Fuentes utilizadas frente a actuales</h5>
          {preview.sources.length === 0 ? (
            <p className="hint">El diseño actual no declara fuentes.</p>
          ) : (
            <ul className="pin-list">
              {preview.sources.map((source) => (
                <li key={source.artifactId} className={source.changed ? "stale" : ""}>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => props.onSelectNode(source.artifactId)}
                    title="Seleccionar en el mapa"
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
                      title="Informativo: no bloquea la generación"
                    >
                      sin revisar
                    </span>
                  )}
                  {!source.currentValid && <span className="badge warn">desactualizada</span>}
                </li>
              ))}
            </ul>
          )}
          {preview.origin !== null && preview.origin !== undefined && (
            <>
              <h5>
                Cambio origen · {preview.origin.artifactId} ({preview.origin.fromVersionId} →{" "}
                {preview.origin.currentVersionId})
              </h5>
              <div className="before-after single-col">
                <section aria-label="Antes">
                  <h6>Antes</h6>
                  <pre className="readonly-box">{preview.origin.fromContent}</pre>
                </section>
                <section aria-label="Ahora">
                  <h6>Ahora</h6>
                  <pre className="readonly-box">{preview.origin.currentContent}</pre>
                </section>
              </div>
            </>
          )}
          {preview.paths.length > 0 && (
            <>
              <h5>Caminos relevantes</h5>
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
                      Ver {blocker.artifactId} en el mapa
                    </button>
                  )}
                </p>
              ))}
            </div>
          )}
          <p className="notice">
            A Meta viajan el diseño actual, las fuentes con sus dos versiones y el cambio origen.
            No se envían archivos, secretos ni otros módulos. Sin reintentos automáticos.
          </p>
          <div className="button-row">
            <button
              type="button"
              className="primary small"
              onClick={() => void handleGenerate()}
              disabled={!preview.canGenerate || generating}
            >
              {generating ? "Generando…" : "Generar propuesta"}
            </button>
          </div>
          {generateError !== null && (
            <p className="error" role="alert">
              {generateError}
            </p>
          )}
          {others.length > 0 && (
            <p className="hint">
              Hay {others.length} propuesta{others.length === 1 ? "" : "s"} guardada
              {others.length === 1 ? "" : "s"} para este diseño ({others.map((g) => g.id).join(", ")}
              ); genera de nuevo para una propuesta fresca.
            </p>
          )}
        </>
      )}

      {generation !== null && (
        <>
          <h4>
            Propuesta <code>{generation.id}</code>
          </h4>
          <p className="hint">
            {generation.model} · plantilla v{generation.templateVersion}
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
              Desactualizada: el diseño o una fuente cambió durante la generación o la revisión. La
              propuesta se conserva pero no puede aceptarse.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generar de nuevo
              </button>
            </p>
          )}
          {generation.proposal.state === "accepted" && (
            <p className="notice" role="note">
              Aceptada como borrador de <code>{generation.proposal.artifactId}</code>. La aprobación
              sigue siendo un paso posterior desde su vista.{" "}
              <button
                type="button"
                className="linklike"
                onClick={() => {
                  const id = generation.proposal.artifactId;
                  if (id !== null && id !== undefined) props.onOpenArtifact(id, generation.kind);
                }}
              >
                Abrir diseño
              </button>
            </p>
          )}
          {generation.proposal.state === "discarded" && (
            <p className="notice" role="note">
              Descartada: no puede aceptarse.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generar de nuevo
              </button>
            </p>
          )}
          {generation.proposal.state === "pending" && !generation.stale && (
            <p className="hint">
              Propuesta retomada de una generación anterior.{" "}
              <button type="button" className="linklike" onClick={() => setGeneration(null)}>
                Generar otra propuesta
              </button>
            </p>
          )}

          <div className="center-tabs" role="tablist" aria-label="Comparación">
            <button
              type="button"
              role="tab"
              aria-selected={side === "current"}
              className={side === "current" ? "active" : ""}
              onClick={() => setSide("current")}
            >
              Actual
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={side === "proposed"}
              className={side === "proposed" ? "active" : ""}
              onClick={() => setSide("proposed")}
            >
              Propuesta
            </button>
          </div>
          {side === "current" ? (
            currentMermaid === null ? (
              <p className="hint">El diseño actual no tiene diagrama válido.</p>
            ) : (
              <MermaidDiagram source={currentMermaid} diagramId={`upd-current-${generation.id}`} />
            )
          ) : proposedMermaid === null ? (
            <p className="hint">Sin diagrama propuesto.</p>
          ) : (
            <MermaidDiagram source={proposedMermaid} diagramId={`upd-proposed-${generation.id}`} />
          )}

          <h5>Diferencias estructurales</h5>
          {diffError !== null && (
            <p className="error" role="alert">
              {diffError}
            </p>
          )}
          {diff !== null && (
            <div className="structural-diff">
              {(
                [
                  ["added", "Añadidos", diff.added],
                  ["removed", "Eliminados", diff.removed],
                  ["modified", "Modificados", diff.modified],
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

          <h5>Fuentes anteriores y nuevas</h5>
          <p className="hint">
            Anteriores:{" "}
            {snapshotSources === null ? (
              "cargando…"
            ) : snapshotSources.length === 0 ? (
              "ninguna"
            ) : (
              <span className="mono">{snapshotSources.join(", ")}</span>
            )}
            <br />
            Nuevas: <span className="mono">{generation.contextVersionIds.join(", ") || "ninguna"}</span>
          </p>

          <h5>{generation.proposal.title}</h5>
          <p>{generation.proposal.explanation}</p>
          {generation.questions.length > 0 && (
            <section className="questions" aria-label="Preguntas pendientes">
              <h6>Preguntas pendientes</h6>
              <ul>
                {generation.questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </section>
          )}
          <p className="hint">
            La explicación es una propuesta, no evidencia de corrección: lo que cuenta es el diff
            estructural y tu revisión.
          </p>

          {generation.proposal.state === "pending" && (
            <>
              <label className="field">
                <span>Especificación JSON (autoritativa)</span>
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
                  Validar y previsualizar
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
                  Restablecer
                </button>
                <button
                  type="button"
                  className="primary small"
                  onClick={() => void handleAccept()}
                  disabled={!actionable}
                  title="Crea una versión del mismo artefacto, sin aprobar"
                >
                  {acting ? "Aceptando…" : "Aceptar como borrador"}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => void handleDiscard()}
                  disabled={!actionable}
                >
                  Descartar
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
