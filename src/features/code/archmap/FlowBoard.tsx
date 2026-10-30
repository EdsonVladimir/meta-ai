// Flow board: one column per project layer and hop, cards showing
// chain members only, row-to-row edges with call order, and pending
// boxes with dashed links. Same SVG layer order as the board:
// panels, edges, cards, edge labels.
import type { ReactNode } from "react";
import { countLabel, KIND_BADGE } from "./ArchMapBoard";
import { ARCH_LAYER_BY_ID } from "./archLayers";
import { MemberRow } from "./MemberRow";
import { languageBadge, memberRole } from "./memberRoles";
import {
  ARCH_CARD_W,
  ARCH_COL_PAD_X,
  ARCH_COL_W,
  edgePath,
  type CardPos,
} from "./boardLayout";
import {
  hiddenMethodCount,
  memberSignalLines,
  pendingBoxKey,
  type FlowLayout,
} from "./flowLayout";
import type { FlowChange, FlowGraph, FlowHttpNode, FlowNode, FlowPending } from "./flowModel";

export interface FlowBoardProps {
  graph: FlowGraph;
  layout: FlowLayout;
  selected: { nodeId: string; member: string | null } | null;
  onSelect: (selection: { nodeId: string; member: string | null } | null) => void;
}

/** Row center for a member, card center otherwise. Null when the card is missing. */
function rowAnchor(layout: FlowLayout, nodeId: string, member: string | null): number | null {
  const card = layout.cards.get(nodeId);
  if (card === undefined) return null;
  if (member !== null) {
    const y = layout.rowY.get(`${nodeId}::${member}`);
    if (y !== undefined) return y;
  }
  return card.y + card.h / 2;
}

function anchorBox(card: CardPos, y: number): CardPos {
  return { x: card.x, y, w: card.w, h: 0 };
}

/** Path endpoints of a row-to-row edge, mirroring edgePath's anchoring. */
function edgeEnds(from: CardPos, to: CardPos): { x1: number; y1: number; x2: number; y2: number } {
  if (from.x === to.x) {
    const x = from.x + from.w / 2;
    return { x1: x, y1: from.y, x2: x, y2: to.y };
  }
  return from.x < to.x
    ? { x1: from.x + from.w, y1: from.y, x2: to.x, y2: to.y }
    : { x1: from.x, y1: from.y, x2: to.x + to.w, y2: to.y };
}

interface DrawnEdge {
  id: string;
  d: string;
  label: string | null;
  labelX: number;
  labelY: number;
  pending: boolean;
  title: string;
}

function drawEdges(graph: FlowGraph, layout: FlowLayout): DrawnEdge[] {
  const geometry = (
    fromId: string,
    fromMember: string | null,
    toId: string,
    toMember: string | null,
  ): { d: string; x1: number; y1: number; x2: number; y2: number } | null => {
    const fromCard = layout.cards.get(fromId);
    const toCard = layout.cards.get(toId);
    if (fromCard === undefined || toCard === undefined) return null;
    const fromY = rowAnchor(layout, fromId, fromMember) ?? fromCard.y + fromCard.h / 2;
    const toY = rowAnchor(layout, toId, toMember) ?? toCard.y + toCard.h / 2;
    const from = anchorBox(fromCard, fromY);
    const to = anchorBox(toCard, toY);
    return { d: edgePath(from, to), ...edgeEnds(from, to) };
  };
  const drawn: DrawnEdge[] = [];
  for (const edge of graph.edges) {
    const geo = geometry(edge.fromNode, edge.fromMember, edge.toNode, edge.toMember);
    if (geo === null) continue;
    drawn.push({
      id: edge.id,
      d: geo.d,
      label: `${edge.order + 1}`,
      labelX: geo.x1 + (geo.x2 - geo.x1) * 0.12,
      labelY: geo.y1 + (geo.y2 - geo.y1) * 0.12 - 8,
      pending: false,
      title: `${edge.kind} edge. ${edge.evidence}`,
    });
  }
  graph.pending.forEach((pending, index) => {
    const geo = geometry(pending.fromNode, pending.fromMember, pendingBoxKey(index), null);
    if (geo === null) return;
    drawn.push({
      id: `pending-edge:${index}`,
      d: geo.d,
      label: null,
      labelX: 0,
      labelY: 0,
      pending: true,
      title: `${pending.kind}: ${pending.label}. ${pending.evidence}`,
    });
  });
  return drawn;
}

function ChainRow({
  node,
  name,
  selected,
  onSelect,
}: {
  node: FlowNode;
  name: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const member = node.symbol.members.find((entry) => entry.name === name);
  const signals = memberSignalLines(node, name);
  return (
    <>
      {member === undefined ? (
        <div className="archboard-member-slot">
          <div className="archboard-member mrole-method" title={name}>
            <span className="archboard-mem-text">
              <span className="archboard-mem-name">{name}</span>
            </span>
          </div>
        </div>
      ) : (
        <MemberRow
          member={member}
          role={memberRole(member, node.symbol)}
          selected={selected}
          onSelect={onSelect}
          listItem
          change={node.memberChanges?.[name]}
        />
      )}
      {signals.map((line, index) => (
        <div key={`${line}:${index}`} className="flowboard-sig">
          {line}
        </div>
      ))}
    </>
  );
}

function FlowNodeCard({
  node,
  height,
  repositoryMethods,
  selected,
  onSelect,
}: {
  node: FlowNode;
  height: number;
  /** Repository methods reaching this entity, when any. */
  repositoryMethods: string[];
  selected: { nodeId: string; member: string | null } | null;
  onSelect: FlowBoardProps["onSelect"];
}) {
  const { symbol } = node;
  const base = symbol.rel.split("/").pop() ?? symbol.rel;
  const hidden = hiddenMethodCount(node);
  const role = ARCH_LAYER_BY_ID[node.layer].label;
  const language = languageBadge(symbol.rel);
  const decorators = (symbol.decorators ?? []).map((name) => `@${name}`).join(" ");
  const isSelected = selected?.nodeId === node.id;
  const proposed = node.change !== undefined;
  return (
    <div
      className={`archboard-card role-${node.layer}${isSelected ? " selected" : ""}${proposed ? " proposed" : ""}`}
      style={{ width: ARCH_CARD_W, height }}
    >
      <button
        type="button"
        className="archboard-card-head"
        title={`${symbol.kind} ${symbol.name}${decorators === "" ? "" : ` ${decorators}`} — ${role}, ${language}\n${symbol.rel}`}
        aria-label={`${symbol.name}, ${symbol.kind}, ${countLabel(node.members.length, "chain member", "chain members")}`}
        aria-pressed={isSelected}
        onClick={() => onSelect({ nodeId: node.id, member: null })}
      >
        <span className={`archboard-kind kind-${symbol.kind}`} aria-hidden="true">
          {KIND_BADGE[symbol.kind] ?? "?"}
        </span>
        <span className="archboard-card-name">{symbol.name}</span>
        {proposed && (
          <span className="archboard-badge flowboard-muse" title="Proposed by Muse">
            Muse
          </span>
        )}
        {node.change !== undefined && (
          <span
            className="archboard-badge flowboard-muse"
            title={CHANGE_TITLE[node.change]}
          >
            {CHANGE_BADGE[node.change]}
          </span>
        )}
        <span className={`archboard-lang lang-${language.toLowerCase()}`}>{language}</span>
      </button>
      <div className="archboard-card-sub" title={symbol.rel}>
        <span className="archboard-chip project">{node.projectLabel}</span>
        {decorators !== "" && <span className="archboard-decorator">{decorators}</span>}
        <span className="archboard-file">{base}</span>
      </div>
      <div className="archboard-card-meta">
        <span className="archboard-count">
          {repositoryMethods.length > 0
            ? `repository: ${repositoryMethods.join(", ")}`
            : countLabel(node.members.length, "chain member", "chain members")}
        </span>
      </div>
      {node.members.length > 0 && (
        <div className="archboard-member-list" role="list" aria-label={`Chain members of ${symbol.name}`}>
          {node.members.map((name) => (
            <ChainRow
              key={name}
              node={node}
              name={name}
              selected={selected?.nodeId === node.id && selected.member === name}
              onSelect={() => onSelect({ nodeId: node.id, member: name })}
            />
          ))}
        </div>
      )}
      {hidden > 0 && (
        <div className="flowboard-more">{`+${countLabel(hidden, "method", "methods")}`}</div>
      )}
    </div>
  );
}

function HttpCard({ http, height }: { http: FlowHttpNode; height: number }) {
  const meta = [
    http.interceptors.length > 0
      ? `interceptors: ${http.interceptors.join(", ")}`
      : "no interceptors",
    http.guards.length > 0 ? `guards: ${http.guards.join(", ")}` : "no guards",
  ];
  return (
    <div className="archboard-card role-unassigned" style={{ width: ARCH_CARD_W, height }}>
      <div className="archboard-card-head" title={http.url ?? "(unknown url)"}>
        <span className="archboard-card-name">{`${http.verb} ${http.url ?? "(unknown url)"}`}</span>
      </div>
      <div className="archboard-card-sub">
        <span className="archboard-file">{`via ${http.via}`}</span>
      </div>
      <div className="archboard-card-meta" title={meta.join(" · ")}>
        {meta.map((line) => (
          <span key={line} className="archboard-count">
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

const CHANGE_BADGE: Record<FlowChange, string> = { added: "A", modified: "M", removed: "R" };

const CHANGE_TITLE: Record<FlowChange, string> = {
  added: "Added by the proposal",
  modified: "Modified by the proposal",
  removed: "Removed by the proposal",
};

const PENDING_TITLE: Record<FlowPending["kind"], string> = {
  unresolved: "Unresolved",
  ambiguous: "Ambiguous",
  "no-destination": "No destination",
  cycle: "Cycle",
};

function PendingBox({ pending, height }: { pending: FlowPending; height: number }) {
  return (
    <div className="archboard-card role-unassigned" style={{ width: ARCH_CARD_W, height }}>
      <div className="archboard-card-head" title={pending.evidence}>
        <span className="archboard-card-name">{PENDING_TITLE[pending.kind]}</span>
      </div>
      <div className="archboard-card-meta" title={pending.label}>
        <span className="archboard-count">{pending.label}</span>
      </div>
    </div>
  );
}

function repositoryMethodsOf(graph: FlowGraph, nodeId: string): string[] {
  const methods = graph.edges
    .filter((edge) => edge.kind === "entity" && edge.toNode === nodeId)
    .map((edge) => edge.label)
    .filter((label): label is string => label !== undefined);
  return [...new Set(methods)];
}

export function FlowBoard({ graph, layout, selected, onSelect }: FlowBoardProps): ReactNode {
  const drawn = drawEdges(graph, layout);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const httpById = new Map(graph.httpNodes.map((http) => [http.id, http]));
  const pendingByBox = new Map(graph.pending.map((pending, index) => [pendingBoxKey(index), pending]));
  return (
    <div
      className="archboard"
      style={{ width: layout.width, height: layout.height }}
      role="group"
      aria-label="Flow board"
    >
      {layout.columns.map((column) => (
        <div
          key={column.key}
          className="archboard-col-bg"
          style={{ left: column.x, width: column.w, height: layout.height }}
          aria-hidden="true"
        />
      ))}
      <svg className="archboard-edges" width={layout.width} height={layout.height} aria-hidden="true">
        <defs>
          <marker
            id="flow-arrow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" className="flow-arrow" />
          </marker>
        </defs>
        {drawn.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            className={edge.pending ? "flow-edge pending" : "flow-edge"}
            markerEnd="url(#flow-arrow)"
          >
            <title>{edge.title}</title>
          </path>
        ))}
      </svg>
      <div className="archboard-cols">
        {layout.columns.map((column) => {
          const cards = [...layout.cards.entries()]
            .filter(([, pos]) => pos.x === column.x + ARCH_COL_PAD_X)
            .sort((a, b) => a[1].y - b[1].y);
          return (
            <div key={column.key} className="archboard-col" style={{ width: ARCH_COL_W }}>
              <div
                className="archboard-col-head"
                role="heading"
                aria-level={3}
                aria-label={`${column.label} (${countLabel(cards.length, "card", "cards")})`}
              >
                <span className="archboard-col-text">
                  <span className="archboard-col-title">{column.label}</span>
                  <span className="archboard-col-count">
                    {countLabel(cards.length, "card", "cards")}
                  </span>
                </span>
              </div>
              {cards.map(([id, pos]) => {
                const node = nodeById.get(id);
                if (node !== undefined) {
                  return (
                    <FlowNodeCard
                      key={id}
                      node={node}
                      height={pos.h}
                      repositoryMethods={repositoryMethodsOf(graph, node.id)}
                      selected={selected}
                      onSelect={onSelect}
                    />
                  );
                }
                const http = httpById.get(id);
                if (http !== undefined) return <HttpCard key={id} http={http} height={pos.h} />;
                const pending = pendingByBox.get(id);
                if (pending !== undefined) {
                  return <PendingBox key={id} pending={pending} height={pos.h} />;
                }
                return null;
              })}
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
        {drawn
          .filter((edge) => edge.label !== null)
          .map((edge) => (
            <text
              key={edge.id}
              x={edge.labelX}
              y={edge.labelY}
              textAnchor="middle"
              dominantBaseline="middle"
              className="arch-edge-label"
            >
              {edge.label}
            </text>
          ))}
      </svg>
    </div>
  );
}
