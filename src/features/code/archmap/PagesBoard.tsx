// Pages board: columns from the routes down. Selecting a card keeps its
// branch and dims the rest; lines to Shared stay hidden until then, so a
// component used everywhere does not cover the board.
import { useMemo } from "react";
import {
  ARCH_CARD_GAP,
  ARCH_CARD_W,
  ARCH_COL_GAP,
  ARCH_COL_HEAD_H,
  ARCH_COL_BOTTOM_PAD,
  ARCH_COL_PAD_X,
  ARCH_COL_W,
  edgePath,
  type CardPos,
} from "./boardLayout";
import { branchOf, type Composition, type CompositionNode } from "./compositionModel";
import { SourceButtons } from "./SourceButtons";
import type { SourceSymbol } from "./sourceTabs";

const CARD_H = 92;

export function layoutComposition(composition: Composition): {
  cards: Map<string, CardPos>;
  columnX: number[];
  width: number;
  height: number;
} {
  const cards = new Map<string, CardPos>();
  const columnX: number[] = [];
  let tallest = 0;
  composition.columns.forEach((column, index) => {
    const x = index * (ARCH_COL_W + ARCH_COL_GAP);
    columnX.push(x);
    column.nodes.forEach((node, row) => {
      cards.set(node.symbol.id, {
        x: x + ARCH_COL_PAD_X,
        y: ARCH_COL_HEAD_H + row * (CARD_H + ARCH_CARD_GAP),
        w: ARCH_CARD_W,
        h: CARD_H,
      });
    });
    tallest = Math.max(tallest, column.nodes.length);
  });
  return {
    cards,
    columnX,
    width: composition.columns.length * (ARCH_COL_W + ARCH_COL_GAP),
    height:
      ARCH_COL_HEAD_H + tallest * (CARD_H + ARCH_CARD_GAP) + ARCH_COL_BOTTOM_PAD,
  };
}

function countText(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** What a card says about its place, in words that cannot mislead. */
export function cardFacts(node: CompositionNode): string[] {
  const uses = countText(node.children.length, "component", "components");
  if (node.kind === "app") {
    const outlet = node.symbol.component?.template?.uses.some((use) => use.name === "router-outlet");
    return outlet === true ? ["shows the pages"] : [`uses ${uses}`];
  }
  const openedBy = countText(node.routes.length, "route", "routes");
  if (node.kind === "page") {
    return node.parents.length > 0
      ? [`opened by ${openedBy}`, `also in ${countText(node.parents.length, "component", "components")}`]
      : [`opened by ${openedBy}`, `uses ${uses}`];
  }
  if (node.kind === "unused") return [`uses ${uses}`];
  return [`in ${countText(node.parents.length, "component", "components")}`, `uses ${uses}`];
}

function PageCard({
  node,
  pos,
  selected,
  dimmed,
  onSelect,
  onShowFlow,
  onViewSource,
}: {
  node: CompositionNode;
  pos: CardPos;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onShowFlow: (() => void) | undefined;
  onViewSource: ((symbol: SourceSymbol, tabKey: string) => void) | undefined;
}) {
  const { symbol } = node;
  const route = node.routes.length > 0 ? `/${node.routes[0]}` : (symbol.component?.selector ?? "");
  const more = node.routes.length > 1 ? ` +${node.routes.length - 1}` : "";
  const guards = node.guards.length > 0 ? ` · guarded by ${node.guards.join(", ")}` : "";
  return (
    <div
      className={`archboard-card pagesboard-card role-ui${selected ? " selected" : ""}${dimmed ? " dimmed" : ""}`}
      style={{ left: pos.x, top: pos.y, width: pos.w, height: pos.h }}
    >
      <div className="archboard-card-head">
        <button
          type="button"
          className="archboard-card-head"
          style={{ width: "auto", flex: "1 1 auto", minWidth: 0 }}
          aria-pressed={selected}
          aria-label={`${symbol.name}, ${node.kind}`}
          title={`${symbol.name}\n${symbol.rel}`}
          onClick={onSelect}
        >
          <span className="archboard-card-name">{symbol.name}</span>
        </button>
        {onShowFlow !== undefined && (
          <button
            type="button"
            className="secondary small"
            aria-label={`Show flow of ${symbol.name}`}
            title={`Show flow of ${symbol.name}`}
            onClick={onShowFlow}
          >
            Show flow
          </button>
        )}
      </div>
      <div className="archboard-card-sub" title={`${node.routes.join(", ")}${guards}`}>
        <span className="archboard-file">
          {route}
          {more}
          {guards}
        </span>
      </div>
      <div className="archboard-card-meta">
        {cardFacts(node).map((fact) => (
          <span key={fact} className="archboard-count">
            {fact}
          </span>
        ))}
        {onViewSource !== undefined && <SourceButtons symbol={symbol} onOpen={onViewSource} />}
      </div>
    </div>
  );
}

export function PagesBoard({
  composition,
  selectedId,
  matches,
  onSelect,
  onShowFlow,
  onViewSource,
}: {
  composition: Composition;
  selectedId: string | null;
  /** False keeps a card dimmed: search or module filter. */
  matches: (node: CompositionNode) => boolean;
  onSelect: (id: string | null) => void;
  onShowFlow?: (id: string) => void;
  onViewSource?: (symbol: SourceSymbol, tabKey: string) => void;
}) {
  const layout = useMemo(() => layoutComposition(composition), [composition]);
  const known = selectedId !== null && layout.cards.has(selectedId);
  const branch = useMemo(
    () => (known ? branchOf(composition, selectedId as string) : null),
    [composition, known, selectedId],
  );
  const shared = useMemo(
    () =>
      new Set(
        composition.columns
          .filter((column) => column.key === "shared")
          .flatMap((column) => column.nodes.map((node) => node.symbol.id)),
      ),
    [composition],
  );
  return (
    <div
      className="archboard pagesboard"
      style={{ width: layout.width, height: layout.height }}
      role="group"
      aria-label="Pages board"
    >
      {composition.columns.map((column, index) => (
        <div
          key={column.key}
          className="pagesboard-col"
          style={{ left: layout.columnX[index], width: ARCH_COL_W, height: layout.height }}
          role="group"
          aria-label={column.title}
        >
          <div className="archboard-col-title">{`${column.title} (${column.nodes.length})`}</div>
          <div className="hint">{column.hint}</div>
        </div>
      ))}
      <svg className="archboard-edges" width={layout.width} height={layout.height} aria-hidden="true">
        {composition.edges.map((edge) => {
          const from = layout.cards.get(edge.from);
          const to = layout.cards.get(edge.to);
          if (from === undefined || to === undefined) return null;
          const inBranch = branch !== null && branch.has(edge.from) && branch.has(edge.to);
          if (branch !== null ? !inBranch : shared.has(edge.to)) return null;
          return (
            <path
              key={`${edge.from}>${edge.to}`}
              d={edgePath(from, to)}
              className="arch-edge kind-imports"
            />
          );
        })}
      </svg>
      {composition.columns.flatMap((column) =>
        column.nodes.map((node) => (
          <PageCard
            key={node.symbol.id}
            node={node}
            pos={layout.cards.get(node.symbol.id) as CardPos}
            selected={node.symbol.id === selectedId}
            dimmed={!matches(node) || (branch !== null && !branch.has(node.symbol.id))}
            onSelect={() => onSelect(node.symbol.id === selectedId ? null : node.symbol.id)}
            onShowFlow={onShowFlow === undefined ? undefined : () => onShowFlow(node.symbol.id)}
            onViewSource={onViewSource}
          />
        )),
      )}
    </div>
  );
}
