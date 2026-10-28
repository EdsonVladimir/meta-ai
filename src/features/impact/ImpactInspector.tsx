// Inspector de impacto (derecha): por qué está afectado lo seleccionado,
// con qué fuentes cuenta y navegación real al artefacto. Sin chat ni
// botones de reparación simulados: solo lectura y navegación.
import { useEffect, useRef, useState } from "react";
import { getRequirement } from "../requirements/client";
import {
  normalizeCoreError,
  type RequirementDetail,
} from "../requirements/types";
import { kindName, StatusBadge } from "./ImpactTab";
import type { ImpactReportDto, ImpactedDto } from "./types";
import { UpdateProposal } from "./UpdateProposal";

interface Props {
  report: ImpactReportDto;
  projectId: string;
  moduleId: string;
  selectedId: string | null;
  edits: Record<string, string>;
  onEdit: (generationId: string, text: string | null) => void;
  onSelectNode: (id: string | null) => void;
  onOpenArtifact: (artifactId: string, kind: string) => void;
  onShowDiff: () => void;
  onAccepted: (detail: RequirementDetail) => void;
}

export function ImpactInspector(props: Props) {
  const { report, selectedId, onSelectNode, onOpenArtifact, onShowDiff } = props;
  const origin = report.origin;
  const isOrigin = selectedId === origin.artifact.id;
  const selected: ImpactedDto | null =
    selectedId === null || isOrigin
      ? null
      : (report.affected.find((a) => a.artifact.id === selectedId) ?? null);

  // Diseño en modo actualización (las ediciones viven arriba y sobreviven).
  const [updating, setUpdating] = useState<string | null>(null);
  const updateTarget =
    updating !== null && selected?.artifact.id === updating ? selected : null;

  const [showSources, setShowSources] = useState(true);
  const [diff, setDiff] = useState<RequirementDetail | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const wanted = useRef<string | null>(null);

  // Al cambiar de nodo se repliega lo cargado: cada diferencia es de su nodo.
  useEffect(() => {
    wanted.current = selectedId;
    setDiff(null);
    setDiffError(null);
    setDiffBusy(false);
    setDiffOpen(false);
    setShowSources(true);
  }, [selectedId]);

  async function loadDiff(artifactId: string) {
    wanted.current = artifactId;
    setDiffOpen(true);
    setDiffBusy(true);
    setDiffError(null);
    try {
      const detail = await getRequirement(artifactId);
      if (wanted.current !== artifactId) return;
      setDiff(detail);
    } catch (raw) {
      if (wanted.current !== artifactId) return;
      setDiffError(normalizeCoreError(raw).message);
    } finally {
      if (wanted.current === artifactId) setDiffBusy(false);
    }
  }

  if (selectedId === null) {
    return (
      <aside className="review" aria-label="Inspector de impacto">
        <h3>Impacto</h3>
        <p className="hint">
          Selecciona un nodo del mapa o una fila de la tabla para ver por qué está afectado, con
          qué fuentes cuenta y cómo navegar a su diseño.
        </p>
        <dl className="facts">
          <div>
            <dt>Origen</dt>
            <dd>
              {origin.artifact.title !== null && origin.artifact.title !== ""
                ? `${origin.artifact.title} (${origin.artifact.id})`
                : origin.artifact.id}
            </dd>
          </div>
          <div>
            <dt>Cambio</dt>
            <dd>
              v{origin.fromVersion.number} → v{origin.currentVersion.number}
            </dd>
          </div>
          <div>
            <dt>Relacionados</dt>
            <dd>{report.affected.length}</dd>
          </div>
        </dl>
        <p className="hint">
          Estar relacionado no es un error: significa que el cambio alcanza al artefacto por sus
          dependencias registradas.
        </p>
      </aside>
    );
  }

  if (isOrigin) {
    return (
      <aside className="review" aria-label="Inspector de impacto">
        <h3>
          {origin.artifact.title !== null && origin.artifact.title !== "" ? (
            <>
              {origin.artifact.title} <code>{origin.artifact.id}</code>
            </>
          ) : (
            origin.artifact.id
          )}
        </h3>
        <p>
          <span className="badge">◉ Origen del cambio</span>
        </p>
        <p className="hint">
          {kindName(origin.artifact.kind)} · v{origin.fromVersion.number} → v
          {origin.currentVersion.number}
        </p>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={onShowDiff}>
            Ver diferencias
          </button>
          <button
            type="button"
            className="secondary small"
            onClick={() => onOpenArtifact(origin.artifact.id, origin.artifact.kind)}
          >
            Abrir requisito
          </button>
          <button type="button" className="secondary small" onClick={() => onSelectNode(null)}>
            Soltar selección
          </button>
        </div>
      </aside>
    );
  }

  if (selected === null) {
    return (
      <aside className="review" aria-label="Inspector de impacto">
        <h3>Impacto</h3>
        <p className="error" role="alert">
          La selección ({selectedId}) ya no está en el informe: el informe cambió. Vuelve a
          seleccionar un nodo.
        </p>
        <button type="button" className="secondary small" onClick={() => onSelectNode(null)}>
          Limpiar selección
        </button>
      </aside>
    );
  }

  const openLabel =
    selected.artifact.kind === "requirement"
      ? "Abrir requisito"
      : selected.artifact.kind === "mockup"
        ? "Abrir mockup"
        : "Abrir diseño";
  const versions = diff?.versions ?? [];
  const prev = versions.length >= 2 ? versions[versions.length - 2] : null;
  const curr = versions.length >= 1 ? versions[versions.length - 1] : null;
  const canProposeUpdate =
    (selected.artifact.kind === "flow" || selected.artifact.kind === "data_model") &&
    selected.requiresReview;

  if (updateTarget !== null) {
    return (
      <aside className="review" aria-label="Inspector de impacto">
        <UpdateProposal
          projectId={props.projectId}
          moduleId={props.moduleId}
          target={updateTarget}
          originArtifactId={origin.artifact.id}
          originFromVersionId={origin.fromVersion.id}
          edits={props.edits}
          onEdit={props.onEdit}
          onAccepted={props.onAccepted}
          onOpenArtifact={onOpenArtifact}
          onSelectNode={onSelectNode}
          onClose={() => setUpdating(null)}
        />
      </aside>
    );
  }

  return (
    <aside className="review" aria-label="Inspector de impacto">
      <h3>
        {selected.artifact.title !== null && selected.artifact.title !== "" ? (
          <>
            {selected.artifact.title} <code>{selected.artifact.id}</code>
          </>
        ) : (
          selected.artifact.id
        )}
      </h3>
      <p>
        <StatusBadge item={selected} />{" "}
        <span className="hint">{kindName(selected.artifact.kind)}</span>
      </p>
      {selected.approvedBefore && (
        <p className="hint">
          {selected.approvals.length > 0
            ? `Aprobado: ${selected.approvals.map((a) => `${a.versionId} por ${a.approvedBy}`).join(", ")}.`
            : "Aprobado históricamente en una versión anterior."}{" "}
          {selected.requiresReview &&
            "La aprobación histórica se conserva, pero la versión actual usa fuentes antiguas."}
        </p>
      )}

      <h4>Por qué está afectado</h4>
      {selected.paths.length === 0 ? (
        <p className="hint">Sin caminos registrados.</p>
      ) : (
        <ol className="path-list">
          {selected.paths.map((path, i) => (
            <li key={i}>
              {path.map((node, j) => (
                <span key={`${node}-${j}`}>
                  {j > 0 && <span aria-hidden="true"> → </span>}
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => onSelectNode(node)}
                    title="Seleccionar en el mapa"
                  >
                    {node}
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}

      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          onClick={() => void loadDiff(selected.artifact.id)}
          disabled={diffBusy}
        >
          {diffBusy ? "Cargando…" : "Ver diferencias"}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => setShowSources((v) => !v)}
          aria-pressed={showSources}
        >
          {showSources ? "Ocultar fuentes" : "Ver fuentes"}
        </button>
        <button
          type="button"
          className="secondary small"
          onClick={() => onOpenArtifact(selected.artifact.id, selected.artifact.kind)}
        >
          {openLabel}
        </button>
        {canProposeUpdate && (
          <button
            type="button"
            className="primary small"
            onClick={() => setUpdating(selected.artifact.id)}
            title="Solicitar a Meta un ajuste del diseño, para revisar y aceptar como borrador"
          >
            Proponer actualización
          </button>
        )}
      </div>

      {showSources && (
        <section aria-label="Fuentes utilizadas frente a actuales">
          <h4>
            Fuentes ({selected.pins.filter((p) => !p.stale).length}/{selected.pins.length} al día)
          </h4>
          {selected.pins.length === 0 ? (
            <p className="hint">La versión actual no declara fuentes.</p>
          ) : (
            <ul className="pin-list">
              {selected.pins.map((pin) => (
                <li key={pin.usedVersionId} className={pin.stale ? "stale" : ""}>
                  <span className="mono">{pin.usedVersionId}</span>
                  {pin.currentVersionId !== null &&
                  pin.currentVersionId !== pin.usedVersionId ? (
                    <span className="hint">
                      {" "}
                      → actual: <span className="mono">{pin.currentVersionId}</span>
                    </span>
                  ) : (
                    <span className="hint"> · es la actual</span>
                  )}
                  {pin.stale && <span className="badge warn">antigua</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {diffOpen && (
        <section aria-label="Diferencias del artefacto">
          <h4>
            Diferencias · {selected.artifact.id}
          </h4>
          {diffBusy && diff === null && <p className="hint">Cargando historial…</p>}
          {diffError !== null && (
            <p className="error" role="alert">
              {diffError}
            </p>
          )}
          {diff !== null && curr !== null && (
            <>
              <h5>
                Antes · {prev === null ? "—" : `v${prev.number} (${prev.id})`}
              </h5>
              <pre className="readonly-box">
                {prev === null ? "Sin versión anterior: es la primera." : prev.content}
              </pre>
              <h5>
                Ahora · v{curr.number} ({curr.id})
              </h5>
              <pre className="readonly-box">{curr.content}</pre>
              <p className="hint">
                Resolver el pendiente requiere guardar una versión revisada con las fuentes
                correctas desde su vista; este informe no modifica nada.
              </p>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
