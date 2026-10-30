// memberRoles: presentation facts derived only from the extraction.
// Language from the real extension, member roles from the extracted
// kind and written signature, lifecycle hooks only with framework
// evidence, signatures split without inventing return types.
import { describe, expect, it } from "vitest";
import type {
  StructureMember,
  StructureRelation,
  StructureSymbol,
} from "../structure/structureTypes";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import {
  detectLifecycleHooks,
  languageBadge,
  memberCounts,
  memberLabel,
  memberRole,
  splitSignature,
} from "./memberRoles";

function member(overrides: Partial<StructureMember> & { name: string }): StructureMember {
  return { kind: "method", detail: "()", ...overrides };
}

function analyze(rel: string, content: string) {
  return analyzeTsFiles([{ rootId: "r", rel, content, hash: "h" }]);
}

function externalsOf(result: ReturnType<typeof analyze>): string[] {
  return (result.files[0].imports ?? [])
    .filter((imp) => imp.status === "external")
    .map((imp) => imp.raw);
}

describe("languageBadge", () => {
  it("names the language from the real extension", () => {
    expect(languageBadge("src/a.service.ts")).toBe("TS");
    expect(languageBadge("src/App.tsx")).toBe("TSX");
    expect(languageBadge("lib/x.mjs")).toBe("JS");
    expect(languageBadge("a/b.component.html")).toBe("HTML");
    expect(languageBadge("a/b.component.scss")).toBe("SCSS");
    expect(languageBadge("styles.css")).toBe("CSS");
    expect(languageBadge("src/main.rs")).toBe("Rust");
    expect(languageBadge("Main.java")).toBe("Java");
    expect(languageBadge("pom.xml")).toBe("XML");
    expect(languageBadge("db/init.sql")).toBe("SQL");
  });

  it("never guesses without an extension", () => {
    expect(languageBadge("Makefile")).toBe("Unknown");
    expect(languageBadge(".env")).toBe("Unknown");
    expect(languageBadge("notes.md")).toBe("MD");
  });
});

describe("memberRole", () => {
  const cls = { kind: "class" as const };

  it("tells constructor, method and property apart from the extraction", () => {
    expect(memberRole(member({ name: "constructor", detail: "(svc: S)" }), cls)).toBe(
      "constructor",
    );
    expect(memberRole(member({ name: "save", detail: "(x: X): void" }), cls)).toBe("method");
    expect(memberRole(member({ name: "count", kind: "field", detail: ": number" }), cls)).toBe(
      "property",
    );
    expect(memberRole(member({ name: "Red", kind: "variant", detail: "Red = 1" }), cls)).toBe(
      "variant",
    );
  });

  it("marks a property holding a function only when the code shows one", () => {
    const fn = (detail: string) =>
      memberRole(member({ name: "f", kind: "field", detail }), cls);
    expect(fn(": (a: string) => void")).toBe("function-property");
    expect(fn("= (x) => x")).toBe("function-property");
    expect(fn("= async (id: string) =>…")).toBe("function-property");
    expect(fn("= async x => x")).toBe("function-property");
    expect(fn("= function named() {…")).toBe("function-property");
    // A truncated initializer that hides the arrow stays a property.
    expect(fn("= (a: string, b: number…")).toBe("property");
    expect(fn("= (value as Thing)")).toBe("property");
    expect(fn(": Handler")).toBe("property");
  });

  it("only treats `constructor` as a constructor on classes", () => {
    expect(memberRole(member({ name: "constructor" }), { kind: "interface" })).toBe("method");
  });
});

describe("splitSignature", () => {
  it("splits TS and Rust call signatures at the top-level parenthesis", () => {
    expect(splitSignature("(id: string, cb: () => void): Promise<Sale>")).toEqual({
      params: "id: string, cb: () => void",
      returns: "Promise<Sale>",
    });
    expect(splitSignature("(&self, n: u32) -> Vec<u8>")).toEqual({
      params: "&self, n: u32",
      returns: "Vec<u8>",
    });
  });

  it("leaves unannotated returns unknown and fields unsplit", () => {
    expect(splitSignature("()")).toEqual({ params: "", returns: null });
    expect(splitSignature("(a: number)")).toEqual({ params: "a: number", returns: null });
    expect(splitSignature(": string")).toEqual({ params: null, returns: null });
    // Truncated by the analyzer before the closing parenthesis.
    expect(splitSignature("(a: VeryLong…")).toEqual({ params: "a: VeryLong…", returns: null });
  });
});

describe("detectLifecycleHooks", () => {
  it("recognizes Angular hooks with the import and the interface", () => {
    const result = analyze(
      "app/list.component.ts",
      `import { Component, OnInit, OnDestroy } from "@angular/core";
@Component({ selector: "x" })
export class ListComponent implements OnInit {
  ngOnInit(): void {}
  ngOnDestroy(): void {}
  ngOnInitLater(): void {}
}`,
    );
    const symbol = result.symbols[0];
    const hooks = detectLifecycleHooks(symbol, result.relations, externalsOf(result));
    expect(hooks.map((hook) => hook.name)).toEqual(["ngOnInit", "ngOnDestroy"]);
    expect(hooks[0].evidence).toBe("implements OnInit; file imports @angular/core");
    // ngOnDestroy has no `implements`: the @Component decorator is the evidence.
    expect(hooks[1].evidence).toBe("@Component class; file imports @angular/core");
  });

  it("never classifies by method name alone", () => {
    const result = analyze(
      "app/plain.ts",
      `export class Plain {
  ngOnInit(): void {}
  onModuleInit(): void {}
}`,
    );
    expect(detectLifecycleHooks(result.symbols[0], result.relations, externalsOf(result))).toEqual(
      [],
    );
  });

  it("requires the interface for NestJS hooks", () => {
    const source = (implementsClause: string) =>
      analyze(
        "src/boot.service.ts",
        `import { Injectable, OnModuleInit } from "@nestjs/common";
@Injectable()
export class BootService ${implementsClause}{
  onModuleInit(): void {}
}`,
      );
    const withIface = source("implements OnModuleInit ");
    expect(
      detectLifecycleHooks(withIface.symbols[0], withIface.relations, externalsOf(withIface)).map(
        (hook) => hook.framework,
      ),
    ).toEqual(["NestJS"]);
    const without = source("");
    expect(
      detectLifecycleHooks(without.symbols[0], without.relations, externalsOf(without)),
    ).toEqual([]);
  });

  it("ignores Rust symbols and non-class kinds", () => {
    const rust = {
      id: "rs",
      language: "rust",
      kind: "struct",
      name: "S",
      rootId: "r",
      rel: "a.rs",
      range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
      members: [member({ name: "ngOnInit" })],
      membersTruncated: false,
      heuristic: null,
    } satisfies StructureSymbol;
    const rel: StructureRelation[] = [];
    expect(detectLifecycleHooks(rust, rel, ["@angular/core"])).toEqual([]);
  });
});

describe("memberCounts and memberLabel", () => {
  it("counts per extracted kind", () => {
    expect(
      memberCounts([
        member({ name: "constructor" }),
        member({ name: "a" }),
        member({ name: "b", kind: "field", detail: ": x" }),
        member({ name: "C", kind: "variant", detail: "C" }),
      ]),
    ).toEqual({ methods: 2, properties: 1, variants: 1 });
  });

  it("writes only modifiers present in the code", () => {
    expect(memberLabel(member({ name: "run", detail: "(): void" }))).toBe("run(): void");
    expect(
      memberLabel(
        member({
          name: "repo",
          kind: "field",
          detail: ": Repo",
          visibility: "private",
          isReadonly: true,
        }),
      ),
    ).toBe("private readonly repo : Repo");
  });
});
