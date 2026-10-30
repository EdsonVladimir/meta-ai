// Column board: layers as left-to-right columns with sticky headers,
// file cards stacked vertically with content-derived heights, and an
// SVG edge overlay drawn from the same layout pass (one coordinate
// system, no DOM measuring, identical in tests and in the app).
// Edges only ever surround the selected card.
import { RuthFileIcon } from "../../../components/icons";
import { ARCH_LAYER_BY_ID, type ArchLayer } from "./archLayers";
import type { ArchMapEdge, ArchMapFile, ArchMapSymbol } from "./archModel";
import {
  ARCH_CARD_W,
  ARCH_COL_W,
  ARCH_SYMBOLS_SHOWN,
  edgeMidpoint,
  edgePath,
  fileKey,
  shownSymbols,
  visibleBoardEdges,
  type BoardColumn,
  type BoardEdgeOpts,
  type BoardExpansion,
  type BoardLayout,
} from "./boardLayout";
import { isConfigFile, isTestFile } from "./mapFilter";
import { MemberRow } from "./MemberRow";
import { languageBadge, memberLabel, memberRole } from "./memberRoles";

export { memberLabel };

export const KIND_BADGE: Record<string, string> = {
  class: "C",
  interface: "I",
  struct: "S",
  enum: "E",
  trait: "T",
  function: "f",
  component: "◈",
};

/** "1 symbol" / "3 files": layer counters always name their unit. */
export function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/**
 * Column panels drawn under the edge overlay, so connections stay
 * visible between cards inside a column and behind every card.
 */
export function BoardColumnPanels({ layout, layers }: { layout: BoardLayout; layers: ArchLayer[] }) {
  return (
    <>
      {layout.columns.map((column, index) => (
        <div
          key={layers[index] ?? index}
          className={`archboard-col-bg role-${layers[index] ?? "unassigned"}`}
          style={{ left: column.x, width: column.w, height: layout.height }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * Column header: role tile, layer name and what the column holds.
 * A heading named "Layer (count)" for assistive tech and queries.
 */
export function BoardColumnHead({
  layer,
  primary,
  counts,
}: {
  layer: ArchLayer;
  /** Main unit of the board ("2 files" / "3 symbols"). */
  primary: string;
  counts: string;
}) {
  const def = ARCH_LAYER_BY_ID[layer];
  return (
    <div
      className={`archboard-col-head role-${layer}`}
      title={def.description}
      role="heading"
      aria-level={3}
      aria-label={`${def.label} (${primary})`}
    >
      <span className="archboard-col-badge" aria-hidden="true">
        {def.badge}
      </span>
      <span className="archboard-col-text">
        <span className="archboard-col-title">{def.label}</span>
        <span className="archboard-col-count">{counts}</span>
      </span>
    </div>
  );
}

export interface ArchMapBoardProps {
  columns: BoardColumn[];
  /** Geometry from `layoutBoard(columns, expansion)` (same pass). */
  layout: BoardLayout;
  edges: ArchMapEdge[];
  /** File keys currently visible (after layer/search filters). */
  visibleKeys: Set<string>;
  selectedKey: string | null;
  edgeOpts: BoardEdgeOpts;
  expansion: BoardExpansion;
  onToggleSymbols: (key: string) => void;
  onToggleMembers: (symbolId: string) => void;
  onSelect: (key: string | null) => void;
}

function edgeKinds(edge: ArchMapEdge): string {
  return edge.kinds.map((k) => (k.count > 1 ? `${k.kind}×${k.count}` : k.kind)).join(", ");
}

export function ArchMapBoard({
  columns,
  layout,
  edges,
  visibleKeys,
  selectedKey,
  edgeOpts,
  expansion,
  onToggleSymbols,
  onToggleMembers,
  onSelect,
}: ArchMapBoardProps) {
  const shown = visibleBoardEdges(edges, visibleKeys, selectedKey, edgeOpts);
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
          const fromPos = layout.cards.get(fileKey(edge.rootId, edge.fromRel)) ?? null;
          const toPos = layout.cards.get(fileKey(edge.rootId, edge.toRel)) ?? null;
          if (fromPos === null || toPos === null) return null;
          const kinds = edgeKinds(edge);
          return (
            <g key={edge.id}>
              <path d={edgePath(fromPos, toPos)} className={`arch-edge kind-${edge.kinds[0].kind}`}>
                <title>{`${edge.fromRel} → ${edge.toRel} (${kinds}). ${edge.evidence}`}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <div className="archboard-cols">
        {columns.map((column) => {
          const symbols = column.files.reduce((sum, file) => sum + file.symbols.length, 0);
          return (
            <div key={column.layer} className="archboard-col" style={{ width: ARCH_COL_W }}>
              <BoardColumnHead
                layer={column.layer}
                primary={countLabel(column.files.length, "file", "files")}
                counts={`${countLabel(column.files.length, "file", "files")} · ${countLabel(symbols, "symbol", "symbols")}`}
              />
              {column.files.map((file) => (
                <BoardCard
                  key={fileKey(file.rootId, file.rel)}
                  file={file}
                  height={layout.cards.get(fileKey(file.rootId, file.rel))?.h ?? 0}
                  selected={fileKey(file.rootId, file.rel) === selectedKey}
                  hidden={!visibleKeys.has(fileKey(file.rootId, file.rel))}
                  expansion={expansion}
                  onToggleSymbols={() => onToggleSymbols(fileKey(file.rootId, file.rel))}
                  onToggleMembers={onToggleMembers}
                  onSelect={() =>
                    onSelect(
                      fileKey(file.rootId, file.rel) === selectedKey
                        ? null
                        : fileKey(file.rootId, file.rel),
                    )
                  }
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
          const fromPos = layout.cards.get(fileKey(edge.rootId, edge.fromRel)) ?? null;
          const toPos = layout.cards.get(fileKey(edge.rootId, edge.toRel)) ?? null;
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

interface BoardCardProps {
  file: ArchMapFile;
  /** Content-derived height from the same layout pass. */
  height: number;
  selected: boolean;
  hidden: boolean;
  expansion: BoardExpansion;
  onToggleSymbols: () => void;
  onToggleMembers: (symbolId: string) => void;
  onSelect: () => void;
}

function cardBadges(file: ArchMapFile): string[] {
  const badges = [languageBadge(file.rel)];
  if (isTestFile(file.rel)) badges.push("test");
  if (isConfigFile(file.rel)) badges.push("config");
  badges.push(
    file.symbols.length === 0 ? "no symbols" : countLabel(file.symbols.length, "symbol", "symbols"),
  );
  return badges;
}

function BoardCard({
  file,
  height,
  selected,
  hidden,
  expansion,
  onToggleSymbols,
  onToggleMembers,
  onSelect,
}: BoardCardProps) {
  const { shown, more } = shownSymbols(file, expansion);
  const base = file.rel.split("/").pop() ?? file.rel;
  return (
    <div
      className={`archboard-card role-${file.layer}${selected ? " selected" : ""}${hidden ? " hidden" : ""}`}
      style={{ width: ARCH_CARD_W, height }}
    >
      <button
        type="button"
        className="archboard-card-head"
        title={file.rel}
        aria-label={`${file.rel}, ${file.symbols.length} symbols`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <RuthFileIcon name={base} size={13} />
        <span className="archboard-card-name" title={`${file.rel}\n${file.layerReason}`}>
          {base}
        </span>
      </button>
      <div className="archboard-card-meta" title={`${file.rel}\n${file.layerReason}`}>
        {cardBadges(file).map((badge) => (
          <span key={badge} className="archboard-badge">
            {badge}
          </span>
        ))}
      </div>
      {shown.map((symbol) => (
        <SymbolRow
          key={symbol.id}
          symbol={symbol}
          open={expansion.openMembers.has(symbol.id)}
          onToggle={() => onToggleMembers(symbol.id)}
        />
      ))}
      {more > 0 && (
        <button
          type="button"
          className="archboard-more"
          aria-expanded={false}
          onClick={onToggleSymbols}
        >
          {`Show all ${file.symbols.length} symbols`}
        </button>
      )}
      {more === 0 && file.symbols.length > ARCH_SYMBOLS_SHOWN && (
        <button
          type="button"
          className="archboard-more"
          aria-expanded={true}
          onClick={onToggleSymbols}
        >
          Show less
        </button>
      )}
    </div>
  );
}

function SymbolRow({
  symbol,
  open,
  onToggle,
}: {
  symbol: ArchMapSymbol;
  open: boolean;
  onToggle: () => void;
}) {
  const head = (
    <>
      <span className={`archboard-kind kind-${symbol.kind}`}>
        {KIND_BADGE[symbol.kind] ?? "?"}
      </span>{" "}
      <span className="archboard-symbol-name">{symbol.name}</span>
      <span className="archboard-symbol-count"> ·{symbol.members.length}</span>
      {symbol.decorators.length > 0 && (
        <span className="archboard-decorator"> @{symbol.decorators[0]}</span>
      )}
    </>
  );
  const title =
    symbol.decorators.length > 0
      ? `${symbol.kind} ${symbol.name} (@${symbol.decorators.join(" @")})`
      : `${symbol.kind} ${symbol.name}`;
  return (
    <>
      {symbol.members.length > 0 ? (
        <button
          type="button"
          className="archboard-symbol"
          title={title}
          aria-expanded={open}
          aria-label={`${symbol.name}, ${symbol.members.length} members`}
          onClick={onToggle}
        >
          <span className="archboard-chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          {head}
        </button>
      ) : (
        <div className="archboard-symbol static" title={title}>
          <span className="archboard-chevron" aria-hidden="true" />
          {head}
        </div>
      )}
      {open &&
        symbol.members.map((member) => (
          <MemberRow
            key={`${member.kind}:${member.name}`}
            member={member}
            role={memberRole(member, symbol)}
            hook={symbol.lifecycle?.find((hook) => hook.name === member.name) ?? null}
            indent
          />
        ))}
    </>
  );
}
