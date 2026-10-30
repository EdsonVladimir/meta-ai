// Symbol board: one card per class, interface, enum, component or
// free function, grouped by the symbol's own layer. The card accent
// carries the architectural role; selection is a separate neutral
// ring. Members open by default as one row each and the card grows
// to hold them all (layout and CSS share the row constants); edges
// link resolved symbol relations only, around the selection.
import { ARCH_LAYER_BY_ID, type ArchLayer } from "./archLayers";
import type { ArchMapNode, ArchMapSymbolEdge } from "./archModel";
import { BoardColumnHead, BoardColumnPanels, KIND_BADGE, countLabel } from "./ArchMapBoard";
import { MemberRow } from "./MemberRow";
import { languageBadge, memberCounts, memberRole } from "./memberRoles";
import {
  ARCH_CARD_W,
  ARCH_COL_W,
  edgeMidpoint,
  edgePath,
  visibleSymbolEdges,
  type BoardEdgeOpts,
  type BoardLayout,
  type SymbolColumn,
} from "./boardLayout";

export interface ArchSymbolBoardProps {
  columns: SymbolColumn[];
  /** Geometry from `layoutSymbolBoard(columns, collapsed, referenceIds)` (same pass). */
  layout: BoardLayout;
  edges: ArchMapSymbolEdge[];
  /** Symbol ids currently visible (after layer/search filters). */
  visibleIds: Set<string>;
  selectedId: string | null;
  edgeOpts: BoardEdgeOpts;
  /** Symbols with their member list collapsed (open by default). */
  collapsed: Set<string>;
  /** External references: compact cards, head + meta only, never members. */
  referenceIds?: Set<string>;
  /** Short note for reference cards, e.g. which module they sit outside of. */
  referenceNote?: string | null;
  /** Project (or root) the board belongs to, shown as secondary info. */
  projectLabel?: string | null;
  /** Selected member row (index in the selected symbol's members). */
  selectedMember?: number | null;
  /** Selects one member row; the inspector shows its full detail. */
  onSelectMember?: (symbolId: string, index: number) => void;
  onToggleMembers: (symbolId: string) => void;
  onSelect: (id: string | null) => void;
}

function edgeKinds(edge: ArchMapSymbolEdge): string {
  return edge.kinds.map((k) => (k.count > 1 ? `${k.kind}×${k.count}` : k.kind)).join(", ");
}

export function ArchSymbolBoard({
  columns,
  layout,
  edges,
  visibleIds,
  selectedId,
  edgeOpts,
  collapsed,
  referenceIds,
  referenceNote,
  projectLabel,
  selectedMember,
  onSelectMember,
  onToggleMembers,
  onSelect,
}: ArchSymbolBoardProps) {
  const references = referenceIds ?? new Set<string>();
  const shown = visibleSymbolEdges(edges, visibleIds, selectedId, edgeOpts);
  return (
    <div
      className="archboard"
      style={{ width: layout.width, height: layout.height }}
      role="group"
      aria-label="Architecture board"
    >
      <BoardColumnPanels layout={layout} layers={columns.map((column) => column.layer)} />
      <svg className="archboard-edges" width={layout.width} height={layout.height} aria-hidden="true">
        {shown.map((edge) => {
          const fromPos = layout.cards.get(edge.from) ?? null;
          const toPos = layout.cards.get(edge.to) ?? null;
          if (fromPos === null || toPos === null) return null;
          const kinds = edgeKinds(edge);
          return (
            <g key={edge.id}>
              <path d={edgePath(fromPos, toPos)} className={`arch-edge kind-${edge.kinds[0].kind}`}>
                <title>{`Symbol relation (${kinds}). ${edge.evidence}`}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <div className="archboard-cols">
        {columns.map((column) => {
          const files = new Set(column.nodes.map((entry) => `${entry.rootId}::${entry.rel}`)).size;
          return (
            <div key={column.layer} className="archboard-col" style={{ width: ARCH_COL_W }}>
              <BoardColumnHead
                layer={column.layer}
                primary={countLabel(column.nodes.length, "symbol", "symbols")}
                counts={`${countLabel(column.nodes.length, "symbol", "symbols")} · ${countLabel(files, "file", "files")}`}
              />
              {column.nodes.map((node) => (
                <SymbolCard
                  key={node.id}
                  node={node}
                  layer={column.layer}
                  projectLabel={projectLabel ?? null}
                  selectedMember={node.id === selectedId ? (selectedMember ?? null) : null}
                  onSelectMember={
                    onSelectMember === undefined
                      ? undefined
                      : (index) => onSelectMember(node.id, index)
                  }
                  height={layout.cards.get(node.id)?.h ?? 0}
                  selected={node.id === selectedId}
                  collapsed={collapsed.has(node.id)}
                  reference={references.has(node.id)}
                  referenceNote={referenceNote ?? null}
                  onToggleMembers={() => onToggleMembers(node.id)}
                  onSelect={() => onSelect(node.id === selectedId ? null : node.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <svg
        className="archboard-edge-labels"
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
      >
        {shown.map((edge) => {
          const fromPos = layout.cards.get(edge.from) ?? null;
          const toPos = layout.cards.get(edge.to) ?? null;
          if (fromPos === null || toPos === null) return null;
          const mid = edgeMidpoint(fromPos, toPos);
          return (
            <text
              key={edge.id}
              x={mid.x}
              y={mid.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="arch-edge-label"
            >
              {edgeKinds(edge)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function countBadges(node: ArchMapNode): string[] {
  const counts = memberCounts(node.symbol.members);
  const capped = node.symbol.membersTruncated ? "+" : "";
  const out: string[] = [];
  if (counts.methods > 0) out.push(`${countLabel(counts.methods, "method", "methods")}${capped}`);
  if (counts.properties > 0) {
    out.push(`${countLabel(counts.properties, "property", "properties")}${capped}`);
  }
  if (counts.variants > 0) out.push(`${countLabel(counts.variants, "variant", "variants")}${capped}`);
  if (out.length === 0) out.push("no members");
  return out;
}

function SymbolCard({
  node,
  layer,
  height,
  selected,
  collapsed,
  reference,
  referenceNote,
  projectLabel,
  selectedMember,
  onSelectMember,
  onToggleMembers,
  onSelect,
}: {
  node: ArchMapNode;
  /** Effective layer (manual overrides applied): drives the role accent. */
  layer: ArchLayer;
  /** Content-derived height from the same layout pass. */
  height: number;
  selected: boolean;
  collapsed: boolean;
  reference: boolean;
  referenceNote: string | null;
  projectLabel: string | null;
  selectedMember: number | null;
  onSelectMember: ((index: number) => void) | undefined;
  onToggleMembers: () => void;
  onSelect: () => void;
}) {
  const { symbol } = node;
  const base = node.rel.split("/").pop() ?? node.rel;
  const count = symbol.members.length;
  const role = ARCH_LAYER_BY_ID[layer].label;
  const language = languageBadge(node.rel);
  const counts = countBadges(node);
  const toggleLabel =
    count === 0
      ? null
      : `${collapsed ? "Show" : "Hide"} ${countLabel(count, "member", "members")}${symbol.membersTruncated ? " (list capped)" : ""}`;
  const headLabel = reference
    ? `${symbol.name}, ${symbol.kind}, outside the module`
    : `${symbol.name}, ${symbol.kind}, ${countLabel(count, "member", "members")}`;
  const decorators = symbol.decorators.map((name) => `@${name}`).join(" ");
  return (
    <div
      className={`archboard-card role-${layer}${selected ? " selected" : ""}${reference ? " reference" : ""}`}
      style={{ width: ARCH_CARD_W, height }}
      data-role={role}
    >
      <button
        type="button"
        className="archboard-card-head"
        title={`${symbol.kind} ${symbol.name}${decorators === "" ? "" : ` ${decorators}`} — ${role}, ${language}\n${node.rel}${reference ? " (outside the module)" : ""}`}
        aria-label={headLabel}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className={`archboard-kind kind-${symbol.kind}`} aria-hidden="true">
          {KIND_BADGE[symbol.kind] ?? "?"}
        </span>
        <span className="archboard-card-name">{symbol.name}</span>
        <span className={`archboard-lang lang-${language.toLowerCase()}`}>{language}</span>
      </button>
      <div className="archboard-card-sub" title={`${node.rel}\n${role}: ${node.layerReason}`}>
        {projectLabel !== null && <span className="archboard-chip project">{projectLabel}</span>}
        {decorators !== "" && <span className="archboard-decorator">{decorators}</span>}
        <span className="archboard-file">{base}</span>
      </div>
      <div className="archboard-card-meta" title={counts.join(", ")}>
        {reference ? (
          <span className="archboard-badge ref" title={referenceNote ?? undefined}>
            reference
          </span>
        ) : (
          counts.map((label) => (
            <span key={label} className="archboard-count">
              {label}
            </span>
          ))
        )}
        {!reference && symbol.unresolved.length > 0 && (
          <span className="archboard-badge warn">
            <span aria-hidden="true">⚠ </span>
            {countLabel(symbol.unresolved.length, "unresolved", "unresolved")}
            {symbol.unresolvedTruncated ? "+" : ""}
          </span>
        )}
      </div>
      {!reference && count > 0 && !collapsed && (
        <div className="archboard-member-list" role="list" aria-label={`Members of ${symbol.name}`}>
          {symbol.members.map((member, index) => (
            <MemberRow
              key={`${member.kind}:${member.name}:${index}`}
              member={member}
              role={memberRole(member, symbol)}
              hook={symbol.lifecycle?.find((hook) => hook.name === member.name) ?? null}
              selected={selectedMember === index}
              onSelect={onSelectMember === undefined ? undefined : () => onSelectMember(index)}
              listItem
            />
          ))}
        </div>
      )}
      {!reference && toggleLabel !== null && (
        <button
          type="button"
          className="archboard-more"
          aria-expanded={!collapsed}
          onClick={onToggleMembers}
        >
          {toggleLabel}
        </button>
      )}
    </div>
  );
}
