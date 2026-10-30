// openProject: reuse known folders, register new ones, warn on
// same-name projects instead of merging anything silently.
import { describe, expect, it } from "vitest";
import { openProjectFromFolder, samePath, type OpenProjectDeps } from "./openProject";

function deps(overrides: Partial<OpenProjectDeps> = {}): OpenProjectDeps & {
  calls: { created: number; renamed: number; added: number; linked: number };
} {
  const calls = { created: 0, renamed: 0, added: 0, linked: 0 };
  return {
    calls,
    pickFolder: async () => "/repo/shop",
    listRoots: async () => [],
    listProjects: async () => [],
    createProject: async () => {
      calls.created += 1;
      return { id: "proy-9", name: "proy-9" };
    },
    renameProject: async () => {
      calls.renamed += 1;
    },
    addCodeRoot: async () => {
      calls.added += 1;
      return { id: "root-9" };
    },
    setRootProject: async () => {
      calls.linked += 1;
    },
    ...overrides,
  };
}

describe("samePath", () => {
  it("ignores trailing separators", () => {
    expect(samePath("/repo/a", "/repo/a/")).toBe(true);
    expect(samePath("/repo/a", "/repo/b")).toBe(false);
  });
});

describe("openProjectFromFolder", () => {
  it("cancels without side effects", async () => {
    const clients = deps({ pickFolder: async () => null });
    expect(await openProjectFromFolder(clients)).toEqual({ cancelled: true });
    expect(clients.calls.created).toBe(0);
  });

  it("reuses the project of a known folder", async () => {
    const clients = deps({
      listRoots: async () => [{ id: "root-1", path: "/repo/shop/", projectId: "proy-1" }],
      listProjects: async () => [{ id: "proy-1", name: "Shop" }],
    });
    const result = await openProjectFromFolder(clients);
    expect(result).toEqual({ cancelled: false, projectId: "proy-1", created: false, warnings: [] });
    expect(clients.calls.created).toBe(0);
    expect(clients.calls.added).toBe(0);
  });

  it("registers a project for a known folder without one", async () => {
    const clients = deps({
      listRoots: async () => [{ id: "root-1", path: "/repo/shop", projectId: null }],
    });
    const result = await openProjectFromFolder(clients);
    expect(result).toEqual({ cancelled: false, projectId: "proy-9", created: true, warnings: [] });
    expect(clients.calls.added).toBe(0);
    expect(clients.calls.linked).toBe(1);
  });

  it("creates everything for an unknown folder", async () => {
    const result = await openProjectFromFolder(deps());
    expect(result).toEqual({ cancelled: false, projectId: "proy-9", created: true, warnings: [] });
  });

  it("warns instead of merging same-name projects", async () => {
    const clients = deps({
      listProjects: async () => [{ id: "proy-1", name: "shop" }],
    });
    const result = await openProjectFromFolder(clients);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.warnings.join(" ")).toMatch(/also called.*nothing was merged/);
    }
  });
});
