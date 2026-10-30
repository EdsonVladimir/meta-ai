// projectMaps: project roots, extension filter and the recursive
// collector (caps, order, app code before tests/config, skipped
// kinds), all without Tauri.
import { describe, expect, it } from "vitest";
import type { CodeEntryDto, CodeListingDto, CodeRootDto } from "../types";
import {
  allRootsOfProject,
  collectTsScope,
  isSecondaryFile,
  isTsFile,
  rootsOfProject,
  PROJECT_MAP_MAX_DIRS,
  PROJECT_MAP_MAX_FILES,
} from "./projectMaps";

function root(overrides: Partial<CodeRootDto> & { id: string }): CodeRootDto {
  return {
    path: `/repo/${overrides.id}`,
    name: overrides.id,
    missing: false,
    projectId: null,
    ...overrides,
  };
}

function listing(entries: CodeEntryDto[], truncated = false): CodeListingDto {
  return { entries, truncated };
}

function file(rel: string): CodeEntryDto {
  return { name: rel.split("/").pop() ?? rel, rel, kind: "file", size: 10 };
}

function dir(rel: string): CodeEntryDto {
  return { name: rel.split("/").pop() ?? rel, rel, kind: "dir", size: null };
}

describe("isTsFile", () => {
  it.each([
    ["src/a.ts", true],
    ["src/a.tsx", true],
    ["src/a.mts", true],
    ["src/a.cts", true],
    ["src/A.TS", true],
    ["src/a.js", false],
    ["src/a.ts.map", false],
    ["src/a.d", false],
    ["README.md", false],
  ])("%s -> %s", (rel, expected) => {
    expect(isTsFile(rel as string)).toBe(expected);
  });
});

describe("rootsOfProject", () => {
  it("keeps associated on-disk roots in workspace order", () => {
    const roots = [
      root({ id: "a", projectId: "p1" }),
      root({ id: "b", projectId: "p2" }),
      root({ id: "c", projectId: "p1", missing: true }),
      root({ id: "d" }),
      root({ id: "e", projectId: "p1" }),
    ];
    expect(rootsOfProject(roots, "p1").map((r) => r.id)).toEqual(["a", "e"]);
    expect(allRootsOfProject(roots, "p1").map((r) => r.id)).toEqual(["a", "c", "e"]);
  });
});

describe("collectTsScope", () => {
  it("walks breadth-first in listing order, TypeScript only", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([dir("src"), file("main.ts"), file("notes.md")]),
      src: listing([dir("src/app"), file("src/util.ts")]),
      "src/app": listing([file("src/app/app.ts")]),
    };
    const collected = await collectTsScope("r1", async (_root, rel) => tree[rel]);
    expect(collected.files.map((f) => f.rel)).toEqual([
      "main.ts",
      "src/util.ts",
      "src/app/app.ts",
    ]);
    expect(collected.truncated).toBe(false);
    expect(collected.dirsVisited).toBe(3);
  });

  it("skips symlinks and other non file/dir kinds without following them", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([
        { name: "link", rel: "link", kind: "other", size: null },
        file("a.ts"),
      ]),
    };
    const seen: string[] = [];
    const collected = await collectTsScope("r1", async (_root, rel) => {
      seen.push(rel);
      return tree[rel];
    });
    expect(collected.files.map((f) => f.rel)).toEqual(["a.ts"]);
    expect(seen).toEqual([""]);
  });

  it("collects application code before tests, e2e and config", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([dir("e2e"), dir("src"), file("playwright.config.ts")]),
      e2e: listing([file("e2e/fixtures.ts"), file("e2e/login.spec.ts")]),
      src: listing([
        dir("src/app"),
        dir("src/environments"),
        file("src/main.ts"),
      ]),
      "src/app": listing([
        file("src/app/app.component.spec.ts"),
        file("src/app/app.component.ts"),
        file("src/app/auth.service.ts"),
      ]),
      "src/environments": listing([file("src/environments/environment.ts")]),
    };
    const collected = await collectTsScope("r1", async (_root, rel) => tree[rel]);
    expect(collected.files.map((f) => f.rel)).toEqual([
      "src/main.ts",
      "src/app/app.component.ts",
      "src/app/auth.service.ts",
      // Secondary files keep their walk order, after all app code.
      "playwright.config.ts",
      "e2e/fixtures.ts",
      "e2e/login.spec.ts",
      "src/app/app.component.spec.ts",
      "src/environments/environment.ts",
    ]);
    expect(collected.truncated).toBe(false);
  });

  it("fills the file cap with application code first", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([dir("e2e"), dir("src")]),
      e2e: listing([file("e2e/a.spec.ts"), file("e2e/b.spec.ts")]),
      src: listing([file("src/a.ts"), file("src/b.ts"), file("src/c.ts")]),
    };
    const capped = await collectTsScope("r1", async (_root, rel) => tree[rel], 2);
    expect(capped.files.map((f) => f.rel)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(capped.truncated).toBe(true);
    // Room left after the app code goes to secondary files, then truncates.
    const roomy = await collectTsScope("r1", async (_root, rel) => tree[rel], 4);
    expect(roomy.files.map((f) => f.rel)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "e2e/a.spec.ts",
    ]);
    expect(roomy.truncated).toBe(true);
  });

  it("classifies secondary files by name convention and folder", () => {
    expect(isSecondaryFile("src/app/a.component.spec.ts")).toBe(true);
    expect(isSecondaryFile("src/app/a.test.tsx")).toBe(true);
    expect(isSecondaryFile("vite.config.ts")).toBe(true);
    expect(isSecondaryFile("src/environments/environment.prod.ts")).toBe(true);
    expect(isSecondaryFile("apps/fe/e2e/fixtures.ts")).toBe(true);
    expect(isSecondaryFile("test/helpers.ts")).toBe(true);
    expect(isSecondaryFile("src/__tests__/util.ts")).toBe(true);
    expect(isSecondaryFile("cypress/support/commands.ts")).toBe(true);
    expect(isSecondaryFile("src/app/auth/auth.service.ts")).toBe(false);
    expect(isSecondaryFile("src/app/testing-tools/latest.ts")).toBe(false);
  });

  it("stops at maxFiles and reports truncation", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([file("a.ts"), file("b.ts"), file("c.ts")]),
    };
    const collected = await collectTsScope("r1", async (_root, rel) => tree[rel], 2);
    expect(collected.files.map((f) => f.rel)).toEqual(["a.ts", "b.ts"]);
    expect(collected.truncated).toBe(true);
  });

  it("propagates backend truncation and honors the dir guard", async () => {
    const truncatedTree: Record<string, CodeListingDto> = {
      "": listing([file("a.ts")], true),
    };
    const truncated = await collectTsScope("r1", async (_root, rel) => truncatedTree[rel]);
    expect(truncated.truncated).toBe(true);

    const deep: Record<string, CodeListingDto> = {
      "": listing([dir("d1")]),
      d1: listing([dir("d1/d2")]),
      "d1/d2": listing([file("d1/d2/deep.ts")]),
    };
    const guarded = await collectTsScope(
      "r1",
      async (_root, rel) => deep[rel],
      PROJECT_MAP_MAX_FILES,
      2,
    );
    expect(guarded.files).toEqual([]);
    expect(guarded.truncated).toBe(true);
    expect(guarded.dirsVisited).toBe(2);
  });

  it("exposes sane default caps", () => {
    expect(PROJECT_MAP_MAX_FILES).toBe(200);
    expect(PROJECT_MAP_MAX_DIRS).toBe(2000);
  });

  it("starts at a project folder and skips nested projects", async () => {
    const tree: Record<string, CodeListingDto> = {
      "apps/fe": listing([dir("apps/fe/src"), file("apps/fe/main.ts")]),
      "apps/fe/src": listing([dir("apps/fe/src/legacy"), file("apps/fe/src/app.ts")]),
      "apps/fe/src/legacy": listing([file("apps/fe/src/legacy/old.ts")]),
    };
    const collected = await collectTsScope("r1", async (_root, rel) => tree[rel], 200, 2000, {
      startRel: "apps/fe",
      excludeRels: ["apps/fe/src/legacy"],
    });
    expect(collected.files.map((f) => f.rel)).toEqual(["apps/fe/main.ts", "apps/fe/src/app.ts"]);
    expect(collected.truncated).toBe(false);
    expect(collected.truncatedBy).toBe(null);
    expect(collected.excludedSubtrees).toBe(1);
  });

  it("skips build and dependency folders by name", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([dir("build"), dir("src"), file("main.ts")]),
      build: listing([file("build/out.ts")]),
      src: listing([file("src/app.ts")]),
    };
    const collected = await collectTsScope("r1", async (_root, rel) => tree[rel]);
    expect(collected.files.map((f) => f.rel)).toEqual(["main.ts", "src/app.ts"]);
  });

  it("names the truncation reason honestly", async () => {
    const tree: Record<string, CodeListingDto> = {
      "": listing([file("a.ts"), file("b.ts")]),
    };
    const byFiles = await collectTsScope("r1", async (_root, rel) => tree[rel], 1);
    expect(byFiles.truncatedBy).toBe("files");
    const byListing = await collectTsScope("r1", async (_root, rel) =>
      rel === "" ? listing([file("a.ts")], true) : tree[rel],
    );
    expect(byListing.truncatedBy).toBe("listing");
    const deep: Record<string, CodeListingDto> = {
      "": listing([dir("d1")]),
      d1: listing([dir("d1/d2")]),
      "d1/d2": listing([file("d1/d2/deep.ts")]),
    };
    const byDirs = await collectTsScope("r1", async (_root, rel) => deep[rel], 200, 2);
    expect(byDirs.truncatedBy).toBe("dirs");
  });
});
