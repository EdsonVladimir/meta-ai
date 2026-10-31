// Page hierarchy: pages only from routes, levels from templates, shared
// and unused said plainly, cycles cut.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { branchOf, buildComposition, SHARED_PARENTS } from "./compositionModel";

function analyze(files: Record<string, string>) {
  return analyzeTsFiles(
    Object.entries(files).map(([rel, content]) => ({ rootId: "r", rel, content, hash: rel })),
  );
}

const comp = (name: string, selector: string, template = "") =>
  `@Component({ selector: '${selector}', template: '${template}' }) export class ${name} {}`;

const shape = (input: Record<string, string>) =>
  Object.fromEntries(
    (buildComposition(analyze(input))?.columns ?? []).map((column) => [
      column.title,
      column.nodes.map((node) => node.symbol.name),
    ]),
  );

describe("buildComposition", () => {
  it("orders app, pages and as many levels as the project has", () => {
    expect(
      shape({
        "main.ts": "bootstrapApplication(AppC);",
        "app.ts": comp("AppC", "app-root", "<router-outlet />"),
        "routes.ts": "export const r: Routes = [{ path: 'a', component: PageA }];",
        "a.ts": comp("PageA", "page-a", "<ui-one />"),
        "b.ts": comp("One", "ui-one", "<ui-two />"),
        "c.ts": comp("Two", "ui-two", "<ui-three />"),
        "d.ts": comp("Three", "ui-three"),
      }),
    ).toEqual({
      App: ["AppC"],
      Pages: ["PageA"],
      "Level 1": ["One"],
      "Level 2": ["Two"],
      "Level 3": ["Three"],
    });
  });

  it("never makes a page from a name or a folder", () => {
    expect(
      shape({ "pages/home.page.ts": comp("HomePage", "x-home") }),
    ).toEqual({ "No usage detected": ["HomePage"] });
  });

  it("places a component at its deepest use", () => {
    const out = shape({
      "routes.ts": "export const r: Routes = [{ path: 'a', component: P }];",
      "a.ts": comp("P", "x-p", "<x-a /><x-b />"),
      "b.ts": comp("A", "x-a", "<x-b />"),
      "c.ts": comp("B", "x-b"),
    });
    expect(out["Level 1"]).toEqual(["A"]);
    expect(out["Level 2"]).toEqual(["B"]);
  });

  it("moves a widely used component to Shared", () => {
    const parents = Object.fromEntries(
      Array.from({ length: SHARED_PARENTS }, (_, i) => [
        `p${i}.ts`,
        comp(`P${i}`, `x-p${i}`, "<x-pager />"),
      ]),
    );
    const table = parents && `export const r: Routes = [${Object.keys(parents)
      .map((_, i) => `{ path: 'p${i}', component: P${i} }`)
      .join(",")}];`;
    const out = shape({ ...parents, "routes.ts": table, "pager.ts": comp("Pager", "x-pager") });
    expect(out.Shared).toEqual(["Pager"]);
    expect(out["Level 1"]).toBeUndefined();
  });

  it("cuts a cycle and counts it", () => {
    const composition = buildComposition(
      analyze({
        "routes.ts": "export const r: Routes = [{ path: 'a', component: P }];",
        "a.ts": comp("P", "x-p", "<x-a />"),
        "b.ts": comp("A", "x-a", "<x-b />"),
        "c.ts": comp("B", "x-b", "<x-a />"),
      }),
    );
    expect(composition?.cycles).toBeGreaterThan(0);
    expect(composition?.columns.map((column) => column.title)).toEqual([
      "Pages",
      "Level 1",
      "Level 2",
    ]);
  });

  it("follows lazy pages and lazy route files, with their full path", () => {
    const composition = buildComposition(
      analyze({
        "src/app.routes.ts": `export const r: Routes = [
  { path: "b", loadComponent: () => import("./b/b.page").then((m) => m.BPage) },
  { path: "d", loadComponent: () => import("./d/d.page") },
  { path: "admin", loadChildren: () => import("./admin/admin.routes").then((m) => m.ROUTES) },
];`,
        "src/b/b.page.ts": comp("BPage", "x-b"),
        "src/d/d.page.ts": comp("DPage", "x-d"),
        "src/admin/admin.routes.ts": "export const ROUTES: Routes = [{ path: 'users', component: Users }];",
        "src/admin/users.ts": comp("Users", "x-users"),
      }),
    );
    const pages = composition?.columns.find((column) => column.key === "pages")?.nodes ?? [];
    expect(pages.map((node) => [node.symbol.name, node.routes])).toEqual([
      ["Users", ["admin/users"]],
      ["BPage", ["b"]],
      ["DPage", ["d"]],
    ]);
  });

  it("says which routes it could not resolve, and keeps guards", () => {
    const composition = buildComposition(
      analyze({
        "routes.ts": `export const r: Routes = [
  { path: "gone", component: Missing },
  { path: "a", component: P, canActivate: [authGuard] },
];`,
        "a.ts": comp("P", "x-p"),
      }),
    );
    expect(composition?.unresolvedRoutes.map((route) => [route.path, route.target])).toEqual([
      ["gone", "Missing"],
    ]);
    expect(composition?.columns[0].nodes[0].guards).toEqual(["authGuard"]);
  });

  it("leaves out libraries and folders marked external", () => {
    const composition = buildComposition(
      analyze({
        "routes.ts": "export const r: Routes = [{ path: 'a', component: P }];",
        "a.ts": comp("P", "x-p", "<p-table /><x-lib />"),
        "vendor/lib.ts": comp("Lib", "x-lib"),
      }),
      [{ rootId: "r", rel: "vendor" }],
    );
    expect(composition?.columns.map((column) => column.title)).toEqual(["Pages"]);
  });

  it("has nothing to say without components", () => {
    expect(buildComposition(analyze({ "a.ts": "export class A {}" }))).toBeNull();
    expect(buildComposition(null)).toBeNull();
  });

  it("returns a node with its ancestors and descendants only", () => {
    const composition = buildComposition(
      analyze({
        "routes.ts": "export const r: Routes = [{ path: 'a', component: P }, { path: 'b', component: Q }];",
        "a.ts": comp("P", "x-p", "<x-a />"),
        "b.ts": comp("A", "x-a", "<x-b />"),
        "c.ts": comp("B", "x-b"),
        "d.ts": comp("Q", "x-q", "<x-c />"),
        "e.ts": comp("C", "x-c"),
      }),
    );
    const ids = new Map(
      composition?.columns.flatMap((column) =>
        column.nodes.map((node) => [node.symbol.name, node.symbol.id] as const),
      ),
    );
    const branch = branchOf(composition!, ids.get("A") as string);
    expect(branch.has(ids.get("P") as string)).toBe(true);
    expect(branch.has(ids.get("B") as string)).toBe(true);
    expect(branch.has(ids.get("Q") as string)).toBe(false);
  });
});
