// Compact canvas toolbar: one row owning the module filter,
// symbol search, layer/edge menus and card grouping, with
// analysis details one click away. Boards below share it; the
// canvas keeps the freed space. Purely presentational: state
// lives in the view, actions arrive as callbacks.
import { useState, type ReactNode } from "react";
import { ARCH_LAYERS, type ArchLayer } from "./archLayers";
import type { ArchEdgeKind } from "./archModel";
import type { BoardEdgeOpts } from "./boardLayout";
import type { CodeModuleOption } from "./codeModules";

const LEGEND: Array<{ kind: ArchEdgeKind; hint: string }> = [
  { kind: "imports", hint: "File import: a module dependency." },
  { kind: "extends", hint: "Class inheritance." },
  { kind: "implements", hint: "Interface implementation." },
  { kind: "instantiates", hint: "Built with new inside the symbol." },
  { kind: "references", hint: "Type or value use. Never a call: calls are not resolved." },
];

/** One analyzed scope inside the Details panel. */
export interface ToolbarDetailRow {
  key: string;
  title: string;
  status: string;
  /** One line each: errors, exclusions, externals, skipped, truncation. */
  notes: string[];
  showRetry: boolean;
  showCancel: boolean;
  /** "Analyze more (6 pending)" or null. */
  continueLabel: string | null;
  showLoadMore: boolean;
}

/** A hidden root or project recoverable from Details. */
export interface ToolbarHiddenEntry {
  key: string;
  label: string;
  kind: "root" | "project";
}

interface ArchitectureToolbarProps {
  // Module filter.
  modules: CodeModuleOption[];
  moduleKey: string | null;
  onModuleChange: (key: string | null) => void;
  /** Slim line under the row: criterion, or why no groupings exist. */
  moduleLine: string | null;
  /** Appended when module results may be incomplete. */
  modulePartial: string | null;
  showExternal: boolean;
  onToggleExternal: () => void;
  /** "20 of 34 shown", or null. */
  externalInfo: string | null;
  groupBy: "symbols" | "files";
  onGroupByChange: (mode: "symbols" | "files") => void;
  // Search.
  query: string;
  onQueryChange: (query: string) => void;
  // Layer menu.
  layersOn: Record<ArchLayer, boolean>;
  onToggleLayer: (layer: ArchLayer) => void;
  showTests: boolean;
  onToggleTests: () => void;
  showConfig: boolean;
  onToggleConfig: () => void;
  /** Symbols/files hidden by layer/test/config toggles, all boards. */
  hiddenByFilters: number;
  hiddenByFiltersTitle: string | null;
  // Edge menu.
  edgeOpts: BoardEdgeOpts;
  onToggleIncoming: () => void;
  onToggleOutgoing: () => void;
  onDepthChange: (depth: 1 | 2) => void;
  // Details panel.
  detailsBadge: string | null;
  detailsOpen: boolean;
  onOpenDetails: () => void;
  onCloseDetails: () => void;
  detailRows: ToolbarDetailRow[];
  hiddenEntries: ToolbarHiddenEntry[];
  onDetailRetry: (key: string) => void;
  onDetailCancel: (key: string) => void;
  onDetailContinue: (key: string) => void;
  onDetailLoadMore: (key: string) => void;
  onShowHidden: (entry: ToolbarHiddenEntry) => void;
  onShowAllHidden: () => void;
}

function DropMenu({
  label,
  badge,
  title,
  children,
}: {
  label: string;
  badge: string | null;
  title: string | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="archmap-menu">
      <button
        type="button"
        className="secondary small"
        aria-expanded={open}
        aria-label={badge === null ? label : `${label}, ${badge}`}
        title={title ?? undefined}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        {label}
        {badge !== null ? ` · ${badge}` : ""} {open ? "▾" : "▸"}
      </button>
      {open && (
        <>
          <div
            className="archmap-backdrop"
            aria-hidden="true"
            onMouseDown={() => setOpen(false)}
          />
          <div
            className="archmap-popover"
            role="dialog"
            aria-label={`${label} menu`}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}

export function ArchitectureToolbar({
  modules,
  moduleKey,
  onModuleChange,
  moduleLine,
  modulePartial,
  showExternal,
  onToggleExternal,
  externalInfo,
  groupBy,
  onGroupByChange,
  query,
  onQueryChange,
  layersOn,
  onToggleLayer,
  showTests,
  onToggleTests,
  showConfig,
  onToggleConfig,
  hiddenByFilters,
  hiddenByFiltersTitle,
  edgeOpts,
  onToggleIncoming,
  onToggleOutgoing,
  onDepthChange,
  detailsBadge,
  detailsOpen,
  onOpenDetails,
  onCloseDetails,
  detailRows,
  hiddenEntries,
  onDetailRetry,
  onDetailCancel,
  onDetailContinue,
  onDetailLoadMore,
  onShowHidden,
  onShowAllHidden,
}: ArchitectureToolbarProps) {
  const layersOff = ARCH_LAYERS.some((def) => !layersOn[def.id]) || !showTests || !showConfig;
  const layersBadge =
    hiddenByFilters > 0
      ? `${hiddenByFilters} hidden`
      : layersOff
        ? "filtered"
        : null;
  const declared = modules.filter((option) => option.kind === "declared");
  const manual = modules.filter((option) => option.kind === "manual");
  const directory = modules.filter((option) => option.kind === "directory");
  return (
    <div className="architecture-toolbar">
      <div className="archmap-toolbar" role="group" aria-label="Canvas controls">
        <label className="archmap-module">
          Module{" "}
          <select
            aria-label="Module filter"
            value={moduleKey ?? "all"}
            onChange={(event) => {
              const value = event.target.value;
              onModuleChange(value === "all" ? null : value);
            }}
          >
            <option value="all">All modules</option>
            {declared.length > 0 && (
              <optgroup label="Declared modules">
                {declared.map((option) => (
                  <option key={option.key} value={option.key} title={option.criterion}>
                    {option.label} ({option.symbols})
                  </option>
                ))}
              </optgroup>
            )}
            {manual.length > 0 && (
              <optgroup label="Linked modules">
                {manual.map((option) => (
                  <option key={option.key} value={option.key} title={option.criterion}>
                    {option.label} ({option.symbols})
                  </option>
                ))}
              </optgroup>
            )}
            {directory.length > 0 && (
              <optgroup label="Directory groups">
                {directory.map((option) => (
                  <option key={option.key} value={option.key} title={option.criterion}>
                    {option.label} ({option.symbols})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {moduleKey !== null && (
          <label
            className="archmap-layer"
            title={
              groupBy === "symbols"
                ? "Show direct dependencies outside the module as compact reference cards."
                : "External references show on the Symbols board."
            }
          >
            <input
              type="checkbox"
              checked={showExternal}
              disabled={groupBy !== "symbols"}
              onChange={onToggleExternal}
            />
            External refs
          </label>
        )}
        <input
          type="search"
          className="archmap-search"
          placeholder="Filter files, symbols, members…"
          aria-label="Filter boards"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <DropMenu label="Layers" badge={layersBadge} title={hiddenByFiltersTitle}>
          <div role="group" aria-label="Layer filters">
            {ARCH_LAYERS.map((def) => (
              <label key={def.id} className="archmap-layer" title={def.description}>
                <input
                  type="checkbox"
                  checked={layersOn[def.id]}
                  onChange={() => onToggleLayer(def.id)}
                />
                {def.label}
              </label>
            ))}
          </div>
          <div role="group" aria-label="File kind filters">
            <label
              className="archmap-layer"
              title="Show test files (.spec./.test.). They stay unassigned by convention."
            >
              <input type="checkbox" checked={showTests} onChange={onToggleTests} />
              Tests
            </label>
            <label
              className="archmap-layer"
              title="Show configuration files (*.config.ts, environments/)."
            >
              <input type="checkbox" checked={showConfig} onChange={onToggleConfig} />
              Config
            </label>
          </div>
        </DropMenu>
        <DropMenu label="Edges" badge={null} title="Which connections draw around the selection.">
          <div role="group" aria-label="Shown connections">
            <label className="archmap-layer" title="Draw edges arriving at the selection.">
              <input type="checkbox" checked={edgeOpts.incoming} onChange={onToggleIncoming} />
              Incoming
            </label>
            <label className="archmap-layer" title="Draw edges leaving the selection.">
              <input type="checkbox" checked={edgeOpts.outgoing} onChange={onToggleOutgoing} />
              Outgoing
            </label>
            <span className="hint" id="arch-depth-label">
              Depth
            </span>
            <div role="group" aria-labelledby="arch-depth-label" className="archmap-zoomctl">
              <button
                type="button"
                className={`secondary small${edgeOpts.depth === 1 ? " active" : ""}`}
                aria-pressed={edgeOpts.depth === 1}
                title="Direct connections only."
                onClick={() => onDepthChange(1)}
              >
                1
              </button>
              <button
                type="button"
                className={`secondary small${edgeOpts.depth === 2 ? " active" : ""}`}
                aria-pressed={edgeOpts.depth === 2}
                title="Direct connections plus one context hop."
                onClick={() => onDepthChange(2)}
              >
                2
              </button>
            </div>
          </div>
          <EdgeLegend />
        </DropMenu>
        <div className="archmap-zoomctl" role="group" aria-label="Card grouping">
          <button
            type="button"
            className={`secondary small${groupBy === "symbols" ? " active" : ""}`}
            aria-pressed={groupBy === "symbols"}
            title="One card per class, interface, or free function."
            onClick={() => onGroupByChange("symbols")}
          >
            Symbols
          </button>
          <button
            type="button"
            className={`secondary small${groupBy === "files" ? " active" : ""}`}
            aria-pressed={groupBy === "files"}
            title="One card per file, with its symbols inside."
            onClick={() => onGroupByChange("files")}
          >
            Files
          </button>
        </div>
        <button
          type="button"
          className="secondary small"
          aria-expanded={detailsOpen}
          onClick={() => (detailsOpen ? onCloseDetails() : onOpenDetails())}
        >
          Details{detailsBadge !== null ? ` (${detailsBadge})` : ""}
        </button>
      </div>
      {moduleLine !== null && (
        <p className="hint archmap-module-line" role="status">
          {moduleLine}
          {modulePartial !== null ? ` · ${modulePartial}` : ""}
          {externalInfo !== null ? ` · ${externalInfo}` : ""}
        </p>
      )}
      {detailsOpen && (
        <>
          <div className="archmap-backdrop" aria-hidden="true" onMouseDown={onCloseDetails} />
          <div
            className="archmap-popover archmap-details"
            role="dialog"
            aria-label="Analysis details"
            onKeyDown={(event) => {
              if (event.key === "Escape") onCloseDetails();
            }}
          >
            <div className="archmap-details-head">
              <strong>Analysis details</strong>
              <button
                type="button"
                className="secondary small"
                aria-label="Close analysis details"
                onClick={onCloseDetails}
              >
                ×
              </button>
            </div>
            <DetailRowsPanel
              detailRows={detailRows}
              onDetailRetry={onDetailRetry}
              onDetailCancel={onDetailCancel}
              onDetailContinue={onDetailContinue}
              onDetailLoadMore={onDetailLoadMore}
            />
            {hiddenEntries.length > 0 && (
              <section aria-label="Hidden from view">
                <p className="hint">Hidden from view</p>
                <ul className="archmap-list">
                  {hiddenEntries.map((entry) => (
                    <li key={`${entry.kind}:${entry.key}`}>
                      <span>{entry.label}</span>{" "}
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => onShowHidden(entry)}
                      >
                        Show
                      </button>
                    </li>
                  ))}
                </ul>
                {hiddenEntries.length > 1 && (
                  <button type="button" className="secondary small" onClick={onShowAllHidden}>
                    Show all
                  </button>
                )}
              </section>
            )}
            <DetailEmpty detailRows={detailRows} hiddenEntries={hiddenEntries} />
          </div>
        </>
      )}
    </div>
  );
}

function DetailRowsPanel({
  detailRows,
  onDetailRetry,
  onDetailCancel,
  onDetailContinue,
  onDetailLoadMore,
}: {
  detailRows: ToolbarDetailRow[];
  onDetailRetry: (key: string) => void;
  onDetailCancel: (key: string) => void;
  onDetailContinue: (key: string) => void;
  onDetailLoadMore: (key: string) => void;
}) {
  if (detailRows.length === 0) return null;
  return (
    <>
      {detailRows.map((row) => (
        <section key={row.key} aria-label={`Details of ${row.title}`}>
          <p>
            <strong>{row.title}</strong> <span className="hint">{row.status}</span>
          </p>
          {row.notes.length > 0 && (
            <ul className="archmap-list">
              {row.notes.map((note, index) => (
                // Notes derive from ordered state; position disambiguates repeats.
                // eslint-disable-next-line react/no-array-index-key
                <li key={`${note}:${index}`}>
                  <span className="hint">{note}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="button-row">
            {row.showRetry && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onDetailRetry(row.key)}
              >
                Retry
              </button>
            )}
            {row.showCancel && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onDetailCancel(row.key)}
              >
                Cancel
              </button>
            )}
            {row.continueLabel !== null && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onDetailContinue(row.key)}
              >
                {row.continueLabel}
              </button>
            )}
            {row.showLoadMore && (
              <button
                type="button"
                className="secondary small"
                onClick={() => onDetailLoadMore(row.key)}
              >
                Load more files
              </button>
            )}
          </div>
        </section>
      ))}
    </>
  );
}

function DetailEmpty({
  detailRows,
  hiddenEntries,
}: {
  detailRows: ToolbarDetailRow[];
  hiddenEntries: ToolbarHiddenEntry[];
}) {
  if (detailRows.length > 0 || hiddenEntries.length > 0) return null;
  return <p className="hint">Nothing to report.</p>;
}

function EdgeLegend() {
  return (
    <div className="arch-legend" role="group" aria-label="Connection legend">
      {LEGEND.map((entry) => (
        <span key={entry.kind} className="arch-legend-item" title={entry.hint}>
          <svg width="26" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="25" y2="4" className={`arch-edge kind-${entry.kind}`} />
          </svg>
          {entry.kind}
        </span>
      ))}
      <span className="hint">around the selection only</span>
    </div>
  );
}
