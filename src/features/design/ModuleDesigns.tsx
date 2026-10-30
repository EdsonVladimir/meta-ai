// Module design index: every design with state and access, plus
// generation from multiple requirements. Creation lives in the
// "Generate design" dialog.
import type { ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import { artifactLabel } from "../requirements/names";
import type { ArtifactDto } from "../requirements/types";
import { AutoUpdateToggle, type AutoStatus } from "./AutoUpdateToggle";

interface ModuleDesignsProps {
  designs: ArtifactDto[];
  graph: ModuleGraph | null;
  meta: Record<string, ArtifactMeta>;
  /** Archived module: browsable index, no generation. */
  moduleArchived: boolean;
  onOpenDesign: (designId: string) => void;
  onGenerate: () => void;
  /** Module automatic AI update (session, off). */
  moduleName: string;
  autoEnabled: boolean;
  autoStatus: AutoStatus | null;
  onToggleAuto: (enabled: boolean) => void;
}

function kindLabel(kind: string): string {
  if (kind === "flow") return "flow";
  if (kind === "data_model") return "data";
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
  const generateTitle = moduleArchived ? "Archived module: restore it to generate" : undefined;
  const autoToggle = (
    <AutoUpdateToggle
      moduleName={moduleName}
      enabled={autoEnabled}
      disabled={moduleArchived}
      disabledTitle="Archived module: restore it to automate"
      status={autoStatus}
      onToggle={onToggleAuto}
    />
  );
  if (designs.length === 0) {
    return (
      <div>
        <p className="hint">This module has no designs yet.</p>
        {moduleArchived && (
          <p className="notice" role="note">
            Archived module: restore it to generate designs.
          </p>
        )}
        <button type="button" className="primary" onClick={onGenerate} disabled={moduleArchived} title={generateTitle}>
          Generate design
        </button>
        {autoToggle}
      </div>
    );
  }
  return (
    <div className="module-designs">
      <div className="modal-actions" style={{ marginTop: 0, marginBottom: "0.75rem" }}>
        <button type="button" className="primary" onClick={onGenerate} disabled={moduleArchived} title={generateTitle}>
          Generate design
        </button>
      </div>
      {autoToggle}
      {moduleArchived && (
        <p className="notice" role="note">
          Archived module: designs can be browsed, but not generated or edited.
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
                  {stale === true && <span className="stale-badge">stale</span>}
                  {stale === false && sources !== null && (
                    <span className="hint">
                      {sources} {sources === 1 ? "source" : "sources"}
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
