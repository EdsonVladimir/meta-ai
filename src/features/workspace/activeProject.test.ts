// @vitest-environment jsdom
// Single-active-project scoping: each view shows the active
// project's roots and projects only; hidden roots keep every flag.
import { describe, expect, it } from "vitest";
import {
  activeProjectRoots,
  activeProjects,
  mergeRecentPaths,
  planRecentRestore,
  removedLastFolder,
} from "./activeProject";

interface Root {
  id: string;
  projectId: string | null;
  aiBlocked: boolean;
  missing: boolean;
}

function root(id: string, projectId: string | null, extra: Partial<Root> = {}): Root {
  return { id, projectId, aiBlocked: false, missing: false, ...extra };
}

describe("activeProjectRoots", () => {
  it("shows only the roots bound to the active project", () => {
    const roots = [
      root("root-1", "proy-1"),
      root("root-2", "proy-2"),
      root("root-3", null),
    ];
    expect(activeProjectRoots(roots, "proy-1")).toEqual([roots[0]]);
  });

  it("switching projects hides the earlier project's folders", () => {
    const roots = [root("root-1", "proy-1"), root("root-2", "proy-2")];
    expect(activeProjectRoots(roots, "proy-1").map((entry) => entry.id)).toEqual(["root-1"]);
    expect(activeProjectRoots(roots, "proy-2").map((entry) => entry.id)).toEqual(["root-2"]);
  });

  it("shows nothing without an active project", () => {
    const roots = [root("root-1", "proy-1"), root("root-2", null)];
    expect(activeProjectRoots(roots, null)).toEqual([]);
  });

  it("keeps missing roots of the project so they can be removed", () => {
    const roots = [root("root-1", "proy-1", { missing: true })];
    expect(activeProjectRoots(roots, "proy-1")).toEqual(roots);
  });

  it("returns the same roots untouched, flags included", () => {
    const blocked = root("root-1", "proy-1", { aiBlocked: true });
    const [shown] = activeProjectRoots([blocked], "proy-1");
    expect(shown).toBe(blocked);
    expect(shown.aiBlocked).toBe(true);
  });
});

describe("activeProjects", () => {
  it("lists only the active project", () => {
    const projects = [
      { id: "proy-1", name: "Shop" },
      { id: "proy-2", name: "Blog" },
    ];
    expect(activeProjects(projects, "proy-2")).toEqual([projects[1]]);
  });

  it("lists nothing without an active project", () => {
    expect(activeProjects([{ id: "proy-1", name: "Shop" }], null)).toEqual([]);
  });

  it("lists nothing when the active project is gone", () => {
    expect(activeProjects([{ id: "proy-1", name: "Shop" }], "proy-9")).toEqual([]);
  });
});

describe("planRecentRestore", () => {
  interface Root {
    id: string;
    path: string;
    projectId: string | null;
  }
  const roots: Root[] = [
    { id: "root-1", path: "/x/shop", projectId: "proy-1" },
    { id: "root-2", path: "/x/blog", projectId: "proy-2" },
    { id: "root-3", path: "/x/loose", projectId: null },
  ];

  it("keeps the project's folders and re-adds the unknown ones", () => {
    expect(planRecentRestore(roots, ["/x/shop", "/x/gone"], "proy-1")).toEqual({
      kept: ["/x/shop"],
      skipped: [],
      missing: ["/x/gone"],
    });
  });

  it("skips stored folders that are loose or bound elsewhere", () => {
    expect(planRecentRestore(roots, ["/x/blog/", "/x/loose", "/x/shop"], "proy-1")).toEqual({
      kept: ["/x/shop"],
      skipped: ["/x/blog/", "/x/loose"],
      missing: [],
    });
  });

  it("keeps every known path when no project opens", () => {
    expect(planRecentRestore(roots, ["/x/blog", "/x/loose", "/x/gone"], null)).toEqual({
      kept: ["/x/blog", "/x/loose"],
      skipped: [],
      missing: ["/x/gone"],
    });
  });
});

describe("mergeRecentPaths", () => {
  it("keeps skipped paths in the entry without duplicating", () => {
    expect(mergeRecentPaths(["/x/shop"], ["/x/blog", "/x/shop/"])).toEqual([
      "/x/shop",
      "/x/blog",
    ]);
  });

  it("keeps working with no folders on either side", () => {
    expect(mergeRecentPaths([], [])).toEqual([]);
    expect(mergeRecentPaths([], ["/x/blog"])).toEqual(["/x/blog"]);
  });
});

describe("removedLastFolder", () => {
  it("closes the project when its last folder is removed", () => {
    const removed = root("root-1", "proy-1");
    expect(removedLastFolder([], removed, "proy-1")).toBe(true);
  });

  it("stays open when folders remain", () => {
    const removed = root("root-1", "proy-1");
    expect(removedLastFolder([root("root-2", "proy-1")], removed, "proy-1")).toBe(false);
  });

  it("ignores folders of other projects and loose folders", () => {
    const removed = root("root-1", "proy-1");
    const remaining = [root("root-2", "proy-2"), root("root-3", null)];
    expect(removedLastFolder(remaining, removed, "proy-1")).toBe(true);
  });

  it("stays open when the removed folder was not its own", () => {
    expect(removedLastFolder([], root("root-9", "proy-2"), "proy-1")).toBe(false);
    expect(removedLastFolder([], root("root-9", null), "proy-1")).toBe(false);
  });

  it("stays open without an active project", () => {
    expect(removedLastFolder([], root("root-1", "proy-1"), null)).toBe(false);
  });

  it("a project that never had a folder never loses its last one", () => {
    // Nothing bound to proy-1 exists, so any removal is foreign to it.
    expect(removedLastFolder([], root("root-1", "proy-2"), "proy-1")).toBe(false);
    expect(removedLastFolder([root("root-2", "proy-2")], root("root-1", null), "proy-1")).toBe(
      false,
    );
  });
});
