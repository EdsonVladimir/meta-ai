// Detalle de un artefacto de diseño: valida en Rust la versión mostrada
// (estructural, sin consumir API), dibuja el diagrama y expone explicación,
// preguntas, fuentes y procedencia. Informa a la revisión si la versión
// mostrada está validada y renderizada: aprobar exige ese estado además de
// la revalidación en Rust.
import { useEffect, useRef, useState } from "react";
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

interface DesignDetailProps {
  detail: RequirementDetail;
  viewing: VersionDto | null;
  onBackToCurrent: () => void;
  onValidatedVersion: (versionId: string, ok: boolean) => void;
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

export function DesignDetail({ detail, viewing, onBackToCurrent, onValidatedVersion }: DesignDetailProps) {
  const current = currentVersion(detail);
  const shown = viewing ?? current;
  const [mermaid, setMermaid] = useState<string | null>(null);
  const [summary, setSummary] = useState<ShownSpec>({ explanation: "", questions: [] });
  const [validateError, setValidateError] = useState<string | null>(null);
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

  return (
    <section className="editor design-detail" aria-label="Detalle de diseño">
      <div className="editor-head">
        <h3>
          <code>{detail.artifact.id}</code> · {kindLabel} · v{shown?.number}{" "}
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

      {validateError !== null && (
        <p className="error" role="alert">
          {validateError}
        </p>
      )}
      {mermaid !== null && (
        <>
          <MermaidDiagram
            source={mermaid}
            diagramId={`design-${detail.artifact.id}-${shownId}`}
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
      <p className="hint">
        Sintaxis válida no garantiza corrección del diseño. Las versiones
        anteriores no se pueden editar ni aprobar como actuales.
      </p>
    </section>
  );
}
