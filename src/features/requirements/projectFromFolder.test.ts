import { describe, expect, it, vi } from "vitest";
import { createProjectFromFolder, folderBaseName } from "./projectFromFolder";

describe("folderBaseName", () => {
  it("trims the last segment on posix and windows paths", () => {
    expect(folderBaseName("/home/ed/ruth-ide-hackathon")).toBe("ruth-ide-hackathon");
    expect(folderBaseName("C:\\dev\\mi-app\\")).toBe("mi-app");
    expect(folderBaseName("suelta")).toBe("suelta");
  });
});

function deps(overrides: Record<string, unknown> = {}) {
  return {
    pickFolder: vi.fn(async () => "/home/ed/ruth"),
    createProject: vi.fn(async () => ({ id: "proj-1", name: "Proyecto 1" })),
    renameProject: vi.fn(async () => undefined),
    addCodeRoot: vi.fn(async () => ({ id: "root-1" })),
    setRootProject: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("createProjectFromFolder", () => {
  it("cancelling the dialog creates nothing", async () => {
    const d = deps({ pickFolder: vi.fn(async () => null) });
    expect(await createProjectFromFolder(d)).toEqual({ cancelled: true });
    expect(d.createProject).not.toHaveBeenCalled();
  });

  it("happy path: folder → named project → linked root", async () => {
    const d = deps();
    const result = await createProjectFromFolder(d);
    expect(result).toEqual({
      cancelled: false,
      projectId: "proj-1",
      rootId: "root-1",
      warnings: [],
    });
    expect(d.renameProject).toHaveBeenCalledWith("proj-1", "Proyecto 1", "ruth");
    expect(d.setRootProject).toHaveBeenCalledWith("root-1", "proj-1");
  });

  it("when adding the root fails, the created project stays and a warning shows", async () => {
    const d = deps({ addCodeRoot: vi.fn(async () => { throw { message: "no permission" }; }) });
    const result = await createProjectFromFolder(d);
    expect(result).toEqual({
      cancelled: false,
      projectId: "proj-1",
      rootId: null,
      warnings: [expect.stringContaining("Project created, but the folder was not added")],
    });
    expect(d.setRootProject).not.toHaveBeenCalled();
  });

  it("when linking fails, the root stays loose with an explanation", async () => {
    const d = deps({ setRootProject: vi.fn(async () => { throw { message: "root rejected" }; }) });
    const result = await createProjectFromFolder(d);
    expect(result).toEqual({
      cancelled: false,
      projectId: "proj-1",
      rootId: "root-1",
      warnings: [expect.stringContaining("added loose (unlinked)")],
    });
  });

  it("when renaming fails, it continues: the name can change later", async () => {
    const d = deps({ renameProject: vi.fn(async () => { throw { message: "bloqueado" }; }) });
    const result = await createProjectFromFolder(d);
    expect(result.cancelled).toBe(false);
    if (!result.cancelled) {
      expect(result.rootId).toBe("root-1");
      expect(result.warnings).toEqual([expect.stringContaining("Could not name the project")]);
    }
  });
});
