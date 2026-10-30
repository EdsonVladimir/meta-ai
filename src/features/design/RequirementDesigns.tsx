// Designs linked to a requirement: Flows/Data subtabs, a picker when
// there are several, the reused detail, complete sources and
// staleness marks. Everything derives from the exact-source index.
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
  /** Module artifacts: they provide the designs own titles. */
  designs: ArtifactDto[];
  onOpenDesign: (designId: string) => void;
  onOpenRequirement: (requirementId: string) => void;
  onGenerate: (preselected: string[]) => void;
  /** Archived requirement or module: browsable links, no generation. */
  archived: boolean;
  /** Module automatic AI update (session, off). */
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
      disabledTitle="Archived: restore it to automate"
      status={autoStatus}
      onToggle={onToggleAuto}
    />
  );
  const [tab, setTab] = useState<"flow" | "data_model">("flow");
  const [chosenId, setChosenId] = useState<string | null>(null);

  if (graph === null || graph.status === "loading") {
    return <p className="hint">Computing linked designs…</p>;
  }
  if (graph.status === "error" || graph.index === null) {
    return (
      <p className="error" role="alert">
        Could not compute the links: {graph.error ?? "unknown error."} Expand the
        requirement in the tree to retry.
      </p>
    );
  }
  const links = graph.index.byRequirement[requirementId] ?? [];
  if (links.length === 0) {
    return (
      <div>
        <p className="hint">This requirement has no linked designs yet.</p>
        {archived && (
          <p className="notice" role="note">
            Archived: restore it to generate designs.
          </p>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => onGenerate([requirementId])}
          disabled={archived}
          title={archived ? "Archived: restore it to generate" : undefined}
        >
          Generate design
        </button>
        {autoToggle}
      </div>
    );
  }
  const flows = links.filter((l) => l.kind === "flow");
  // ER models only: linked mockups live in their own view.
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
      <div className="center-tabs" role="tablist" aria-label="Linked designs">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "flow"}
          className={activeTab === "flow" ? "active" : ""}
          disabled={flows.length === 0}
          onClick={() => setTab("flow")}
        >
          Flows ({flows.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "data_model"}
          className={activeTab === "data_model" ? "active" : ""}
          disabled={models.length === 0}
          onClick={() => setTab("data_model")}
        >
          Data ({models.length})
        </button>
        <span className="tabs-actions">
          <button type="button" className="secondary small" onClick={() => onGenerate([requirementId])}>
            Generate design
          </button>
        </span>
      </div>
      {visible.length > 1 && (
        <label className="design-picker">
          Related diagram
          <select value={chosen.artifactId} onChange={(e) => setChosenId(e.target.value)}>
            {visible.map((l) => (
              <option key={l.artifactId} value={l.artifactId}>
                {designLabel(designs, meta, l.artifactId)}
                {l.link === "transitive" ? " (via " + l.via.join(", ") + ")" : ""}
                {l.stale ? " · stale" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        Link {chosen.link === "direct" ? "direct" : `transitive (via ${chosen.via.join(", ")})`}
        {chosen.stale ? " · pins versions that are no longer current" : ""} ·{" "}
        <button type="button" className="linklike" onClick={() => onOpenDesign(chosen.artifactId)}>
          Open detail
        </button>
      </p>
      {freshness?.stale === true && (
        <p className="notice stale" role="status">
          Stale design: uses{" "}
          {freshness.pins
            .filter((p) => p.stale)
            .map((p) => `${p.versionId} (current: ${p.currentVersionId})`)
            .join(", ")}
          .
        </p>
      )}
      {detail !== null && (
        <DesignDetail detail={detail} viewing={null} onBackToCurrent={() => {}} onValidatedVersion={() => {}} />
      )}
      {freshness !== null && freshness.pins.length > 0 && (
        <section className="design-sources" aria-label="Design sources">
          <h4>Complete sources</h4>
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
          <code>{pin.versionId}</code> <span className="hint">source foreign to the loaded module</span>
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
        title={`Open ${pin.artifactId}`}
      >
        <span>
          <code>{sourceLabel}</code> <code>{pin.versionId}</code>
          {pin.stale && <span className="stale-badge">old (current: {pin.currentVersionId})</span>}
        </span>
      </button>
    </li>
  );
}
