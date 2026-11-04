// Sample project: the public room-booking demo target in
// examples/bookings yields every link the demo needs.
import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { attachComponentAssets } from "../structure/componentAssets";
import { combineResults } from "../structure/structureMerge";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import { classifySymbol } from "./archLayers";
import { buildComposition } from "./compositionModel";
import { memberSignalLines } from "./flowLayout";
import { buildFlowGraph, TEMPLATE_MEMBER, type FlowProject } from "./flowModel";
import { projectUsesStore } from "./proposalChecks";
import { applyChangesToGraph, buildProposalOverlay } from "./proposalOverlay";
import { STRUCTURE_LIMITS } from "../structure/structureTypes";
import type { StructureInput, StructureResult } from "../structure/structureTypes";

function collectInputs(side: string): StructureInput[] {
  const root = new URL(`../../../../examples/bookings/${side}/`, import.meta.url);
  const out: StructureInput[] = [];
  const walk = (dir: URL, prefix: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1,
    );
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // What the sample's own install and build leave behind.
        if (["node_modules", "dist", ".angular"].includes(entry.name)) continue;
        walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith(".ts")) {
        const rel = `${prefix}${entry.name}`;
        out.push({
          rootId: "bookings",
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

/** Templates and styles live in their own files, read as Ruth reads them. */
function readSample(_rootId: string, rel: string): Promise<{ text: string }> {
  const url = new URL(`../../../../examples/bookings/${rel}`, import.meta.url);
  return Promise.resolve({ text: readFileSync(url, "utf8") });
}

async function analyzeSample(sides = ["frontend", "backend"]): Promise<StructureResult> {
  const inputs = sides.flatMap(collectInputs);
  const parts: StructureResult[] = [];
  for (let i = 0; i < inputs.length; i += STRUCTURE_LIMITS.maxFiles) {
    const part = analyzeTsFiles(inputs.slice(i, i + STRUCTURE_LIMITS.maxFiles));
    parts.push(await attachComponentAssets(part, readSample));
  }
  return combineResults(parts);
}

it("walks the demo page from its template down to the HTTP call", async () => {
  const result = await analyzeSample(["frontend"]);
  const project: FlowProject = { key: "bookings", label: "bookings", result };
  const page = result.symbols.find((s) => s.name === "BookingsPageComponent")!;
  const graph = buildFlowGraph([project], {
    projectKey: "bookings",
    symbolId: page.id,
    member: null,
  });
  const start = graph.nodes.find((node) => node.symbol.name === "BookingsPageComponent")!;
  expect(memberSignalLines(start, TEMPLATE_MEMBER)).toEqual([
    "reads store.count",
    "reads store.loading",
    "reads store.bookings",
  ]);
  expect(graph.nodes.map((node) => node.symbol.name)).toEqual(
    expect.arrayContaining(["BookingFormComponent", "BookingsStore", "BookingsService"]),
  );
  expect(graph.httpNodes.length).toBeGreaterThan(0);
  expect(graph.pending.filter((item) => item.kind === "ambiguous")).toEqual([]);
});

it("proves the demo project routes UI through a store", async () => {
  const project: FlowProject = {
    key: "bookings",
    label: "bookings",
    result: await analyzeSample(["frontend"]),
  };
  expect(projectUsesStore([project])).toBe(true);
});

it("shows the demo app's route table as a wiring card", async () => {
  const table = (await analyzeSample(["frontend"])).symbols.find((symbol) => symbol.name === "routes");
  expect(table?.rel).toBe("frontend/src/app/app.routes.ts");
  expect(table?.members.map((member) => member.name)).toEqual(["/bookings"]);
  const verdict = classifySymbol(table?.rel ?? "", {
    name: "routes",
    kind: "class",
    decorators: [],
  });
  expect(verdict.layer).toBe("composition");
});

it("orders the demo app from its routes", async () => {
  const composition = buildComposition(await analyzeSample(["frontend"]));
  expect(
    composition?.columns.map((column) => [
      column.title,
      column.nodes.map((node) => node.symbol.name),
    ]),
  ).toEqual([
    ["App", ["AppComponent"]],
    ["Pages", ["BookingsPageComponent"]],
    ["Level 1", ["BookingFormComponent"]],
  ]);
  expect(composition?.columns[1].nodes[0].routes).toEqual(["bookings"]);
  expect(composition?.columns[1].nodes[0].guards).toEqual(["authGuard"]);
});

it("yields every link the demo needs", async () => {
  const result = await analyzeSample();
  // Both sides define BookingsService, so lookups name their side.
  const flow = (side: string, name: string) =>
    result.symbols.find((s) => s.name === name && s.rel.startsWith(`${side}/`))!.flow!;
  expect(flow("frontend", "BookingsService").httpCalls.map((c) => c.verb).sort()).toEqual([
    "GET",
    "POST",
  ]);
  expect(flow("backend", "BookingsController").routes.map((r) => r.path)).toEqual([
    "/bookings",
    "/bookings",
  ]);
  expect(flow("frontend", "BookingsStore").signals.length).toBeGreaterThan(0);
  expect(result.symbols.some((s) => s.decorators?.includes("Entity"))).toBe(true);
});

it("reaches the POST from a form method, not from a template", async () => {
  const result = await analyzeSample();
  const flow = (side: string, name: string) =>
    result.symbols.find((s) => s.name === name && s.rel.startsWith(`${side}/`))!.flow!;
  const link = (facts: { calls: Array<{ member: string; method: string }> }, member: string) =>
    facts.calls.filter((c) => c.member === member).map((c) => c.method);
  expect(link(flow("frontend", "BookingFormComponent"), "submit")).toEqual(["add"]);
  expect(link(flow("frontend", "BookingsStore"), "add")).toContain("create");
  expect(flow("frontend", "BookingsService").httpCalls.map((c) => c.member)).toContain("create");
  expect(link(flow("backend", "BookingsController"), "create")).toEqual(["create"]);
  expect(flow("backend", "BookingsService").repositoryCalls.map((c) => c.method)).toContain("save");
});

it("draws the whole chain the video shows", () => {
  const side = (key: string): FlowProject => ({
    key,
    label: key,
    result: analyzeTsFiles(collectInputs(key)),
  });
  const projects = [side("frontend"), side("backend")];
  const form = projects[0].result.symbols.find((s) => s.name === "BookingFormComponent")!;
  const graph = buildFlowGraph(projects, {
    projectKey: "frontend",
    symbolId: form.id,
    member: "submit",
  });
  expect(graph.nodes.map((n) => `${n.projectKey}:${n.symbol.name}`)).toEqual([
    "frontend:BookingFormComponent",
    "frontend:BookingsStore",
    "frontend:BookingsService",
    "backend:BookingsController",
    "backend:BookingsService",
    "backend:Booking",
  ]);
  expect(graph.httpNodes[0]).toMatchObject({
    verb: "POST",
    url: "{apiUrl}bookings",
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
  const storeRel = "frontend/src/app/bookings/bookings.store.ts";
  const store = projects[0].result.files.find((f) => f.rel === storeRel);
  expect(store).toBeDefined();
  const original = collectInputs("frontend").find((input) => input.rel === storeRel)!;
  const overlay = buildProposalOverlay(projects, [
    proposed(
      storeRel,
      original.content.replace("add(dto: CreateBooking): void {", "add(dto: CreateBooking): void {\n    this.loading.set(true);"),
      "modify",
    ),
    proposed(
      "backend/src/usuarios/usuarios.service.ts",
      "export class UsuariosService { crear() {} }",
      "create",
    ),
  ]);
  expect(overlay.notes).toEqual([]);
  expect(overlay.changes.get(`r:${storeRel}:BookingsStore`)).toEqual({
    change: "modified",
    members: { add: "modified" },
  });
  expect(
    overlay.projects[1].result.symbols.some((symbol) => symbol.name === "UsuariosService"),
  ).toBe(true);
  expect(
    overlay.projects[0].result.symbols.some((symbol) => symbol.name === "UsuariosService"),
  ).toBe(false);
  const form = overlay.projects[0].result.symbols.find((s) => s.name === "BookingFormComponent")!;
  const graph = applyChangesToGraph(
    buildFlowGraph(overlay.projects, { projectKey: "frontend", symbolId: form.id, member: "submit" }),
    overlay,
  );
  expect(graph.nodes[1]).toMatchObject({
    change: "modified",
    memberChanges: { add: "modified" },
  });
  expect(graph.nodes.at(-1)?.symbol.name).toBe("Booking");
  expect(graph.pending).toEqual([]);
});

