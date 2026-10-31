// Sample project: the public room-booking demo target in
// examples/reservas yields every link the demo needs.
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { combineResults } from "../structure/structureMerge";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { memberSignalLines } from "./flowLayout";
import { buildFlowGraph, TEMPLATE_MEMBER, type FlowProject } from "./flowModel";
import { projectUsesStore } from "./proposalChecks";
import { applyChangesToGraph, buildProposalOverlay } from "./proposalOverlay";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type { StructureInput, StructureResult } from "../structure/structureTypes";

function collectInputs(side: string): StructureInput[] {
  const root = new URL(`../../../../examples/reservas/${side}/`, import.meta.url);
  const out: StructureInput[] = [];
  const walk = (dir: URL, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".ts")) {
        const rel = `${prefix}${entry.name}`;
        out.push({
          rootId: "reservas",
          rel: `${side}/${rel}`,
          content: readFileSync(new URL(entry.name, dir), "utf8"),
          hash: `sample:${side}/${rel}`,
        });
      }
    }
  };
  walk(root, "");
  return out;
}

function analyzeSample(sides = ["frontend", "backend"]): StructureResult {
  const inputs = sides.flatMap(collectInputs);
  const parts: StructureResult[] = [];
  for (let i = 0; i < inputs.length; i += STRUCTURE_LIMITS.maxFiles) {
    parts.push(analyzeTsFiles(inputs.slice(i, i + STRUCTURE_LIMITS.maxFiles)));
  }
  return combineResults(parts);
}

it("walks the demo page from its template down to the HTTP call", () => {
  const result = analyzeSample(["frontend"]);
  const project: FlowProject = { key: "reservas", label: "reservas", result };
  const page = result.symbols.find((s) => s.name === "ReservasPageComponent")!;
  const graph = buildFlowGraph([project], {
    projectKey: "reservas",
    symbolId: page.id,
    member: null,
  });
  const start = graph.nodes.find((node) => node.symbol.name === "ReservasPageComponent")!;
  expect(memberSignalLines(start, TEMPLATE_MEMBER)).toEqual([
    "reads store.count",
    "reads store.loading",
    "reads store.reservas",
  ]);
  expect(graph.nodes.map((node) => node.symbol.name)).toEqual(
    expect.arrayContaining(["ReservaFormComponent", "ReservasStore", "ReservasService"]),
  );
  expect(graph.httpNodes.length).toBeGreaterThan(0);
  expect(graph.pending.filter((item) => item.kind === "ambiguous")).toEqual([]);
});

it("proves the demo project routes UI through a store", () => {
  const project: FlowProject = {
    key: "reservas",
    label: "reservas",
    result: analyzeSample(["frontend"]),
  };
  expect(projectUsesStore([project])).toBe(true);
});

it("yields every link the demo needs", () => {
  const result = analyzeSample();
  // Both sides define ReservasService, so lookups name their side.
  const flow = (side: string, name: string) =>
    result.symbols.find((s) => s.name === name && s.rel.startsWith(`${side}/`))!.flow!;
  expect(flow("frontend", "ReservasService").httpCalls.map((c) => c.verb).sort()).toEqual([
    "GET",
    "POST",
  ]);
  expect(flow("backend", "ReservasController").routes.map((r) => r.path)).toEqual([
    "/reservas",
    "/reservas",
  ]);
  expect(flow("frontend", "ReservasStore").signals.length).toBeGreaterThan(0);
  expect(result.symbols.some((s) => s.decorators?.includes("Entity"))).toBe(true);
});

it("reaches the POST from a form method, not from a template", () => {
  const result = analyzeSample();
  const flow = (side: string, name: string) =>
    result.symbols.find((s) => s.name === name && s.rel.startsWith(`${side}/`))!.flow!;
  const link = (facts: { calls: Array<{ member: string; method: string }> }, member: string) =>
    facts.calls.filter((c) => c.member === member).map((c) => c.method);
  expect(link(flow("frontend", "ReservaFormComponent"), "submit")).toEqual(["add"]);
  expect(link(flow("frontend", "ReservasStore"), "add")).toContain("create");
  expect(flow("frontend", "ReservasService").httpCalls.map((c) => c.member)).toContain("create");
  expect(link(flow("backend", "ReservasController"), "create")).toEqual(["create"]);
  expect(flow("backend", "ReservasService").repositoryCalls.map((c) => c.method)).toContain("save");
});

it("draws the whole chain the video shows", () => {
  const side = (key: string): FlowProject => ({
    key,
    label: key,
    result: analyzeTsFiles(collectInputs(key)),
  });
  const projects = [side("frontend"), side("backend")];
  const form = projects[0].result.symbols.find((s) => s.name === "ReservaFormComponent")!;
  const graph = buildFlowGraph(projects, {
    projectKey: "frontend",
    symbolId: form.id,
    member: "submit",
  });
  expect(graph.nodes.map((n) => `${n.projectKey}:${n.symbol.name}`)).toEqual([
    "frontend:ReservaFormComponent",
    "frontend:ReservasStore",
    "frontend:ReservasService",
    "backend:ReservasController",
    "backend:ReservasService",
    "backend:Reserva",
  ]);
  expect(graph.httpNodes[0]).toMatchObject({
    verb: "POST",
    url: "{apiUrl}reservas",
    interceptors: ["authInterceptor"],
  });
  expect(graph.pending).toEqual([]);
});

it("draws a proposal across both projects before it reaches the disk", () => {
  const side = (key: string): FlowProject => ({
    key,
    label: key,
    result: analyzeTsFiles(collectInputs(key).map((input) => ({ ...input, rootId: "r" }))),
  });
  const projects = [side("frontend"), side("backend")];
  const proposed = (rel: string, content: string, operation: string) => ({
    pos: 0,
    rootId: "r",
    rel,
    operation,
    state: "pending",
    decidedAt: null,
    content,
    expectedFingerprint: null,
  });
  const storeRel = "frontend/src/app/reservas/reservas.store.ts";
  const store = projects[0].result.files.find((f) => f.rel === storeRel);
  expect(store).toBeDefined();
  const original = collectInputs("frontend").find((input) => input.rel === storeRel)!;
  const overlay = buildProposalOverlay(projects, [
    proposed(
      storeRel,
      original.content.replace("add(dto: CreateReserva): void {", "add(dto: CreateReserva): void {\n    this.loading.set(true);"),
      "modify",
    ),
    proposed(
      "backend/src/usuarios/usuarios.service.ts",
      "export class UsuariosService { crear() {} }",
      "create",
    ),
  ]);
  expect(overlay.notes).toEqual([]);
  expect(overlay.changes.get(`r:${storeRel}:ReservasStore`)).toEqual({
    change: "modified",
    members: { add: "modified" },
  });
  expect(
    overlay.projects[1].result.symbols.some((symbol) => symbol.name === "UsuariosService"),
  ).toBe(true);
  expect(
    overlay.projects[0].result.symbols.some((symbol) => symbol.name === "UsuariosService"),
  ).toBe(false);
  const form = overlay.projects[0].result.symbols.find((s) => s.name === "ReservaFormComponent")!;
  const graph = applyChangesToGraph(
    buildFlowGraph(overlay.projects, { projectKey: "frontend", symbolId: form.id, member: "submit" }),
    overlay,
  );
  expect(graph.nodes[1]).toMatchObject({
    change: "modified",
    memberChanges: { add: "modified" },
  });
  expect(graph.nodes.at(-1)?.symbol.name).toBe("Reserva");
  expect(graph.pending).toEqual([]);
});

