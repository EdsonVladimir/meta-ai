// Detalle de un artefacto de diseño: valida en Rust la versión mostrada
// (estructural, sin consumir API), dibuja el diagrama y expone explicación,
// preguntas, fuentes y procedencia. Informa a la revisión si la versión
// mostrada está validada y renderizada: aprobar exige ese estado además de
// la revalidación en Rust. La pestaña de lienzo/editor carga diferida el
// editor visual; solo el montaje canónico edita (los demás son lectura).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  approvalsForVersion,
  currentVersion,
  normalizeCoreError,
  type RequirementDetail,
  type VersionDto,
} from "../requirements/types";
import { validateDesign } from "./client";
import { MermaidDiagram } from "./MermaidDiagram";
import { DESIGN_KIND_LABELS, type DesignKind } from "./types";
import type { VisualSaveState } from "./editing/DesignEditor";
import type { VisualDraftAction, VisualDraftState } from "./editing/visualDraft";

const DesignEditor = lazy(() =>
  import("./editing/DesignEditor").then((module) => ({ default: module.DesignEditor })),
);

/** Cableado del borrador visual. Ausente = montaje de solo lectura. */
export interface DesignDetailEditing {
  projectId: string;
  draft: VisualDraftState | null;
  onAction: (action: VisualDraftAction) => void;
  save: VisualSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
}

interface DesignDetailProps {
  detail: RequirementDetail;
  viewing: VersionDto | null;
  onBackToCurrent: () => void;
  onValidatedVersion: (versionId: string, ok: boolean) => void;
  editing?: DesignDetailEditing;
  /**
   * Renombrar el diagrama; ausente = sin acción (lectura, histórica o
   * archivado). Recibe el detalle para derivar el objetivo.
   */
  onRename?: () => void;
  /** Diseño archivado: sin renombrar hasta restaurarlo. */
  renameDisabled?: boolean;
}

interface ShownSpec {
  explanation: string;
  questions: string[];
}

function specSummary(spec: unknown): ShownSpec {
  if (typeof spec !== "object" || spec === null) return { explanation: "", questions: [] };
  const record = spec as Record<string, unknown>;
  const explanation = typeof record.explanation === "string" ? record.explanation : "";
  const questions = Array.isArray(record.questions)
    ? record.questions.filter((q): q is string => typeof q === "string")
    : [];
  return { explanation, questions };
}

export function DesignDetail({
  detail,
  viewing,
  onBackToCurrent,
  onValidatedVersion,
  editing,
  onRename,
  renameDisabled = false,
}: DesignDetailProps) {
  const current = currentVersion(detail);
  const shown = viewing ?? current;
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [summary, setSummary] = useState<ShownSpec>({ explanation: "", questions: [] });
  const [validateError, setValidateError] = useState<string | null>(null);
  const [tab, setTab] = useState<"diagram" | "canvas">("diagram");
  const cancelledRef = useRef(false);
  const notifyRef = useRef(onValidatedVersion);
  notifyRef.current = onValidatedVersion;

  const kind = detail.artifact.kind as DesignKind;
  const shownId = shown?.id ?? "";
  const shownContent = shown?.content ?? "";

  useEffect(() => {
    cancelledRef.current = false;
    setMermaid(null);
    setValidateError(null);
    notifyRef.current(shownId, false);
    if (shownId === "") return;
    void (async () => {
      let spec: unknown;
      try {
        spec = JSON.parse(shownContent) as unknown;
      } catch {
        if (cancelledRef.current) return;
        setValidateError("El contenido guardado no es JSON válido.");
        return;
      }
      try {
        const result = await validateDesign({ kind, spec, generationId: null });
        if (cancelledRef.current) return;
        setSummary(specSummary(spec));
        setMermaid(result.mermaid);
      } catch (raw) {
        if (cancelledRef.current) return;
        setValidateError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [detail.artifact.id, kind, shownId, shownContent]);

  const approvals = shown ? approvalsForVersion(detail, shown.id) : [];
  const kindLabel = kind === "flow" || kind === "data_model" ? DESIGN_KIND_LABELS[kind] : kind;
  const artifactId = detail.artifact.id;
  const title = detail.artifact.title;

  useEffect(() => {
    setTab("diagram");
  }, [artifactId]);

  return (
    <section className="editor design-detail" aria-label="Detalle de diseño">
      <div className="editor-head">
        <h3>
          {title !== null && title !== "" ? (
            <>
              {title} <code>{artifactId}</code>
            </>
          ) : (
            <code>{artifactId}</code>
          )}{" "}
          · {kindLabel} · v{shown?.number}{" "}
          {viewing !== null ? (
            <span className="badge">lectura</span>
          ) : (
            <span className="badge">actual</span>
          )}
        </h3>
        {viewing !== null && (
          <button type="button" className="secondary small" onClick={onBackToCurrent}>
            Volver a la actual (v{current?.number})
          </button>
        )}
        {onRename !== undefined && viewing === null && (
          <button
            type="button"
            className="secondary small"
            onClick={onRename}
            disabled={renameDisabled}
            title={renameDisabled ? "Restaura el diagrama antes de renombrarlo" : "Renombrar diagrama"}
          >
            Renombrar
          </button>
        )}
      </div>

      {shown && (
        <dl className="facts">
          <div>
            <dt>Procedencia</dt>
            <dd>
              {shown.provenance.kind === "ai"
                ? `propuesta de IA (${shown.provenance.by})`
                : shown.provenance.by}
            </dd>
          </div>
          <div>
            <dt>Aprobación</dt>
            <dd>
              {approvals.length === 0
                ? "Sin aprobar"
                : approvals.map((a) => `${a.approvedBy} · ${a.at}`).join("; ")}
            </dd>
          </div>
          <div>
            <dt>Fuentes</dt>
            <dd>
              {shown.sources.length === 0
                ? "Sin dependencias"
                : shown.sources.join(", ")}
            </dd>
          </div>
        </dl>
      )}

      <div className="tabs" role="tablist" aria-label="Vistas del diseño">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "diagram"}
          className={tab === "diagram" ? "active" : ""}
          onClick={() => setTab("diagram")}
        >
          Diagrama
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "canvas"}
          className={tab === "canvas" ? "active" : ""}
          onClick={() => setTab("canvas")}
        >
          {editing !== undefined ? "Editor" : "Lienzo"}
        </button>
      </div>

      {tab === "diagram" ? (
        <>
          {validateError !== null && (
            <p className="error" role="alert">
              {validateError}
            </p>
          )}
          {mermaid !== null && (
            <>
              <MermaidDiagram
                source={mermaid}
                diagramId={`design-${artifactId}-${shownId}`}
                onRenderState={(ok) => notifyRef.current(shownId, ok)}
              />
              <details>
                <summary>Fuente Mermaid (solo lectura)</summary>
                <pre className="readonly-box">{mermaid}</pre>
              </details>
            </>
          )}
          {summary.explanation !== "" && <p>{summary.explanation}</p>}
          {summary.questions.length > 0 && (
            <section className="questions" aria-label="Preguntas pendientes">
              <h5>Preguntas pendientes</h5>
              <ul>
                {summary.questions.map((question, i) => (
                  <li key={i}>{question}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : shown !== undefined && current !== undefined && (kind === "flow" || kind === "data_model") ? (
        <Suspense fallback={<p className="hint">Cargando editor…</p>}>
          <DesignEditor
            projectId={editing?.projectId ?? detail.artifact.projectId}
            artifactId={artifactId}
            versionId={shown.id}
            currentVersionId={current.id}
            content={shown.content}
            currentPins={current.sources}
            kind={kind}
            editable={editing !== undefined}
            draft={editing?.draft ?? null}
            onAction={editing?.onAction ?? (() => {})}
            save={editing?.save ?? { busy: false, error: null }}
            onSave={editing?.onSave ?? (() => {})}
            onSaveLayoutOnly={editing?.onSaveLayoutOnly ?? (() => {})}
            onAdoptPins={editing?.onAdoptPins ?? (() => {})}
          />
        </Suspense>
      ) : (
        <p className="hint">Este artefacto no tiene lienzo visual.</p>
      )}
      <p className="hint">
        Sintaxis válida no garantiza corrección del diseño. Las versiones
        anteriores no se pueden editar ni aprobar como actuales.
      </p>
    </section>
  );
}
