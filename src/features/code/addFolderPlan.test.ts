// @vitest-environment jsdom
// Add-folder plan: new folders join the active project, loose ones
// bind, the project's own change nothing, and another project's
// need a confirmation naming that project.
import { describe, expect, it } from "vitest";
import { planAddFolder } from "./addFolderPlan";

function root(id: string, path: string, projectId: string | null) {
  return { id, path, projectId };
}

describe("planAddFolder", () => {
  it("adds an unknown folder", () => {
    expect(planAddFolder([], "/x/new", "proy-1")).toEqual({ kind: "add" });
  });

  it("binds a loose folder without asking", () => {
    const loose = root("root-9", "/x/loose", null);
    expect(planAddFolder([loose], "/x/loose", "proy-1")).toEqual({
      kind: "bind",
      root: loose,
    });
  });

  it("changes nothing when the folder is already in this project", () => {
    const own = root("root-1", "/x/shop", "proy-1");
    expect(planAddFolder([own], "/x/shop/", "proy-1")).toEqual({ kind: "noop", root: own });
  });

  it("asks for confirmation when the folder belongs to another project", () => {
    const foreign = root("root-2", "/x/blog", "proy-2");
    expect(planAddFolder([foreign], "/x/blog", "proy-1")).toEqual({
      kind: "confirm",
      root: foreign,
      fromProjectId: "proy-2",
    });
  });
});
