// Proposal overlay: staged contents diffed against the base projects
// without touching them, then stamped onto the flow graph.
import { expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { StructureInput } from "../structure/structureTypes";
import { buildFlowGraph } from "./flowModel";
import type { FlowProject, FlowStart } from "./flowModel";
import { applyChangesToGraph, buildProposalOverlay } from "./proposalOverlay";

// Sample root id, shared with the proposal files below.
function project(key: string, files: Record<string, string>): FlowProject {
  const inputs: StructureInput[] = Object.entries(files).map(([rel, content]) => ({
    rootId: "r",
    rel,
    content,
    hash: `h:${rel}`,
  }));
  return { key, label: key, result: analyzeTsFiles(inputs) };
}

function startAt(project: FlowProject, name: string, member: string | null): FlowStart {
  const symbol = project.result.symbols.find((s) => s.name === name);
  if (symbol === undefined) throw new Error(`missing symbol: ${name}`);
  return { projectKey: project.key, symbolId: symbol.id, member };
}

const BASE = project("fe", { "a.ts": `export class A { run() { return 1; } keep() {} }` });
const file = (rel: string, content: string, operation = "modify", state = "pending") =>
  ({ pos: 0, rootId: "r", rel, operation, state, decidedAt: null, content, expectedFingerprint: null });

it("marks modified methods by body and added methods", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("a.ts", `export class A { run() { return 2; } keep() {} nuevo() {} }`),
  ]);
  expect(overlay.changes.get("r:a.ts:A")).toEqual({
    change: "modified",
    members: { run: "modified", nuevo: "added" },
  });
});

it("marks every symbol of a new file as added", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("b.ts", `export class B { go() {} }`, "create"),
  ]);
  expect(overlay.changes.get("r:b.ts:B")?.change).toBe("added");
  expect(overlay.projects[0].result.symbols.some((s) => s.name === "B")).toBe(true);
});

it("lists symbols the proposal removes", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export const x = 1;`)]);
  expect(overlay.removed).toEqual([{ rootId: "r", rel: "a.ts", name: "A" }]);
});

it("ignores accepted and discarded files", () => {
  const overlay = buildProposalOverlay([BASE], [
    file("a.ts", `export class A {}`, "modify", "discarded"),
  ]);
  expect(overlay.changes.size).toBe(0);
});

it("does not mutate the original projects", () => {
  const before = JSON.stringify(BASE.result);
  buildProposalOverlay([BASE], [file("a.ts", `export class A {}`)]);
  expect(JSON.stringify(BASE.result)).toBe(before);
});

it("keeps going on syntax errors and notes them", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export class A { run( { }`)]);
  expect(overlay.notes).toEqual(["a.ts: partial syntax"]);
});

it("notes non-TypeScript files without analyzing them", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.html", "<p></p>", "create")]);
  expect(overlay.notes).toEqual(["a.html: not analyzed"]);
});

it("marks graph nodes and members", () => {
  const overlay = buildProposalOverlay([BASE], [file("a.ts", `export class A { run() { return 2; } keep() {} }`)]);
  const graph = buildFlowGraph(overlay.projects, startAt(overlay.projects[0], "A", "run"));
  const marked = applyChangesToGraph(graph, overlay);
  expect(marked.nodes[0]).toMatchObject({ change: "modified", memberChanges: { run: "modified" } });
});

const ROOT_FE = project("fe", {
  "frontend/src/a.service.ts": `export class A { run() { return 1; } }`,
});
const ROOT_BE = project("be", {
  "backend/src/b.controller.ts": `@Controller("b") export class B { @Get() all() {} }`,
});
const NESTED = [ROOT_FE, ROOT_BE].map((entry) => ({
  ...entry,
  result: {
    ...entry.result,
    files: entry.result.files.map((f) => ({ ...f, rootId: "r" })),
    symbols: entry.result.symbols.map((sym) => ({ ...sym, rootId: "r" })),
  },
}));

it("puts each file in the project that holds it, even on a shared root", () => {
  const overlay = buildProposalOverlay(NESTED, [
    file("backend/src/b.controller.ts", `@Controller("b") export class B { @Get() all() { return 1; } }`),
  ]);
  const be = overlay.projects[1].result.symbols.filter((sym) => sym.name === "B");
  expect(be).toHaveLength(1);
  expect(overlay.projects[0].result.symbols.some((sym) => sym.name === "B")).toBe(false);
});

it("puts a new file in the project of its folder", () => {
  const overlay = buildProposalOverlay(NESTED, [
    file("backend/src/usuarios/u.service.ts", `export class U {}`, "create"),
    file("frontend/src/u.store.ts", `export class S {}`, "create"),
  ]);
  expect(overlay.projects[1].result.symbols.some((sym) => sym.name === "U")).toBe(true);
  expect(overlay.projects[0].result.symbols.some((sym) => sym.name === "S")).toBe(true);
});

it("marks a function whose body changed", () => {
  const base = project("fe", { "g.ts": `export const guard = () => true;` });
  const overlay = buildProposalOverlay([base], [file("g.ts", `export const guard = () => false;`)]);
  expect(overlay.changes.get("r:g.ts:guard")?.change).toBe("modified");
});

it("marks a class whose decorator changed with no member change", () => {
  const base = project("fe", { "c.ts": `export class C { run() {} }` });
  const overlay = buildProposalOverlay([base], [
    file("c.ts", `@Injectable() export class C { run() {} }`),
  ]);
  expect(overlay.changes.get("r:c.ts:C")?.change).toBe("modified");
});

it("does not duplicate pipeline facts of a modified file", () => {
  const base = project("fe", {
    "main.ts": `boot({ providers: [provideHttpClient(withInterceptors([auth]))] });`,
    "other.ts": `export class Other {}`,
  });
  const overlay = buildProposalOverlay([base], [
    file("main.ts", `boot({ providers: [provideHttpClient(withInterceptors([auth, log]))] });`),
  ]);
  expect(overlay.projects[0].result.pipeline?.flatMap((p) => p.names)).toEqual(["auth", "log"]);
});

it("says when a modified file had no analysis to compare with", () => {
  const overlay = buildProposalOverlay([BASE], [file("later.ts", `export class L {}`)]);
  expect(overlay.notes).toEqual(["later.ts: not analyzed before, shown as new"]);
});

it("analyzes proposals larger than one batch", () => {
  const files = Array.from({ length: 25 }, (_, i) =>
    file(`n${i}.ts`, `export class N${i} {}`, "create"),
  );
  const overlay = buildProposalOverlay([BASE], files);
  expect(overlay.changes.size).toBe(25);
});

