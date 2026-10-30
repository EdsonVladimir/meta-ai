// Map model: layering, decorator refinement, edge aggregation, unresolved
// refs, externals, skipped files and truncation flags.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { StructureInput, StructureResult } from "../structure/structureTypes";
import { buildArchMap } from "./archModel";

function input(rel: string, content: string): StructureInput {
  return { rootId: "root-1", rel, content, hash: `h:${rel}` };
}

function mini(): StructureResult {
  return analyzeTsFiles([
    input(
      "src/sales.controller.ts",
      `import { SalesService } from "./sales.service";
import { Controller, Get } from "@nestjs/common";
@Controller("sales")
export class SalesController {
  constructor(private readonly svc: SalesService) {}
  @Get()
  list() { return this.svc.all(); }
}`,
    ),
    input(
      "src/sales.service.ts",
      `import { Injectable } from "@nestjs/common";
import { SaleDto } from "./dto/sale.dto";
@Injectable()
export class SalesService {
  all(): SaleDto[] { return []; }
}`,
    ),
    input("src/dto/sale.dto.ts", "export class SaleDto { total: number; }"),
  ]);
}

describe("buildArchMap", () => {
  it("layers files and refines with decorators", () => {
    const map = buildArchMap(mini());
    expect(map.files.map((f) => `${f.rel}=${f.layer}`)).toEqual([
      "src/sales.controller.ts=controllers",
      "src/sales.service.ts=services",
      "src/dto/sale.dto.ts=contracts",
    ]);
    const controller = map.files[0];
    expect(controller.layerReason).toContain("suffix");
    expect(controller.symbols.map((s) => s.name)).toEqual(["SalesController"]);
    expect(controller.symbols[0].decorators).toEqual(["Controller"]);
  });

  it("aggregates imports and symbol relations into file edges", () => {
    const map = buildArchMap(mini());
    const at = (from: string, to: string) =>
      map.edges.find((e) => e.fromRel === from && e.toRel === to);
    const ctrlSvc = at("src/sales.controller.ts", "src/sales.service.ts");
    expect(ctrlSvc?.kinds.map((k) => k.kind).sort()).toEqual(["imports", "references"]);
    expect(ctrlSvc?.evidence).toContain("imports");
    const svcDto = at("src/sales.service.ts", "src/dto/sale.dto.ts");
    expect(svcDto?.kinds.map((k) => k.kind).sort()).toEqual(["imports", "references"]);
    // No self-edges, no phantom edges.
    expect(map.edges.every((e) => e.fromRel !== e.toRel)).toBe(true);
    expect(map.edges).toHaveLength(2);
  });

  it("collects externals with user counts", () => {
    const map = buildArchMap(mini());
    expect(map.externals).toEqual([{ raw: "@nestjs/common", usedBy: 2 }]);
    expect(map.externalsTruncated).toBe(false);
  });

  it("lists skipped files instead of dropping them silently", () => {
    const broken: StructureResult = {
      ...mini(),
      files: [
        {
          rootId: "root-1",
          rel: "bad.ts",
          hash: "",
          bytes: 0,
          language: null,
          status: "error",
          message: "boom",
        },
      ],
      symbols: [],
      relations: [],
    };
    const map = buildArchMap(broken);
    expect(map.files).toHaveLength(0);
    expect(map.skipped).toEqual([{ rel: "bad.ts", reason: "boom" }]);
  });

  it("flags truncation instead of hiding it", () => {
    // Past the analyzer's own file cap: build the oversized result by hand.
    const base = analyzeTsFiles([input("src/a.service.ts", "export class A {}")]);
    const files = Array.from({ length: 210 }, (_, i) => ({
      rootId: "root-1",
      rel: `src/f${i}.service.ts`,
      hash: `h${i}`,
      bytes: 10,
      language: "ts" as const,
      status: "ok" as const,
      message: null,
    }));
    const map = buildArchMap({ ...base, files });
    expect(map.files).toHaveLength(200);
    expect(map.filesTruncated).toBe(true);
  });
});

describe("buildArchMap symbols", () => {
  it("emits one node per symbol with its own layer", () => {
    const map = buildArchMap(mini());
    expect(map.nodes.map((n) => `${n.symbol.name}=${n.layer}`)).toEqual([
      "SalesController=controllers",
      "SalesService=services",
      "SaleDto=contracts",
    ]);
    const controller = map.nodes[0];
    expect(controller.rootId).toBe("root-1");
    expect(controller.rel).toBe("src/sales.controller.ts");
    expect(controller.id).toBe(controller.symbol.id);
    expect(controller.layerReason).toContain("@Controller");
    // One file with one type keeps file and symbol layers apart.
    expect(map.files[0].layer).toBe("controllers");
  });

  it("classifies symbols sharing a file independently", () => {
    const result = analyzeTsFiles([
      input(
        "src/shop.service.ts",
        `import { Injectable } from "@nestjs/common";
export interface OrderDto { id: string; }
@Injectable()
export class ShopService { all(): OrderDto[] { return []; } }`,
      ),
    ]);
    const map = buildArchMap(result);
    expect(map.nodes.map((n) => `${n.symbol.name}=${n.layer}`)).toEqual([
      "OrderDto=contracts",
      "ShopService=services",
    ]);
  });

  it("links resolved symbol relations without file imports", () => {
    const map = buildArchMap(mini());
    const byName = new Map(map.nodes.map((n) => [n.symbol.name, n.id]));
    const pairs = map.symbolEdges.map((e) => `${e.from}=>${e.to}`);
    expect(pairs).toContain(`${byName.get("SalesController")}=>${byName.get("SalesService")}`);
    expect(pairs).toContain(`${byName.get("SalesService")}=>${byName.get("SaleDto")}`);
    expect(map.symbolEdges.every((e) => e.from !== e.to)).toBe(true);
    expect(map.symbolEdges.flatMap((e) => e.kinds.map((k) => k.kind))).not.toContain("imports");
    expect(map.symbolEdges[0].evidence.length).toBeGreaterThan(0);
  });

  it("keeps unresolved references per symbol with no invented targets", () => {
    const result = analyzeTsFiles([
      input("src/broken.ts", "export class Broken { load(): Missing { throw 0; } }"),
    ]);
    const map = buildArchMap(result);
    expect(map.nodes).toHaveLength(1);
    expect(map.nodes[0].symbol.unresolved).toEqual([
      { toName: "Missing", kind: "references", status: "unresolved" },
    ]);
    expect(map.symbolEdges).toHaveLength(0);
    expect(map.files[0].unresolved.map((u) => u.toName)).toContain("Missing");
  });

  it("carries rich members with their own flags", () => {
    const map = buildArchMap(mini());
    const service = map.nodes.find((n) => n.symbol.name === "SalesService")!;
    expect(service.symbol.members).toEqual([
      { name: "all", kind: "method", detail: "(): SaleDto[]" },
    ]);
    expect(service.symbol.membersTruncated).toBe(false);
    expect(service.symbol.rootId).toBe("root-1");
    expect(service.symbol.rel).toBe("src/sales.service.ts");
  });

  it("draws no nodes for symbol-less files", () => {
    const result = analyzeTsFiles([input("src/empty.ts", "export {};")]);
    const map = buildArchMap(result);
    expect(map.files.map((f) => f.rel)).toEqual(["src/empty.ts"]);
    expect(map.nodes).toHaveLength(0);
  });

  it("flags symbol and symbol-edge truncation", () => {
    const base = analyzeTsFiles([input("src/a.ts", "export class A {}")]);
    const symbols = Array.from({ length: 1100 }, (_, i) => ({
      ...base.symbols[0],
      id: `s${i}`,
      name: `C${i}`,
      rel: "src/many.ts",
    }));
    const files = [
      {
        rootId: "root-1",
        rel: "src/many.ts",
        hash: "h",
        bytes: 10,
        language: "ts" as const,
        status: "ok" as const,
        message: null,
      },
    ];
    const map = buildArchMap({ ...base, files, symbols, relations: [] });
    expect(map.nodes).toHaveLength(1000);
    expect(map.nodesTruncated).toBe(true);
    expect(map.symbolEdgesTruncated).toBe(false);
  });

  it("resolves @Module metadata into membership, strictly", () => {
    const map = buildArchMap(
      analyzeTsFiles([
        input(
          "src/sales.module.ts",
          `import { Module } from "@nestjs/common";
@Module({ controllers: [SalesController], providers: [SalesService], imports: [MissingModule] })
export class SalesModule {}`,
        ),
        input("src/sales.controller.ts", "export class SalesController {}"),
        input("src/sales.service.ts", "export class SalesService {}"),
      ]),
    );
    expect(map.modules).toHaveLength(1);
    const mod = map.modules[0];
    expect(mod.name).toBe("SalesModule");
    expect(mod.memberIds).toHaveLength(3);
    expect(mod.unresolved).toEqual([{ name: "MissingModule", role: "imports" }]);
    expect(mod.ambiguous).toEqual([]);
    // The module class itself leads the membership.
    expect(mod.memberIds[0]).toBe(mod.symbolId);
  });

  it("marks repeated metadata names ambiguous, never guessed", () => {
    const map = buildArchMap(
      analyzeTsFiles([
        input(
          "src/sales.module.ts",
          `import { Module } from "@nestjs/common";
@Module({ providers: [Helper] })
export class SalesModule {}`,
        ),
        input("src/a.ts", "export class Helper {}"),
        input("src/b.ts", "export class Helper {}"),
      ]),
    );
    expect(map.modules).toHaveLength(1);
    expect(map.modules[0].memberIds).toHaveLength(1);
    expect(map.modules[0].ambiguous).toEqual([{ name: "Helper", role: "providers" }]);
  });

  it("keeps bare @Module classes with their opaque counts", () => {
    const map = buildArchMap(
      analyzeTsFiles([
        input(
          "src/sales.module.ts",
          `import { Module } from "@nestjs/common";
@Module({ imports: [TypeOrmModule.forRoot({})] })
export class SalesModule {}`,
        ),
      ]),
    );
    expect(map.modules).toHaveLength(1);
    expect(map.modules[0].memberIds).toHaveLength(1);
    expect(map.modules[0].opaque).toBe(1);
  });

  it("reports no modules without module declarations", () => {
    expect(buildArchMap(mini()).modules).toEqual([]);
  });
});
