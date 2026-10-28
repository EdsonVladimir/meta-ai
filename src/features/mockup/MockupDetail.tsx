// Detalle de un mockup: valida en Rust la versión mostrada (estructural,
// sin consumir API), resume pantallas y componentes, y ofrece el editor
// visual en la segunda pestaña. Informa a la revisión si la versión
// mostrada está validada: aprobar exige ese estado además de la
// revalidación en Rust. Solo el montaje canónico edita (los demás y las
// versiones históricas son lectura).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  approvalsForVersion,
  currentVersion,
  normalizeCoreError,
  type RequirementDetail,
  type VersionDto,
} from "../requirements/types";
import { validateMockup, type ValidatedMockupDto } from "./client";
import type { MockupDraftAction, MockupDraftState } from "./mockupDraft";
import type { MockupSaveState } from "./MockupEditor";

const MockupEditor = lazy(() =>
  import("./MockupEditor").then((module) => ({ default: module.MockupEditor })),
);

/** Cableado del borrador. Ausente = montaje de solo lectura. */
export interface MockupDetailEditing {
  projectId: string;
  moduleId: string;
  draft: MockupDraftState | null;
  onAction: (action: MockupDraftAction) => void;
  save: MockupSaveState;
  onSave: (author: string) => void;
  onSaveLayoutOnly: () => void;
  onAdoptPins: (pins: string[]) => void;
  onDeclareSources: (pins: string[], allowed: string[]) => void;
}

interface MockupDetailProps {
  detail: RequirementDetail;
  viewing: VersionDto | null;
  onBackToCurrent: () => void;
  onValidatedVersion: (versionId: string, ok: boolean) => void;
  editing?: MockupDetailEditing;
  /**
   * Renombrar el mockup; ausente = sin acción (lectura, histórica o
   * archivado). Recibe el detalle para derivar el objetivo.
   */
  onRename?: () => void;
  /** Mockup archivado: sin renombrar hasta restaurarlo. */
  renameDisabled?: boolean;
  /**
   * Abrir el diálogo «Generar diseño» con este mockup premarcado como
   * fuente. Ausente = sin acción (lectura histórica). Nunca genera solo.
   */
  onGenerateDesign?: () => void;
}

export function MockupDetail({
  detail,
  viewing,
  onBackToCurrent,
  onValidatedVersion,
  editing,
  onRename,
  renameDisabled = false,
  onGenerateDesign,
}: MockupDetailProps) {
  const current = currentVersion(detail);
  const shown = viewing ?? current;
  const [validated, setValidated] = useState<ValidatedMockupDto | null>(null);
  const [validateError, setValidateError] = useState<string | null>(null);
  const [tab, setTab] = useState<"summary" | "canvas">("summary");
  const cancelledRef = useRef(false);
  const notifyRef = useRef(onValidatedVersion);
  notifyRef.current = onValidatedVersion;

  const artifactId = detail.artifact.id;
  const title = detail.artifact.title;
  const shownId = shown?.id ?? "";
  const shownContent = shown?.content ?? "";

  useEffect(() => {
    cancelledRef.current = false;
    setValidated(null);
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
        const result = await validateMockup(spec);
        if (cancelledRef.current) return;
        setValidated(result);
        notifyRef.current(shownId, true);
      } catch (raw) {
        if (cancelledRef.current) return;
        setValidateError(normalizeCoreError(raw).message);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [artifactId, shownId, shownContent]);

  const approvals = shown ? approvalsForVersion(detail, shown.id) : [];

  useEffect(() => {
    setTab("summary");
  }, [artifactId]);

  return (
    <section className="editor design-detail" aria-label="Detalle de mockup">
      <div className="editor-head">
        <h3>
          {title !== null && title !== "" ? (
            <>
              {title} <code>{artifactId}</code>
            </>
          ) : (
            <code>{artifactId}</code>
          )}{" "}
          · mockup · v{shown?.number}{" "}
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
            title={renameDisabled ? "Restaura el mockup antes de renombrarlo" : "Renombrar mockup"}
          >
            Renombrar
          </button>
        )}
        {onGenerateDesign !== undefined && viewing === null && (
          <button
            type="button"
            className="primary small"
            onClick={onGenerateDesign}
            title="Proponer un flujo o ER con Meta usando este mockup como fuente"
          >
            Generar diseño
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
            <dt>Revisión</dt>
            <dd>
              {approvals.length === 0
                ? "Sin revisar"
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

      <div className="tabs" role="tablist" aria-label="Vistas del mockup">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "summary"}
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          Resumen
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

      {tab === "summary" ? (
        <>
          {validateError !== null && (
            <p className="error" role="alert">
              {validateError}
            </p>
          )}
          {validated !== null && (
            <dl className="facts">
              <div>
                <dt>Título</dt>
                <dd>{validated.title}</dd>
              </div>
              <div>
                <dt>Pantallas</dt>
                <dd>{validated.screens}</dd>
              </div>
              <div>
                <dt>Componentes</dt>
                <dd>{validated.components}</dd>
              </div>
            </dl>
          )}
          <p className="hint">
            El resumen se valida en Rust al mostrarlo; dibuja y edita en la pestaña{" "}
            {editing !== undefined ? "Editor" : "Lienzo"}.
          </p>
        </>
      ) : shown !== undefined && current !== undefined ? (
        <Suspense fallback={<p className="hint">Cargando editor…</p>}>
          <MockupEditor
            projectId={editing?.projectId ?? detail.artifact.projectId}
            moduleId={editing?.moduleId ?? detail.artifact.moduleId}
            artifactId={artifactId}
            versionId={shown.id}
            currentVersionId={current.id}
            content={shown.content}
            currentPins={current.sources}
            editable={editing !== undefined}
            draft={editing?.draft ?? null}
            onAction={editing?.onAction ?? (() => {})}
            save={editing?.save ?? { busy: false, error: null }}
            onSave={editing?.onSave ?? (() => {})}
            onSaveLayoutOnly={editing?.onSaveLayoutOnly ?? (() => {})}
            onAdoptPins={editing?.onAdoptPins ?? (() => {})}
            onDeclareSources={editing?.onDeclareSources ?? (() => {})}
          />
        </Suspense>
      ) : (
        <p className="hint">Sin versión que mostrar.</p>
      )}
    </section>
  );
}
