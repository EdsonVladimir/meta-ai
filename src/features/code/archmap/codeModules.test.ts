// Code modules: declared/manual/directory options with drawn
// membership, strict honesty (no invented modules), reference
// neighbors capped with honest totals.
import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { StructureInput } from "../structure/structureTypes";
import type { CodeLinkDto } from "../types";
import type { ModuleDto } from "../../requirements/types";
import { buildArchMap } from "./archModel";
import {
  buildModuleIndex,
  moduleReferenceIds,
  resolveManualModules,
  type ModuleSource,
} from "./codeModules";

function input(rel: string, content: string): StructureInput {
  return { rootId: "be", rel, content, hash: `h:${rel}` };
}

const SALES = [
  input(
    "src/sales/sales.module.ts",
    `import { Module } from "@nestjs/common";
@Module({ controllers: [SalesController], providers: [SalesService] })
export class SalesModule {}`,
  ),
  input("src/sales/sales.controller.ts", "export class SalesController {}"),
  input("src/sales/sales.service.ts", "export class SalesService {}"),
  input("src/billing/billing.service.ts", "export class BillingService {}"),
  input("src/main.ts", "export function boot(): void {}"),
];

function source(relScope = ""): ModuleSource {
  return {
    rootId: "be",
    rootName: "backend",
    scopeRel: relScope,
    map: buildArchMap(analyzeTsFiles(SALES)),
  };
}

function link(overrides: Partial<CodeLinkDto> & { ownerId: string; rel: string }): CodeLinkDto {
  return {
    id: `link-${overrides.ownerId}-${overrides.rel}`,
    scope: "module",
    rootId: "be",
    rootName: "backend",
    rootMissing: false,
    symbol: null,
    kind: "manual",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function mod(id: string, name: string, archived = false): ModuleDto {
  return { id, projectId: "p1", name, archived };
}

describe("resolveManualModules", () => {
  it("groups live module links by owner, skipping the rest", () => {
    const manual = resolveManualModules(
      [mod("m1", "Ventas"), mod("m2", "Old", true)],
      [
        link({ ownerId: "m1", rel: "src/sales" }),
        link({ ownerId: "m1", rel: "src/billing/billing.service.ts" }),
        link({ ownerId: "m2", rel: "src/sales" }),
        link({ ownerId: "m9", rel: "src/sales" }),
        { ...link({ ownerId: "m1", rel: "src/gone" }), rootMissing: true },
        { ...link({ ownerId: "m1", rel: "src/other" }), scope: "artifact" },
      ],
    );
    expect(manual).toHaveLength(1);
    expect(manual[0].name).toBe("Ventas");
    expect(manual[0].paths.map((p) => p.rel).sort()).toEqual([
      "src/billing/billing.service.ts",
      "src/sales",
    ]);
  });
});

describe("buildModuleIndex", () => {
  it("offers declared modules with metadata membership", () => {
    const index = buildModuleIndex([source()], []);
    const declared = index.options.filter((o) => o.kind === "declared");
    expect(declared).toHaveLength(1);
    expect(declared[0].label).toBe("SalesModule");
    expect(declared[0].symbols).toBe(3);
    expect(declared[0].criterion).toContain("@Module");
    expect(declared[0].criterion).toContain("3 symbols");
    const ids = index.members.get(declared[0].key) ?? new Set();
    const names = [...ids]
      .map((id) => source().map.nodes.find((n) => n.id === id)?.symbol.name)
      .sort();
    expect(names).toEqual(["SalesController", "SalesModule", "SalesService"]);
  });

  it("labels folder proximity as directory groups, never modules", () => {
    const index = buildModuleIndex([source()], []);
    const dirs = index.options.filter((o) => o.kind === "directory");
    expect(dirs.map((o) => o.label).sort()).toEqual(["(Top level)", "billing", "sales"]);
    for (const dir of dirs) {
      expect(dir.criterion).toContain("not a declared module");
    }
    const sales = dirs.find((o) => o.label === "sales")!;
    expect(sales.symbols).toBe(3);
    expect(sales.criterion).toContain("src/sales/");
  });

  it("derives manual options from existing links only", () => {
    const manual = resolveManualModules(
      [mod("m1", "Ventas")],
      [link({ ownerId: "m1", rel: "src/sales" })],
    );
    const index = buildModuleIndex([source()], manual);
    const found = index.options.filter((o) => o.kind === "manual");
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Ventas");
    expect(found[0].symbols).toBe(3);
    expect(found[0].criterion).toContain('Ruth module "Ventas"');
    // Links outside the scope are counted, never invented into members.
    const stale = resolveManualModules(
      [mod("m1", "Ventas")],
      [link({ ownerId: "m1", rel: "src/sales" }), link({ ownerId: "m1", rel: "src/nowhere" })],
    );
    const again = buildModuleIndex([source()], stale);
    const option = again.options.find((o) => o.kind === "manual")!;
    expect(option.symbols).toBe(3);
    expect(option.criterion).toContain("1 link outside this scope or unmatched");
  });

  it("narrows symbol links to one name+kind", () => {
    const manual = resolveManualModules(
      [mod("m1", "Ventas")],
      [
        {
          ...link({ ownerId: "m1", rel: "src/sales/sales.service.ts" }),
          symbol: {
            id: "s1",
            name: "SalesService",
            kind: "class",
            startLine: 1,
            startCol: 1,
            endLine: 1,
            endCol: 1,
            hash: "h",
          },
        },
      ],
    );
    const index = buildModuleIndex([source()], manual);
    const found = index.options.find((o) => o.kind === "manual")!;
    expect(found.symbols).toBe(1);
  });

  it("relativizes directory groups to nested scopes", () => {
    const nested: ModuleSource = {
      rootId: "acme",
      rootName: "acme",
      scopeRel: "apps/be",
      map: buildArchMap(
        analyzeTsFiles([
          {
            rootId: "acme",
            rel: "apps/be/src/sales/x.ts",
            content: "export class X {}",
            hash: "h",
          },
          {
            rootId: "acme",
            rel: "apps/be/src/main.ts",
            content: "export function boot(): void {}",
            hash: "h",
          },
        ]),
      ),
    };
    const index = buildModuleIndex([nested], []);
    expect(index.options.map((o) => o.label).sort()).toEqual(["(Top level)", "sales"]);
  });

  it("tracks multiple memberships per symbol", () => {
    const manual = resolveManualModules(
      [mod("m1", "Ventas")],
      [link({ ownerId: "m1", rel: "src/sales" })],
    );
    const index = buildModuleIndex([source()], manual);
    const svc = source().map.nodes.find((n) => n.symbol.name === "SalesService")!;
    expect(index.memberships.get(svc.id)?.sort()).toEqual([
      "SalesModule (declared module)",
      "Ventas (linked module)",
      "sales (directory group)",
    ]);
    const boot = source().map.nodes.find((n) => n.symbol.name === "boot")!;
    expect(index.memberships.get(boot.id)).toEqual(["(Top level) (directory group)"]);
  });

  it("disambiguates repeated labels with root names", () => {
    const other: ModuleSource = {
      rootId: "fe",
      rootName: "frontend",
      scopeRel: "",
      map: buildArchMap(
        analyzeTsFiles([
          { rootId: "fe", rel: "src/sales/y.ts", content: "export class Y {}", hash: "h" },
        ]),
      ),
    };
    const index = buildModuleIndex([source(), other], []);
    const sales = index.options.filter((o) => o.kind === "directory" && o.label.includes("sales"));
    expect(sales.map((o) => o.label).sort()).toEqual(["sales (backend)", "sales (frontend)"]);
  });
});

describe("moduleReferenceIds", () => {
  it("collects direct neighbors outside the module, capped", () => {
    const map = buildArchMap(
      analyzeTsFiles([
        input("src/a.ts", `import { B } from "./b";\nexport class A { b = new B(); }`),
        input("src/b.ts", "export class B {}"),
      ]),
    );
    const sources: ModuleSource[] = [
      { rootId: "be", rootName: "backend", scopeRel: "", map },
    ];
    const a = map.nodes.find((n) => n.symbol.name === "A")!.id;
    const refs = moduleReferenceIds(sources, new Set([a]));
    expect(refs.total).toBe(1);
    const b = map.nodes.find((n) => n.symbol.name === "B")!.id;
    expect([...refs.ids]).toEqual([b]);
    // Members never reference themselves; the cap keeps the total honest.
    const capped = moduleReferenceIds(sources, new Set([a]), 0);
    expect(capped.total).toBe(1);
    expect(capped.ids.size).toBe(0);
  });
});
