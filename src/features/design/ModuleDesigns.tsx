// Índice de diseños del módulo: todos los diseños con estado y acceso,
// más generación desde múltiples requisitos. La creación vive en el
// diálogo «Generar diseño».
import type { ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { artifactLabel } from "../requirements/names";
import type { ArtifactDto } from "../requirements/types";
import { AutoUpdateToggle, type AutoStatus } from "./AutoUpdateToggle";

interface ModuleDesignsProps {
  designs: ArtifactDto[];
  graph: ModuleGraph | null;
  meta: Record<string, ArtifactMeta>;
  /** Módulo archivado: índice consultable, sin generar. */
  moduleArchived: boolean;
  onOpenDesign: (designId: string) => void;
  onGenerate: () => void;
  /** Actualización IA automática del módulo (sesión, desactivada). */
  moduleName: string;
  autoEnabled: boolean;
  autoStatus: AutoStatus | null;
  onToggleAuto: (enabled: boolean) => void;
}

function kindLabel(kind: string): string {
  if (kind === "flow") return "flujo";
  if (kind === "data_model") return "datos";
  return kind;
}

export function ModuleDesigns({
  designs,
  graph,
  meta,
  moduleArchived,
  onOpenDesign,
  onGenerate,
  moduleName,
  autoEnabled,
  autoStatus,
  onToggleAuto,
}: ModuleDesignsProps) {
  const generateTitle = moduleArchived ? "Módulo archivado: restaúralo para generar" : undefined;
  const autoToggle = (
    <AutoUpdateToggle
      moduleName={moduleName}
      enabled={autoEnabled}
      disabled={moduleArchived}
      disabledTitle="Módulo archivado: restaúralo para automatizar"
      status={autoStatus}
      onToggle={onToggleAuto}
    />
  );
  if (designs.length === 0) {
    return (
      <div>
        <p className="hint">Este módulo aún no tiene diseños.</p>
        {moduleArchived && (
          <p className="notice" role="note">
            Módulo archivado: restaúralo para generar diseños.
          </p>
        )}
        <button type="button" className="primary" onClick={onGenerate} disabled={moduleArchived} title={generateTitle}>
          Generar diseño
        </button>
        {autoToggle}
      </div>
    );
  }
  return (
    <div className="module-designs">
      <div className="modal-actions" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
        <button type="button" className="primary" onClick={onGenerate} disabled={moduleArchived} title={generateTitle}>
          Generar diseño
        </button>
      </div>
      {autoToggle}
      {moduleArchived && (
        <p className="notice" role="note">
          Módulo archivado: los diseños se consultan, pero no se generan ni editan.
        </p>
      )}
      <ul className="pick-list">
        {designs.map((design) => {
          const stale = graph?.index?.freshness[design.id]?.stale ?? null;
          const sources = graph?.index?.freshness[design.id]?.pins.length ?? null;
          const label = artifactLabel(design.title, meta[design.id]?.label ?? null, design.id);
          return (
            <li key={design.id}>
              <button type="button" onClick={() => onOpenDesign(design.id)} title={design.id}>
                <span className="design-row">
                  <code>{label}</code>
                  {label !== design.id && (
                    <span className="hint">
                      <code>{design.id}</code>
                    </span>
                  )}
                  <span className="kind-badge">{kindLabel(design.kind)}</span>
                  {stale === true && <span className="stale-badge">desactualizado</span>}
                  {stale === false && sources !== null && (
                    <span className="hint">
                      {sources} {sources === 1 ? "fuente" : "fuentes"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
