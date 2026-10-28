// Diseños vinculados a un requisito: subpestañas Flujos/Datos, selector
// cuando hay varios, detalle reutilizado, fuentes completas y marcas de
// desactualización. Todo deriva del índice de fuentes exactas.
import { useState } from "react";
import type { ArtifactMeta } from "../explorer/explorerModel";
import type { ModuleGraph } from "../explorer/useExplorerData";
import type { DesignLink } from "./coordination";
import { DesignDetail } from "./DesignDetail";
import { artifactLabel } from "../requirements/names";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";
import { AutoUpdateToggle, type AutoStatus } from "./AutoUpdateToggle";

interface RequirementDesignsProps {
  projectId: string;
  moduleId: string;
  requirementId: string;
  graph: ModuleGraph | null;
  meta: Record<string, ArtifactMeta>;
  /** Artefactos del módulo: aportan los títulos propios de los diseños. */
  designs: ArtifactDto[];
  onOpenDesign: (designId: string) => void;
  onOpenRequirement: (requirementId: string) => void;
  onGenerate: (preselected: string[]) => void;
  /** Requisito o módulo archivado: vínculos consultables, sin generar. */
  archived: boolean;
  /** Actualización IA automática del módulo (sesión, desactivada). */
  moduleName: string;
  autoEnabled: boolean;
  autoStatus: AutoStatus | null;
  onToggleAuto: (enabled: boolean) => void;
}

function designLabel(
  designs: ArtifactDto[],
  meta: Record<string, ArtifactMeta>,
  id: string,
): string {
  const title = designs.find((d) => d.id === id)?.title ?? null;
  return artifactLabel(title, meta[id]?.label ?? null, id);
}

export function RequirementDesigns({
  requirementId,
  graph,
  meta,
  designs,
  archived,
  moduleName,
  autoEnabled,
  autoStatus,
  onToggleAuto,
  onOpenDesign,
  onOpenRequirement,
  onGenerate,
}: RequirementDesignsProps) {
  const autoToggle = (
    <AutoUpdateToggle
      moduleName={moduleName}
      enabled={autoEnabled}
      disabled={archived}
      disabledTitle="Archivado: restaúralo para automatizar"
      status={autoStatus}
      onToggle={onToggleAuto}
    />
  );
  const [tab, setTab] = useState<"flow" | "data_model">("flow");
  const [chosenId, setChosenId] = useState<string | null>(null);

  if (graph === null || graph.status === "loading") {
    return <p className="hint">Calculando diseños vinculados…</p>;
  }
  if (graph.status === "error" || graph.index === null) {
    return (
      <p className="error" role="alert">
        No se pudieron calcular los vínculos: {graph.error ?? "error desconocido."} Expande el
        requisito en el árbol para reintentar.
      </p>
    );
  }
  const links = graph.index.byRequirement[requirementId] ?? [];
  if (links.length === 0) {
    return (
      <div>
        <p className="hint">Este requisito aún no tiene diseños vinculados.</p>
        {archived && (
          <p className="notice" role="note">
            Archivado: restaúralo para generar diseños.
          </p>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => onGenerate([requirementId])}
          disabled={archived}
          title={archived ? "Archivado: restaúralo para generar" : undefined}
        >
          Generar diseño
        </button>
        {autoToggle}
      </div>
    );
  }
  const flows = links.filter((l) => l.kind === "flow");
  // Solo modelos ER: los mockups vinculados viven en su propia vista.
  const models = links.filter((l) => l.kind === "data_model");
  const activeTab = tab === "flow" && flows.length > 0 ? "flow" : models.length > 0 ? "data_model" : "flow";
  const visible = activeTab === "flow" ? flows : models;
  const chosen: DesignLink =
    visible.find((l) => l.artifactId === chosenId) ?? visible[0];
  const detail = graph.details.find((d) => d.artifact.id === chosen.artifactId) ?? null;
  const freshness = graph.index.freshness[chosen.artifactId] ?? null;

  return (
    <div className="linked-designs">
      {autoToggle}
      <div className="center-tabs" role="tablist" aria-label="Diseños vinculados">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "flow"}
          className={activeTab === "flow" ? "active" : ""}
          disabled={flows.length === 0}
          onClick={() => setTab("flow")}
        >
          Flujos ({flows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "data_model"}
          className={activeTab === "data_model" ? "active" : ""}
          disabled={models.length === 0}
          onClick={() => setTab("data_model")}
        >
          Datos ({models.length})
        </button>
        <span className="tabs-actions">
          <button type="button" className="secondary small" onClick={() => onGenerate([requirementId])}>
            Generar diseño
          </button>
        </span>
      </div>
      {visible.length > 1 && (
        <label className="design-picker">
          Diagrama relacionado
          <select value={chosen.artifactId} onChange={(e) => setChosenId(e.target.value)}>
            {visible.map((l) => (
              <option key={l.artifactId} value={l.artifactId}>
                {designLabel(designs, meta, l.artifactId)}
                {l.link === "transitive" ? " (vía " + l.via.join(", ") + ")" : ""}
                {l.stale ? " · desactualizado" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        Vínculo {chosen.link === "direct" ? "directo" : `transitivo (vía ${chosen.via.join(", ")})`}
        {chosen.stale ? " · fija versiones que ya no son actuales" : ""} ·{" "}
        <button type="button" className="linklike" onClick={() => onOpenDesign(chosen.artifactId)}>
          Abrir detalle
        </button>
      </p>
      {freshness?.stale === true && (
        <p className="notice stale" role="status">
          Diseño desactualizado: usa{" "}
          {freshness.pins
            .filter((p) => p.stale)
            .map((p) => `${p.versionId} (actual: ${p.currentVersionId})`)
            .join(", ")}
          .
        </p>
      )}
      {detail !== null && (
        <DesignDetail detail={detail} viewing={null} onBackToCurrent={() => {}} onValidatedVersion={() => {}} />
      )}
      {freshness !== null && freshness.pins.length > 0 && (
        <section className="design-sources" aria-label="Fuentes del diseño">
          <h4>Fuentes completas</h4>
          <ul className="pick-list">
            {freshness.pins.map((pin) => (
              <SourceRow
                key={pin.versionId}
                pin={pin}
                meta={meta}
                details={graph.details}
                onOpenRequirement={onOpenRequirement}
                onOpenDesign={onOpenDesign}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SourceRow({
  pin,
  meta,
  details,
  onOpenRequirement,
  onOpenDesign,
}: {
  pin: { versionId: string; artifactId: string | null; currentVersionId: string | null; stale: boolean };
  meta: Record<string, ArtifactMeta>;
  details: RequirementDetail[];
  onOpenRequirement: (requirementId: string) => void;
  onOpenDesign: (designId: string) => void;
}) {
  if (pin.artifactId === null) {
    return (
      <li>
        <span>
          <code>{pin.versionId}</code> <span className="hint">fuente ajena al módulo cargado</span>
        </span>
      </li>
    );
  }
  const known = details.find((d) => d.artifact.id === pin.artifactId);
  const isReq = known?.artifact.kind === "requirement";
  const sourceLabel = artifactLabel(
    known?.artifact.title ?? null,
    pin.artifactId === null ? null : (meta[pin.artifactId]?.label ?? null),
    pin.artifactId ?? pin.versionId,
  );
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          isReq ? onOpenRequirement(pin.artifactId as string) : onOpenDesign(pin.artifactId as string)
        }
        title={`Abrir ${pin.artifactId}`}
      >
        <span>
          <code>{sourceLabel}</code> <code>{pin.versionId}</code>
          {pin.stale && <span className="stale-badge">antigua (actual: {pin.currentVersionId})</span>}
        </span>
      </button>
    </li>
  );
}
