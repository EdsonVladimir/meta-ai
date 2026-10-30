import { describe, expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";
import type { StructureInput } from "./structureTypes";

function input(rootId: string, rel: string, content: string): StructureInput {
  return { rootId, rel, content, hash: `h:${rel}` };
}

describe("analyzeTsFiles", () => {
  it("extracts classes, interfaces, extends and implements", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "model.ts",
        `export interface Named { name: string; greet(): void; }
export class Person implements Named {
  name = "";
  age: number;
  greet() {}
}
export class Employee extends Person {
  salary = 0;
}`,
      ),
    ]);
    expect(result.files[0].status).toBe("ok");
    expect(result.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "interface:Named",
      "class:Person",
      "class:Employee",
    ]);
    const person = result.symbols[1];
    expect(person.members.map((m) => `${m.kind}:${m.name}`)).toEqual([
      "field:name",
      "field:age",
      "method:greet",
    ]);
    const kinds = result.relations.map((r) => `${r.kind}:${r.toName}=${r.status}`);
    expect(kinds).toContain("implements:Named=resolved");
    expect(kinds).toContain("extends:Person=resolved");
    // The resolved relation points at the real symbol.
    const impl = result.relations.find((r) => r.kind === "implements");
    expect(impl?.to).toBe(result.symbols[0].id);
  });

  it("does not connect equal names in different files (ambiguous)", () => {
    const result = analyzeTsFiles([
      input("root-1", "a.ts", "export class Store { a = 1; }"),
      input("root-1", "b.ts", "export class Store { b = 2; }\nexport class Uses { s: Store; }"),
    ]);
    const names = result.symbols.filter((s) => s.name === "Store");
    expect(names).toHaveLength(2);
    const ref = result.relations.find((r) => r.kind === "references" && r.toName === "Store");
    expect(ref?.status).toBe("ambiguous");
    expect(ref?.to).toBeNull();
  });

  it("marks external references as unresolved with evidence", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "a.ts",
        `import { External } from "./other";
export class A { dep: External; count: number; }`,
      ),
    ]);
    const ref = result.relations.find((r) => r.toName === "External");
    expect(ref?.status).toBe("unresolved");
    expect(ref?.to).toBeNull();
    expect(ref?.evidence).toContain("a.ts:2");
  });

  it("tells functions and components from classes apart", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "ui.tsx",
        `export function helper(x: number) { return x; }
export function Card() { return null; }
export const Button = (props: object) => null;
export const lower = () => 1;
export class Real {}`,
      ),
    ]);
    expect(result.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual([
      "function:helper",
      "component:Card",
      "component:Button",
      "function:lower",
      "class:Real",
    ]);
    expect(result.symbols[1].heuristic).toContain("heuristic");
    expect(result.symbols[2].heuristic).toContain("heuristic");
    expect(result.symbols[0].heuristic).toBeNull();
  });

  it("tolerates syntax errors with a partial result", () => {
    const result = analyzeTsFiles([
      input("root-1", "bad.ts", "export class Fine { a = 1; }\nexport class Broken { b = ; }"),
    ]);
    expect(result.files[0].status).toBe("partial");
    expect(result.files[0].message).toContain("Partial syntax");
    expect(result.symbols.map((s) => s.name)).toContain("Fine");
  });

  it("a broken file does not hide the valid ones", () => {
    const result = analyzeTsFiles([
      input("root-1", "ok.ts", "export class Ok {}"),
      input("root-1", "bad.ts", "export class {{{"),
    ]);
    expect(result.symbols.map((s) => `${s.rel}:${s.name}`)).toContain("ok.ts:Ok");
    expect(result.files).toHaveLength(2);
  });

  it("IDs and relations are reproducible", () => {
    const files = [
      input("root-1", "a.ts", "export interface I { x: string; }\nexport class C implements I { x = ''; }"),
      input("root-2", "b.ts", "export class D extends C {}"),
    ];
    const first = analyzeTsFiles(files);
    const second = analyzeTsFiles(files);
    expect(second).toEqual(first);
    // D→C resolves across files: C is unique.
    const ext = first.relations.find((r) => r.kind === "extends");
    expect(ext?.status).toBe("resolved");
  });

  it("respects limits with a truncation notice", () => {
    const many = Array.from({ length: 350 }, (_, i) => `export class C${i} {}`).join("\n");
    const result = analyzeTsFiles([input("root-1", "many.ts", many)]);
    expect(result.symbols).toHaveLength(300);
    expect(result.symbolsTruncated).toBe(true);
  });

  it("records 1-based ranges usable by the editor", () => {
    const result = analyzeTsFiles([input("root-1", "a.ts", "const x = 1;\nexport class C {}")]);
    expect(result.symbols[0].range).toMatchObject({ startLine: 2, startCol: 1 });
    expect(result.symbols[0].range.endLine).toBe(2);
  });

  it("detects Express/Hono routes by shape", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "server.ts",
        `import express from "express";
const app = express();
app.get("/users", (req, res) => {});
app.post("/users/:id", handler);
router.delete("/users/:id", handler);
app.all("/health", handler);
app.use("/static", files);
app.get(variable, handler);`,
      ),
    ]);
    expect(result.endpoints.map((e) => `${e.method} ${e.url}`)).toEqual([
      "GET /users",
      "POST /users/:id",
      "DELETE /users/:id",
      "ALL /health",
    ]);
    expect(result.endpoints[0].evidence).toContain("server.ts:3");
    expect(result.endpoints[0].range.startLine).toBe(3);
    expect(result.calls).toEqual([]);
  });

  it("detects fetch and axios calls with a method", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "client.ts",
        `const a = await fetch("/users");
const b = await fetch("/users/1", { method: "POST" });
const c = await axios.get("/users");
const d = await axios.delete(\`/users/\${id}\`);
const e = await axios({ url: "/login", method: "post" });
const f = await fetch(API_URL + "/x");`,
      ),
    ]);
    expect(result.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET /users",
      "POST /users/1",
      "GET /users",
      "DELETE /users/${...}",
      "POST /login",
    ]);
    expect(result.calls[0].evidence).toContain("fetch");
    expect(result.endpoints).toEqual([]);
  });

  it("absolute calls are kept to separate them as external", () => {
    const result = analyzeTsFiles([
      input("root-1", "ext.ts", `fetch("https://api.example.com/v1/x");`),
    ]);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].url).toBe("https://api.example.com/v1/x");
  });

  it("routes inside methods are detected too", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "app.ts",
        `export class App {
  register(router: Router) {
    router.put("/items/:id", this.update);
  }
}`,
      ),
    ]);
    expect(result.endpoints.map((e) => `${e.method} ${e.url}`)).toEqual([
      "PUT /items/:id",
    ]);
    expect(result.symbols.map((s) => s.name)).toContain("App");
  });
});

describe("analyzeTsFiles arch map additions", () => {
  it("resolves relative imports against the scope", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "src/app.controller.ts",
        `import { SalesService } from "./sales.service";
import { Dto } from "./dto";
import "reflect-metadata";
export * from "./reexported";`,
      ),
      input("root-1", "src/sales.service.ts", "export class SalesService {}"),
      input("root-1", "src/dto/index.ts", "export class Dto {}"),
    ]);
    const file = result.files.find((f) => f.rel === "src/app.controller.ts");
    const imports = file?.imports ?? [];
    expect(imports.map((i) => `${i.raw}=${i.status}:${i.resolvedRel ?? ""}`)).toEqual([
      "./sales.service=resolved:src/sales.service.ts",
      "./dto=resolved:src/dto/index.ts",
      "reflect-metadata=external:",
      "./reexported=missing:",
    ]);
    expect(imports[0].line).toBe(1);
  });

  it("never resolves across roots and treats escapes as missing", () => {
    const result = analyzeTsFiles([
      input("root-1", "a.ts", `import { X } from "./b";`),
      input("root-2", "b.ts", "export const X = 1;"),
      input("root-1", "deep/c.ts", `import { Y } from "../../nope";`),
    ]);
    expect(result.files[0].imports).toEqual([
      { raw: "./b", resolvedRel: null, status: "missing", line: 1 },
    ]);
    expect(result.files[2].imports?.[0].status).toBe("missing");
  });

  it("records decorator names on classes", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "src/app.controller.ts",
        `import { Controller, Get } from "@nestjs/common";
@Controller("sales")
export class SalesController {
  @Get()
  list() { return []; }
}`,
      ),
    ]);
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].decorators).toEqual(["Controller"]);
  });

  it("emits instantiates for new inside symbol bodies", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "a.ts",
        `import { Engine } from "./engine";
export class Car {
  start() { return new Engine(); }
}`,
      ),
      input("root-1", "engine.ts", "export class Engine {}"),
    ]);
    const inst = result.relations.find((r) => r.kind === "instantiates");
    expect(inst?.toName).toBe("Engine");
    expect(inst?.status).toBe("resolved");
    expect(inst?.evidence).toContain("new Engine");
    const car = result.symbols.find((s) => s.name === "Car");
    expect(inst?.from).toBe(car?.id);
  });

  it("extracts enums with their variants", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "enums.ts",
        `export enum DataKind {
  TEXT = 'text',
  NUMERIC = 'numeric',
}`,
      ),
    ]);
    expect(result.symbols.map((s) => `${s.kind}:${s.name}`)).toEqual(["enum:DataKind"]);
    expect(result.symbols[0].members.map((m) => `${m.kind}:${m.name}`)).toEqual([
      "variant:TEXT",
      "variant:NUMERIC",
    ]);
  });

  it("resolves .js specifiers to .ts files", () => {
    const result = analyzeTsFiles([
      input("root-1", "a.ts", `import { x } from "./b.js";`),
      input("root-1", "b.ts", "export const x = 1;"),
    ]);
    expect(result.files[0].imports).toEqual([
      { raw: "./b.js", resolvedRel: "b.ts", status: "resolved", line: 1 },
    ]);
  });
});

describe("analyzeTsFiles members", () => {
  const ACCOUNT = `export class Account {
  constructor(private readonly id: string, tag: string) {}
  public balance = 0;
  #secret = 1;
  protected static kind = "x";
  static async load(id: string): Promise<Account> { return new Account(id, ""); }
  async save(): Promise<void> {}
  private reset(): void {}
}`;

  function accountMembers() {
    const result = analyzeTsFiles([input("root-1", "account.ts", ACCOUNT)]);
    expect(result.files[0].status).toBe("ok");
    expect(result.symbols.map((s) => s.name)).toEqual(["Account"]);
    return result.symbols[0].members;
  }

  it("reads visibility, static, async and readonly as written", () => {
    const byName = new Map(accountMembers().map((m) => [m.name, m]));
    expect(byName.get("balance")).toMatchObject({ kind: "field", visibility: "public" });
    expect(byName.get("kind")).toMatchObject({
      kind: "field",
      visibility: "protected",
      isStatic: true,
    });
    expect(byName.get("load")).toMatchObject({ kind: "method", isStatic: true, isAsync: true });
    expect(byName.get("save")).toMatchObject({ kind: "method", isAsync: true });
    expect(byName.get("save")?.isStatic).toBeUndefined();
    expect(byName.get("reset")).toMatchObject({ kind: "method", visibility: "private" });
    // `#secret` carries no modifier: the name says it all.
    expect(byName.get("#secret")).toMatchObject({ kind: "field" });
    expect(byName.get("#secret")?.visibility).toBeUndefined();
  });

  it("lists constructor parameter properties as fields", () => {
    const byName = new Map(accountMembers().map((m) => [m.name, m]));
    expect(byName.get("constructor")?.kind).toBe("method");
    expect(byName.get("id")).toMatchObject({
      kind: "field",
      visibility: "private",
      isReadonly: true,
      detail: ": string",
    });
    // Plain parameters are not properties.
    expect(byName.has("tag")).toBe(false);
  });

  it("trims signatures to params and return, never bodies", () => {
    const byName = new Map(accountMembers().map((m) => [m.name, m]));
    expect(byName.get("load")?.detail).toBe("(id: string): Promise<Account>");
    expect(byName.get("save")?.detail).toBe("(): Promise<void>");
    expect(byName.get("balance")?.detail).toBe("= 0");
    expect(byName.get("constructor")?.detail).toBe("(private readonly id: string, tag: string)");
  });
});

describe("analyzeTsFiles module metadata", () => {
  const SALES = `import { Module } from "@nestjs/common";
@Module({
  imports: [AuthModule],
  controllers: [SalesController],
  providers: [SalesService, Helper],
  exports: [SalesService],
})
export class SalesModule {}`;

  function moduleOf(content: string) {
    const result = analyzeTsFiles([input("root-1", "sales/sales.module.ts", content)]);
    expect(result.files[0].status).toBe("ok");
    const found = result.symbols.find((s) => s.decorators?.includes("Module"));
    expect(found).toBeDefined();
    return found!;
  }

  it("reads @Module metadata identifiers per role", () => {
    const mod = moduleOf(SALES);
    expect(mod.moduleRefs).toEqual([
      { role: "imports", name: "AuthModule" },
      { role: "controllers", name: "SalesController" },
      { role: "providers", name: "SalesService" },
      { role: "providers", name: "Helper" },
      { role: "exports", name: "SalesService" },
    ]);
    expect(mod.moduleOpaque).toBeUndefined();
  });

  it("counts dynamic metadata entries as opaque, never guessed", () => {
    const mod = moduleOf(`import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
@Module({
  imports: [TypeOrmModule.forRoot({}), ...extra],
  providers: [forwardRef(() => SalesService)],
})
export class SalesModule {}`);
    expect(mod.moduleRefs).toBeUndefined();
    expect(mod.moduleOpaque).toBe(3);
  });

  it("reads @NgModule metadata the same way", () => {
    const result = analyzeTsFiles([
      input(
        "root-1",
        "sales/sales.module.ts",
        `import { NgModule } from "@angular/core";
@NgModule({ declarations: [SalesPage], providers: [SalesService] })
export class SalesModule {}`,
      ),
    ]);
    const found = result.symbols.find((s) => s.decorators?.includes("NgModule"));
    expect(found?.moduleRefs).toEqual([
      { role: "declarations", name: "SalesPage" },
      { role: "providers", name: "SalesService" },
    ]);
  });

  it("omits module fields without module decorators or metadata", () => {
    const result = analyzeTsFiles([
      input("root-1", "plain.ts", `export class Plain {}\n@Module()\nexport class Bare {}`),
    ]);
    for (const symbol of result.symbols) {
      expect(symbol.moduleRefs).toBeUndefined();
      expect(symbol.moduleOpaque).toBeUndefined();
    }
  });
});
