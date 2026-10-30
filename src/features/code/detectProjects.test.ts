// detectProjects: nested code-project discovery from manifests.
// Pure grouping plus a bounded async runner over injected deps.
// No Tauri, no network, no code execution.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryCache,
  detectProjectsFromManifests,
  discoverRootProjects,
} from "./detectProjects";

beforeEach(() => clearDiscoveryCache());

describe("detectProjectsFromManifests", () => {
  it("finds nested projects by their manifests", () => {
    const found = detectProjectsFromManifests("r1", "ACME", [
      "frontend/package.json",
      "frontend/angular.json",
      "backend/package.json",
      "backend/nest-cli.json",
      "gateway/package.json",
    ]);
    expect(found.map((p) => [p.rel, p.kind, p.analyzer])).toEqual([
      ["backend", "nestjs", "ts"],
      ["frontend", "angular", "ts"],
      ["gateway", "typescript", "ts"],
    ]);
    expect(found[0]?.key).toBe("r1::backend");
    expect(found[0]?.name).toBe("backend");
    expect(found[0]?.manifests).toEqual(["backend/nest-cli.json", "backend/package.json"]);
  });

  it("treats a workspaces root as a container, not a service", () => {
    const found = detectProjectsFromManifests(
      "r1",
      "mono",
      ["package.json", "packages/api/package.json"],
      {
        "package.json": { name: "mono", workspaces: ["packages/*"], deps: [] },
        "packages/api/package.json": { name: "@mono/api", workspaces: null, deps: [] },
      },
    );
    expect(found.map((p) => [p.rel, p.kind])).toEqual([["packages/api", "typescript"]]);
  });

  it("keeps a package.json project without workspace config", () => {
    const found = detectProjectsFromManifests("r1", "solo", ["package.json"], {
      "package.json": { name: "solo", workspaces: null, deps: [] },
    });
    expect(found.map((p) => [p.rel, p.kind])).toEqual([["", "typescript"]]);
    expect(found[0]?.name).toBe("solo");
  });

  it("detects Java, Rust and Python without claiming analysis", () => {
    const found = detectProjectsFromManifests("r1", "mixed", [
      "svc/pom.xml",
      "tool/Cargo.toml",
      "jobs/pyproject.toml",
      "legacy/build.gradle",
    ]);
    expect(found.map((p) => [p.rel, p.kind, p.analyzer])).toEqual([
      ["jobs", "python", "none"],
      ["legacy", "java", "none"],
      ["svc", "java", "none"],
      ["tool", "rust", "none"],
    ]);
  });

  it("never creates a project from tsconfig.json alone", () => {
    const found = detectProjectsFromManifests("r1", "app", [
      "package.json",
      "src/tsconfig.app.json",
      "tsconfig.spec.json",
    ]);
    expect(found.map((p) => p.rel)).toEqual([""]);
    expect(found[0]?.manifests).toContain("package.json");
  });

  it("prefers framework manifests over generic package.json", () => {
    const withHints = detectProjectsFromManifests("r1", "x", ["a/package.json"], {
      "a/package.json": { name: "a", workspaces: null, deps: ["@angular/core"] },
    });
    expect(withHints[0]?.kind).toBe("angular");
    const nest = detectProjectsFromManifests("r1", "x", ["a/package.json"], {
      "a/package.json": { name: "a", workspaces: null, deps: ["@nestjs/core"] },
    });
    expect(nest[0]?.kind).toBe("nestjs");
  });

  it("keeps nested projects independent from their parents", () => {
    const found = detectProjectsFromManifests("r1", "mono", [
      "package.json",
      "packages/a/package.json",
      "packages/a/nest-cli.json",
      "packages/b/package.json",
    ]);
    expect(found.map((p) => p.rel)).toEqual(["", "packages/a", "packages/b"]);
  });

  it("ignores unreadable package.json bodies for grouping", () => {
    const found = detectProjectsFromManifests("r1", "x", ["a/package.json"], {
      "a/package.json": null,
    });
    expect(found.map((p) => [p.rel, p.kind])).toEqual([["a", "typescript"]]);
  });
});

describe("discoverRootProjects", () => {
  function deps(listings: Record<string, { name: string; rel: string; kind: string }[]>) {
    const listDir = vi.fn(async (_rootId: string, rel: string) => ({
      entries: listings[rel] ?? [],
      truncated: false,
    }));
    const readFile = vi.fn(async (_rootId: string, rel: string) => {
      if (rel === "package.json") return { text: `{"name":"mono","workspaces":["apps/*"]}` };
      if (rel.endsWith("package.json")) return { text: `{"name":"${rel}"}` };
      throw new Error("not a package");
    });
    return { listDir, readFile };
  }

  it("discovers nested projects through directory listings", async () => {
    const found = await discoverRootProjects("r1", "ACME", deps({
      "": [
        { name: "apps", rel: "apps", kind: "dir" },
        { name: "package.json", rel: "package.json", kind: "file" },
      ],
      apps: [
        { name: "fe", rel: "apps/fe", kind: "dir" },
        { name: "be", rel: "apps/be", kind: "dir" },
      ],
      "apps/fe": [{ name: "package.json", rel: "apps/fe/package.json", kind: "file" }],
      "apps/be": [
        { name: "package.json", rel: "apps/be/package.json", kind: "file" },
        { name: "nest-cli.json", rel: "apps/be/nest-cli.json", kind: "file" },
      ],
    }));
    expect(found.truncated).toBe(false);
    expect(found.projects.map((p) => [p.rel, p.kind])).toEqual([
      ["apps/be", "nestjs"],
      ["apps/fe", "typescript"],
    ]);
  });

  it("reports an empty root without projects", async () => {
    const found = await discoverRootProjects("r1", "empty", deps({}));
    expect(found.projects).toEqual([]);
    expect(found.truncated).toBe(false);
  });

  it("aborts cooperatively and reports partial results", async () => {
    const d = deps({
      "": [{ name: "a", rel: "a", kind: "dir" }],
      a: [{ name: "package.json", rel: "a/package.json", kind: "file" }],
    });
    let calls = 0;
    const found = await discoverRootProjects("r1", "x", d, () => {
      calls += 1;
      return calls > 1;
    });
    expect(found.truncated).toBe(true);
  });

  it("caches per root and shares in-flight runs", async () => {
    const d = deps({
      "": [{ name: "package.json", rel: "package.json", kind: "file" }],
    });
    const [a, b] = await Promise.all([
      discoverRootProjects("r-cache", "x", d),
      discoverRootProjects("r-cache", "x", d),
    ]);
    expect(a.projects).toEqual(b.projects);
    expect(d.listDir).toHaveBeenCalledTimes(1);
    await discoverRootProjects("r-cache", "x", d);
    expect(d.listDir).toHaveBeenCalledTimes(1);
  });
});
