// Component assets: templates scanned, styles checked, failures reported.
import { expect, it } from "vitest";
import { attachComponentAssets } from "./componentAssets";
import { analyzeTsFiles } from "./tsAnalyze";

it("attaches the template and reports missing assets", async () => {
  const result = analyzeTsFiles([
    {
      rootId: "r",
      rel: "a.component.ts",
      hash: "h",
      content: `@Component({ selector: 'a', templateUrl: './a.html', styleUrl: './gone.css' }) export class A {}`,
    },
  ]);
  const read = async (_root: string, rel: string) => {
    if (rel === "a.html") return { text: "<app-b></app-b>" };
    throw { kind: "code_not_found", message: "missing" };
  };
  const out = await attachComponentAssets(result, read);
  const facts = out.symbols[0].component!;
  expect(facts.template?.uses[0].name).toBe("app-b");
  expect(facts.missingAssets).toEqual(["gone.css"]);
});

it("marks an unreadable template without failing", async () => {
  const result = analyzeTsFiles([
    {
      rootId: "r",
      rel: "a.ts",
      hash: "h",
      content: `@Component({ selector: 'a', templateUrl: './a.html' }) export class A {}`,
    },
  ]);
  const out = await attachComponentAssets(result, async () => {
    throw new Error("denied");
  });
  expect(out.symbols[0].component).toMatchObject({ template: null, missingAssets: ["a.html"] });
});

it("keeps inline templates and returns results without assets unchanged", async () => {
  const result = analyzeTsFiles([
    {
      rootId: "r",
      rel: "a.ts",
      hash: "h",
      content: `@Component({ selector: 'a', template: '<app-b></app-b>' }) export class A {}
export class B {}`,
    },
  ]);
  let reads = 0;
  const out = await attachComponentAssets(result, async () => {
    reads += 1;
    return { text: "" };
  });
  expect(out).toEqual(result);
  expect(reads).toBe(0);
  expect(out.symbols[0].component?.template?.uses[0].name).toBe("app-b");
});

it("reads a shared asset once", async () => {
  const content = `@Component({ selector: 'a', styleUrl: './s.css' }) export class A {}
@Component({ selector: 'b', styleUrl: './s.css' }) export class B {}`;
  const result = analyzeTsFiles([{ rootId: "r", rel: "a.ts", hash: "h", content }]);
  let reads = 0;
  await attachComponentAssets(result, async () => {
    reads += 1;
    return { text: "" };
  });
  expect(reads).toBe(1);
});
