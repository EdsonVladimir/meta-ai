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

