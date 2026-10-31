// Muse from a folder: what is offered, and the project it lands in.
import { describe, expect, it, vi } from "vitest";
import {
  collectMuseFiles,
  linkMuseTarget,
  moduleNameOf,
  MUSE_MAX_CANDIDATES,
  type MuseLinkDeps,
} from "./museFlow";

const file = (name: string, dir = "") => ({
  name,
  rel: dir === "" ? name : `${dir}/${name}`,
  kind: "file",
});
const folder = (name: string, dir = "") => ({
  name,
  rel: dir === "" ? name : `${dir}/${name}`,
  kind: "dir",
});

describe("collectMuseFiles", () => {
  it("offers one file as it is", async () => {
    const listDir = vi.fn();
    const out = await collectMuseFiles({ rootId: "r", rel: "a/b.md", kind: "file" }, listDir);
    expect(out.files).toEqual([{ rootId: "r", rel: "a/b.md" }]);
    expect(listDir).not.toHaveBeenCalled();
  });

  it("takes source files, shallow first, without tests or hidden folders", async () => {
    const tree: Record<string, ReturnType<typeof file>[]> = {
      core: [
        folder("zeta", "core"),
        folder(".cache", "core"),
        file("b.ts", "core"),
        file("a.spec.ts", "core"),
        file("logo.png", "core"),
      ],
      "core/zeta": [file("deep.html", "core/zeta")],
    };
    const out = await collectMuseFiles(
      { rootId: "r", rel: "core", kind: "folder" },
      async (_root, rel) => ({ entries: tree[rel] ?? [] }),
    );
    expect(out.files.map((entry) => entry.rel)).toEqual(["core/b.ts", "core/zeta/deep.html"]);
    expect(out.truncated).toBe(false);
  });

  it("stops at the candidate bound and says so", async () => {
    const entries = Array.from({ length: MUSE_MAX_CANDIDATES + 5 }, (_, i) => file(`f${i}.ts`));
    const out = await collectMuseFiles({ rootId: "r", rel: "", kind: "folder" }, async () => ({
      entries,
    }));
    expect(out.files).toHaveLength(MUSE_MAX_CANDIDATES);
    expect(out.truncated).toBe(true);
  });
});

describe("linkMuseTarget", () => {
  function deps(modules: Array<{ id: string; name: string; archived: boolean }> = []): MuseLinkDeps {
    return {
      listModules: vi.fn(async () => modules),
      createProject: vi.fn(async () => ({ id: "p9", name: "Project 9" })),
      renameProject: vi.fn(async () => undefined),
      setRootProject: vi.fn(async () => undefined),
      createModule: vi.fn(async () => ({ id: "m9", name: "Module 9" })),
      renameModule: vi.fn(async () => undefined),
    };
  }
  const target = { rootId: "r", rel: "src/core", kind: "folder" as const };

  it("creates project and module for a loose folder", async () => {
    const d = deps();
    const out = await linkMuseTarget(target, { id: "r", name: "shop", projectId: null }, d);
    expect(out).toEqual({ projectId: "p9", moduleId: "m9" });
    expect(d.renameProject).toHaveBeenCalledWith("p9", "Project 9", "shop");
    expect(d.setRootProject).toHaveBeenCalledWith("r", "p9");
    expect(d.renameModule).toHaveBeenCalledWith("p9", "m9", "Module 9", "core");
  });

  it("reuses the folder's module and never touches a linked project", async () => {
    const d = deps([{ id: "m1", name: "core", archived: false }]);
    const out = await linkMuseTarget(target, { id: "r", name: "shop", projectId: "p1" }, d);
    expect(out).toEqual({ projectId: "p1", moduleId: "m1" });
    expect(d.createProject).not.toHaveBeenCalled();
    expect(d.createModule).not.toHaveBeenCalled();
  });

  it("does not reuse an archived module", async () => {
    const d = deps([{ id: "m1", name: "core", archived: true }]);
    const out = await linkMuseTarget(target, { id: "r", name: "shop", projectId: "p1" }, d);
    expect(out.moduleId).toBe("m9");
  });

  it("names the module after a file's folder, or the root", () => {
    expect(moduleNameOf({ rootId: "r", rel: "src/core/a.ts", kind: "file" }, "shop")).toBe("core");
    expect(moduleNameOf({ rootId: "r", rel: "a.ts", kind: "file" }, "shop")).toBe("shop");
    expect(moduleNameOf({ rootId: "r", rel: "", kind: "folder" }, "shop")).toBe("shop");
  });
});
