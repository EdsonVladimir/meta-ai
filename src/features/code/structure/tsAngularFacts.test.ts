// Angular pipeline facts: HTTP client interceptors.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";

function analyze(content: string, rel = "a.ts") {
  return analyzeTsFiles([{ rootId: "root-1", rel, content, hash: `h:${rel}` }]);
}

it("reads withInterceptors in order", () => {
  const result = analyze(`bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
] });`);
  expect(result.pipeline).toEqual([
    expect.objectContaining({ scope: "http-client", names: ["authInterceptor", "errorInterceptor"] }),
  ]);
});

describe("collectComponentFacts", () => {
  const facts = (content: string, rel = "a.ts") =>
    analyzeTsFiles([{ rootId: "r", rel, content, hash: "h" }]).symbols[0].component;

  it("reads component metadata with root-relative assets", () => {
    expect(
      facts(
        `@Component({ selector: 'app-carga', templateUrl: './carga.component.html',
  styleUrl: '../shared/carga.css', standalone: false }) export class C {}`,
        "src/app/carga/carga.component.ts",
      ),
    ).toEqual({
      kind: "component",
      selector: "app-carga",
      standalone: false,
      imports: [],
      templateRel: "src/app/carga/carga.component.html",
      styleRels: ["src/app/shared/carga.css"],
    });
  });

  it("reads styleUrls, standalone imports, directives and pipes", () => {
    expect(
      facts(`@Component({ selector: 'a', styleUrls: ['./a.css', './b.scss'],
  imports: [TableModule, ChildComponent] }) export class A {}`),
    ).toMatchObject({ styleRels: ["a.css", "b.scss"], imports: ["TableModule", "ChildComponent"] });
    expect(facts(`@Directive({ selector: '[appFoco]' }) export class D {}`)).toMatchObject({
      kind: "directive",
      selector: "[appFoco]",
    });
    expect(facts(`@Pipe({ name: 'fecha' }) export class P {}`)).toMatchObject({
      kind: "pipe",
      selector: "fecha",
    });
  });

  it("scans an inline template with file lines, skipping interpolated ones", () => {
    const inline = facts("@Component({\n  selector: 'a',\n  template: `\n<app-b></app-b>`,\n}) export class A {}");
    expect(inline?.template?.uses).toEqual([{ name: "app-b", kind: "element", line: 4 }]);
    const dynamic = facts("@Component({ selector: 'a', template: `<p>${x}</p>` }) export class A {}");
    expect(dynamic?.template).toBeUndefined();
  });

  it("leaves plain classes and non literal metadata alone", () => {
    expect(facts(`export class A {}`)).toBeUndefined();
    expect(facts(`@Component(META) export class A {}`)).toBeUndefined();
  });
});

describe("routes and bootstrap", () => {
  it("reads typed tables, children, guards and lazy targets", () => {
    const { routes } = analyze(`export const routes: Routes = [
  { path: "", redirectTo: "a", pathMatch: "full" },
  { path: "a", component: APage, canActivate: [authGuard] },
  { path: "b", loadComponent: () => import("./b/b.page").then((m) => m.BPage) },
  { path: "c", loadChildren: () => import("./c/c.routes").then((m) => m.C_ROUTES) },
  { path: "d", component: DShell, children: [{ path: "e", component: EPage }] },
];`, "src/app/app.routes.ts");
    expect(
      routes?.map((r) => [r.path, r.component, r.lazyImport, r.loadsChildren, r.canActivate]),
    ).toEqual([
      ["a", "APage", null, false, ["authGuard"]],
      ["b", "BPage", "./b/b.page", false, []],
      ["c", "C_ROUTES", "./c/c.routes", true, []],
      ["d", "DShell", null, false, []],
      ["d/e", "EPage", null, false, []],
    ]);
    expect(routes?.[0].evidence).toContain("app.routes.ts");
  });

  it("finds tables by the call that receives them, once", () => {
    const { routes } = analyze(`const table = [{ path: "x", component: X }];
export const config = { providers: [provideRouter(table)] };
RouterModule.forChild(table);
RouterModule.forRoot([{ path: "y", component: Y }]);`);
    expect(routes?.map((r) => r.path)).toEqual(["x", "y"]);
  });

  it("does not read an unrelated array as routes", () => {
    expect(analyze(`const items = [{ path: "x", component: X }];`).routes).toBeUndefined();
  });

  it("keeps a route with a computed path, without inventing one", () => {
    const { routes } = analyze(`export const r: Routes = [{ path: PATHS.home, component: H }];`);
    expect(routes?.[0]).toMatchObject({ path: null, component: "H" });
  });

  it("finds what an application starts from", () => {
    expect(analyze(`bootstrapApplication(AppComponent, {});`).bootstrap).toEqual(["AppComponent"]);
    expect(
      analyze(`@NgModule({ bootstrap: [Root] }) export class AppModule {}`).bootstrap,
    ).toEqual(["Root"]);
  });
});

