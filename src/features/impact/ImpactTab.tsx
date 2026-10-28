// Pestaña Impacto (centro): encabezado con cambio, comparación Antes/Ahora,
// mapa de dependencias y tabla de artefactos. Presenta el informe de Rust;
// todo estado de consulta vive arriba para conservar el contexto al volver.
import { useEffect, useMemo, useRef, useState } from "react";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type ArtifactDto,
  type RequirementDetail,
} from "../requirements/types";
import { ImpactGraph } from "./ImpactGraph";
import { countPendingUnique, impactStatus, paginate } from "./coordination";
import { layoutImpactGraph } from "./layout";
import type { ImpactReportDto, ImpactedDto } from "./types";

const PAGE_SIZE = 8;

export function StatusBadge({ item }: { item: ImpactedDto }) {
  const status = impactStatus(item);
  if (status === "pending") return <span className="badge warn">! Requiere revisión</span>;
  if (status === "awaiting_approval")
    return <span className="badge awaiting">◷ Fuentes al día, revisión pendiente</span>;
  return <span className="badge ok">✓ Al día</span>;
}

export function kindName(kind: string): string {
  switch (kind) {
    case "requirement":
      return "Requisito";
    case "flow":
      return "Flujo";
    case "data_model":
      return "Modelo ER";
    case "mockup":
      return "Mockup";
    default:
      return kind;
  }
}

interface Props {
  projectId: string;
  moduleId: string;
  requirements: ArtifactDto[];
  originId: string | null;
  fromVersionId: string | null;
  report: ImpactReportDto | null;
  busy: boolean;
  error: string | null;
  selectedId: string | null;
  /** Cada incremento desplaza la vista a la comparación. */
  diffSignal: number;
  onOriginChange: (id: string) => void;
  onFromChange: (id: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onOpenArtifact: (artifactId: string, kind: string) => void;
}

export function ImpactTab(props: Props) {
  const { report, originId } = props;
  const [originDetail, setOriginDetail] = useState<RequirementDetail | null>(null);
  const [page, setPage] = useState(0);
  const diffRef = useRef<HTMLDivElement>(null);
  const firstSignal = useRef(props.diffSignal);

  // Versiones del origen para elegir la base de la comparación.
  useEffect(() => {
    if (originId === null) {
      setOriginDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const detail = await getRequirement(originId);
        if (!cancelled && detail.artifact.id === originId) setOriginDetail(detail);
      } catch (raw) {
        if (!cancelled) setOriginDetail(null);
        void normalizeCoreError(raw);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [originId]);

  useEffect(() => {
    setPage(0);
  }, [report]);

  useEffect(() => {
    if (props.diffSignal === firstSignal.current) return;
    diffRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [props.diffSignal]);

  const layout = useMemo(() => {
    if (report === null) return null;
    return layoutImpactGraph({
      originId: report.origin.artifact.id,
      originKind: report.origin.artifact.kind,
      originTitle: report.origin.artifact.title,
      affected: report.affected.map((a) => ({
        id: a.artifact.id,
        kind: a.artifact.kind,
        requiresReview: a.requiresReview,
        awaitingApproval: impactStatus(a) === "awaiting_approval",
        title: a.artifact.title,
      })),
      paths: report.affected.flatMap((a) => a.paths),
    });
  }, [report]);

  const pending = report === null ? 0 : countPendingUnique(report);
  const slice = report === null ? null : paginate(report.affected.length, page, PAGE_SIZE);
  const rows =
    report === null || slice === null ? [] : report.affected.slice(slice.start, slice.end);

  return (
    <div className="impact-tab">
      <header className="impact-head">
        <div className="field">
          <label htmlFor="impact-origin">Requisito</label>
          <select
            id="impact-origin"
            value={originId ?? ""}
            disabled={props.busy || props.requirements.length === 0}
            onChange={(e) => props.onOriginChange(e.target.value)}
          >
            {props.requirements.length === 0 && <option value="">Sin requisitos</option>}
            {props.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="impact-from">Comparar desde</label>
          <select
            id="impact-from"
            value={props.fromVersionId ?? ""}
            disabled={props.busy || originDetail === null}
            onChange={(e) =>
              props.onFromChange(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">Anterior a la actual (automático)</option>
            {(originDetail?.versions ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.number} · {v.id}
              </option>
            ))}
          </select>
        </div>
        {report !== null && (
          <p className="pending-badge" role="status">
            <strong>{pending}</strong> pendiente{pending === 1 ? "" : "s"} de{" "}
            {report.affected.length} relacionado{report.affected.length === 1 ? "" : "s"}
          </p>
        )}
      </header>

      {props.busy && report === null && <p className="hint">Calculando impacto…</p>}
      {props.error !== null && (
        <p className="error" role="alert">
          {props.error}
        </p>
      )}
      {report !== null && (
        <>
          <div
            id="impact-diff"
            ref={diffRef}
            className={props.diffSignal > firstSignal.current ? "diff-flash" : undefined}
          >
            <div className="before-after">
              <section aria-label="Antes">
                <h4>
                  Antes · v{report.origin.fromVersion.number} ({report.origin.fromVersion.id})
                </h4>
                <pre className="readonly-box">{report.origin.fromVersion.content}</pre>
              </section>
              <section aria-label="Ahora">
                <h4>
                  Ahora · v{report.origin.currentVersion.number} (
                  {report.origin.currentVersion.id})
                </h4>
                <pre className="readonly-box">{report.origin.currentVersion.content}</pre>
              </section>
            </div>
            {report.origin.fromVersion.id === report.origin.currentVersion.id && (
              <p className="hint">
                El requisito tiene una sola versión: no hay cambio que comparar todavía.
              </p>
            )}
          </div>

          {report.affected.length === 0 ? (
            <p className="notice">
              Sin dependientes: ningún artefacto deriva de este requisito, así que el cambio no
              alcanza a nadie.
            </p>
          ) : (
            <>
              {layout !== null && (
                <ImpactGraph
                  layout={layout}
                  selectedId={props.selectedId}
                  onSelect={props.onSelectNode}
                />
              )}
              {layout?.truncated === true && (
                <p className="notice stale" role="note">
                  Mapa truncado: muestra {layout.shown} de {layout.total} artefactos. La tabla
                  inferior conserva el listado completo.
                </p>
              )}
              <table className="impact-table">
                <caption>Artefactos relacionados y pendientes</caption>
                <thead>
                  <tr>
                    <th scope="col">Artefacto</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Versión actual</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Aprobación</th>
                    <th scope="col">Fuentes al día</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => {
                    const fresh = item.pins.filter((p) => !p.stale).length;
                    const selected = props.selectedId === item.artifact.id;
                    return (
                      <tr key={item.artifact.id} className={selected ? "selected" : ""}>
                        <td>
                          <button
                            type="button"
                            className="linklike"
                            onClick={() => props.onSelectNode(selected ? null : item.artifact.id)}
                            aria-pressed={selected}
                            title={item.artifact.title ?? item.artifact.id}
                          >
                            {item.artifact.title ?? item.artifact.id}
                          </button>
                        </td>
                        <td>{kindName(item.artifact.kind)}</td>
                        <td>
                          v{item.currentNumber} · {item.currentVersionId}
                        </td>
                        <td>
                          <StatusBadge item={item} />
                        </td>
                        <td>
                          {item.approvals.length > 0
                            ? `✓ ${item.approvals.map((a) => `${a.versionId} por ${a.approvedBy}`).join(", ")}`
                            : item.approvedBefore
                              ? "Histórica (versión anterior)"
                              : "—"}
                        </td>
                        <td>
                          {item.pins.length === 0
                            ? "—"
                            : `${fresh}/${item.pins.length}`}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary small"
                            onClick={() =>
                              props.onOpenArtifact(item.artifact.id, item.artifact.kind)
                            }
                          >
                            Abrir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {slice !== null && slice.pages > 1 && (
                <div className="button-row" role="navigation" aria-label="Páginas de la tabla">
                  <button
                    type="button"
                    className="secondary small"
                    disabled={slice.page === 0}
                    onClick={() => setPage(slice.page - 1)}
                  >
                    Anterior
                  </button>
                  <span className="hint" aria-live="polite">
                    Página {slice.page + 1} de {slice.pages} · {report.affected.length}{" "}
                    artefactos
                  </span>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={slice.page >= slice.pages - 1}
                    onClick={() => setPage(slice.page + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
