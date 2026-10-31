// @vitest-environment jsdom
// Pages board: what a reader sees, branch focus, and a large project.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { combineResults } from "../structure/structureMerge";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { buildComposition, SHARED_PARENTS, type CompositionNode } from "./compositionModel";
import { cardFacts, layoutComposition, PagesBoard } from "./PagesBoard";

afterEach(() => cleanup());

function analyze(files: Record<string, string>) {
  return analyzeTsFiles(
    Object.entries(files).map(([rel, content]) => ({ rootId: "r", rel, content, hash: rel })),
  );
}

const comp = (name: string, selector: string, template = "") =>
  `@Component({ selector: '${selector}', template: '${template}' }) export class ${name} {}`;

const PROJECT = {
  "main.ts": "bootstrapApplication(Root);",
  "root.ts": comp("Root", "app-root", "<router-outlet />"),
  "routes.ts":
    "export const r: Routes = [{ path: 'a', component: PageA }, { path: 'b', component: PageB }];",
  "a.ts": comp("PageA", "x-a", "<x-one />"),
  "b.ts": comp("PageB", "x-b", "<x-two />"),
  "one.ts": comp("One", "x-one"),
  "two.ts": comp("Two", "x-two"),
  "old.ts": comp("Old", "x-old"),
};

function setup(overrides: Partial<Parameters<typeof PagesBoard>[0]> = {}) {
  const composition = buildComposition(analyze(PROJECT))!;
  const onSelect = vi.fn();
  const view = render(
    <PagesBoard
      composition={composition}
      selectedId={null}
      matches={() => true}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { composition, onSelect, view };
}

const idOf = (composition: ReturnType<typeof setup>["composition"], name: string) =>
  composition.columns
    .flatMap((column) => column.nodes)
    .find((node) => node.symbol.name === name)?.symbol.id as string;

describe("PagesBoard", () => {
  it("names every column and explains it", () => {
    setup();
    for (const [title, hint] of [
      ["App (1)", "Where the application starts."],
      ["Pages (2)", "Components a route opens."],
      ["Level 1 (2)", "Used directly by a page."],
      ["No usage detected (1)", "Dynamic creation cannot be ruled out."],
    ]) {
      const column = screen.getByRole("group", { name: title.replace(/ \(\d\)$/, "") });
      expect(within(column).getByText(title)).toBeTruthy();
      expect(column.textContent).toContain(hint);
    }
  });

  it("never tells a page that nobody uses it", () => {
    const { composition } = setup();
    const facts = (name: string) =>
      cardFacts(
        composition.columns.flatMap((c) => c.nodes).find((n) => n.symbol.name === name) as CompositionNode,
      );
    expect(facts("PageA")).toEqual(["opened by 1 route", "uses 1 component"]);
    expect(facts("Root")).toEqual(["shows the pages"]);
    expect(facts("One")).toEqual(["in 1 component", "uses 0 components"]);
    expect(document.body.textContent).toContain("/a");
  });

  it("keeps a selected card's branch and dims the rest", () => {
    const { composition, view } = setup();
    view.rerender(
      <PagesBoard
        composition={composition}
        selectedId={idOf(composition, "One")}
        matches={() => true}
        onSelect={() => {}}
      />,
    );
    const dimmed = [...document.querySelectorAll(".pagesboard-card.dimmed")].map(
      (card) => card.querySelector(".archboard-card-name")?.textContent,
    );
    expect(dimmed.sort()).toEqual(["Old", "PageB", "Root", "Two"]);
    expect(document.querySelectorAll(".pagesboard path")).toHaveLength(1);
  });

  it("selects and unselects a card, by click or keyboard button", () => {
    const { composition, onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "PageA, page" }));
    expect(onSelect).toHaveBeenCalledWith(idOf(composition, "PageA"));
  });

  it("dims what a search leaves out", () => {
    setup({ matches: (node) => node.symbol.name === "One" });
    expect(document.querySelectorAll(".pagesboard-card:not(.dimmed)")).toHaveLength(1);
  });

  it("hides lines to Shared until a branch is chosen", () => {
    const parents = Object.fromEntries(
      Array.from({ length: SHARED_PARENTS }, (_, i) => [`p${i}.ts`, comp(`P${i}`, `x-p${i}`, "<x-s />")]),
    );
    const routes = `export const r: Routes = [${Array.from(
      { length: SHARED_PARENTS },
      (_, i) => `{ path: 'p${i}', component: P${i} }`,
    ).join(",")}];`;
    const composition = buildComposition(
      analyze({ ...parents, "routes.ts": routes, "s.ts": comp("S", "x-s") }),
    )!;
    const { view } = setup({ composition });
    expect(document.querySelectorAll(".pagesboard path")).toHaveLength(0);
    view.rerender(
      <PagesBoard
        composition={composition}
        selectedId={idOf(composition, "S")}
        matches={() => true}
        onSelect={() => {}}
      />,
    );
    expect(document.querySelectorAll(".pagesboard path")).toHaveLength(SHARED_PARENTS);
  });

  it("stays fast and laid out on a project of 300 components", () => {
    const files: Record<string, string> = {};
    const routes: string[] = [];
    for (let page = 0; page < 60; page += 1) {
      routes.push(`{ path: 'p${page}', component: Page${page} }`);
      const tags = Array.from({ length: 4 }, (_, i) => `<x-c${page}-${i} />`).join("");
      files[`p${page}.ts`] = comp(`Page${page}`, `x-p${page}`, tags);
      for (let child = 0; child < 4; child += 1) {
        files[`c${page}-${child}.ts`] = comp(`C${page}x${child}`, `x-c${page}-${child}`, "<x-shared />");
      }
    }
    files["routes.ts"] = `export const r: Routes = [${routes.join(",")}];`;
    files["shared.ts"] = comp("Shared", "x-shared");
    const entries = Object.entries(files);
    const parts = [];
    for (let i = 0; i < entries.length; i += STRUCTURE_LIMITS.maxFiles) {
      parts.push(analyze(Object.fromEntries(entries.slice(i, i + STRUCTURE_LIMITS.maxFiles))));
    }
    const result = combineResults(parts);
    const started = performance.now();
    const composition = buildComposition(result)!;
    const layout = layoutComposition(composition);
    expect(performance.now() - started).toBeLessThan(500);
    expect(composition.columns.map((column) => [column.title, column.nodes.length])).toEqual([
      ["Pages", 60],
      ["Level 1", 240],
      ["Shared", 1],
    ]);
    expect(layout.cards.size).toBe(301);
    const boxes = [...layout.cards.values()].map((card) => `${card.x},${card.y}`);
    expect(new Set(boxes).size).toBe(301);
  });
});
