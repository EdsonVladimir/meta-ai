// Muse from a folder: what is offered, and the project it lands in.
import { describe, expect, it, vi } from "vitest";
import {
  collectMuseFiles,
  answerPrefix,
  adjustmentScope,
  filesLeftOut,
  linkMuseTarget,
  moduleNameOf,
  MUSE_MAX_CANDIDATES,
  MUSE_MAX_FILES,
  MUSE_MAX_PLANNED_FILES,
  pickMuseFiles,
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
  it("collects past the candidate limit when asked to search", async () => {
    const entries = Array.from({ length: 70 }, (_, i) => file(`f${String(i).padStart(2, "0")}.ts`));
    const listDir = async () => ({ entries });
    const target = { rootId: "r", rel: "", kind: "folder" as const };
    expect((await collectMuseFiles(target, listDir)).files).toHaveLength(MUSE_MAX_CANDIDATES);
    expect((await collectMuseFiles(target, listDir, 1000)).files).toHaveLength(70);
  });

  it("leaves out generated reports and files too large to read", async () => {
    const entries: Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>> = {
      "": [
        { name: "playwright-report", rel: "playwright-report", kind: "dir", size: null },
        { name: "big.ts", rel: "big.ts", kind: "file", size: 262_145 },
        { name: "ok.ts", rel: "ok.ts", kind: "file", size: 262_144 },
      ],
      "playwright-report": [
        { name: "index.html", rel: "playwright-report/index.html", kind: "file", size: 10 },
      ],
    };
    const out = await collectMuseFiles(
      { rootId: "r", rel: "", kind: "folder" },
      async (_root, rel) => ({ entries: entries[rel] ?? [] }),
    );
    expect(out.files.map((file) => file.rel)).toEqual(["ok.ts"]);
  });

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

describe("pickMuseFiles", () => {
  const files = (rels: string[]) => rels.map((rel) => ({ rootId: "r", rel }));

  it("reads pages and their templates before styles, whatever the language", () => {
    const rels = [
      "src/app/app.component.css",
      "src/app/app.component.html",
      "src/app/app.component.ts",
      "src/app/app.routes.ts",
      "src/app/bookings/booking-form.component.css",
      "src/app/bookings/booking-form.component.html",
      "src/app/bookings/booking-form.component.ts",
      "src/app/bookings/booking.model.ts",
      "src/app/bookings/bookings-page.component.css",
      "src/app/bookings/bookings-page.component.html",
      "src/app/bookings/bookings-page.component.ts",
      "src/app/bookings/bookings.service.ts",
      "src/app/bookings/bookings.store.ts",
      "src/app/core/auth.guard.ts",
      "src/app/core/auth.interceptor.ts",
      "src/app/core/environment.ts",
      "src/index.html",
      "src/main.ts",
      "src/styles.css",
    ];
    for (const message of [
      "¿Cómo llegan las reservas a la API? Explícamelo desde la página.",
      "How do bookings reach the API? Walk me through it from the page.",
    ]) {
      const picked = pickMuseFiles(files(rels), message).map((file) => file.rel);
      expect(picked).toEqual(
        expect.arrayContaining([
          "src/app/bookings/bookings-page.component.ts",
          "src/app/bookings/bookings-page.component.html",
          "src/app/bookings/booking-form.component.ts",
          "src/app/bookings/bookings.store.ts",
          "src/app/bookings/bookings.service.ts",
        ]),
      );
      expect(picked.filter((rel) => rel.endsWith(".css"))).toEqual([]);
    }
  });

  it("spreads roles instead of taking the first files", () => {
    const picked = pickMuseFiles(
      files([
        "src/main.ts",
        "src/core/auth.guard.ts",
        "src/core/auth.interceptor.ts",
        "src/core/environment.ts",
        "src/a/env.config.ts",
        "src/a/b.config.ts",
        "src/a/c.config.ts",
        "src/a/d.config.ts",
        "src/app/app.routes.ts",
        "src/app/x/x-form.component.ts",
        "src/app/x/x.store.ts",
        "src/app/x/x.service.ts",
        "src/app/x/x.model.ts",
      ]),
      "",
    ).map((file) => file.rel);
    expect(picked).toHaveLength(MUSE_MAX_FILES);
    expect(picked).toEqual(
      expect.arrayContaining([
        "src/app/app.routes.ts",
        "src/app/x/x-form.component.ts",
        "src/app/x/x.store.ts",
        "src/app/x/x.service.ts",
        "src/app/x/x.model.ts",
      ]),
    );
  });

  it("puts files named in the message first within a role", () => {
    const many = Array.from({ length: 12 }, (_, i) => `src/c${i}.component.ts`);
    const picked = pickMuseFiles(files([...many, "src/usuarios.component.ts"]), "los usuarios");
    expect(picked[0].rel).toBe("src/usuarios.component.ts");
  });

  it("returns everything when it fits", () => {
    expect(pickMuseFiles(files(["a.ts"]), "x")).toHaveLength(1);
  });
});

describe("adjustmentScope", () => {
  it("reads the files the person chose first", () => {
    const out = adjustmentScope(
      [{ scope: scope(["old.ts"]), files: [file("done.ts", "accepted")] }],
      scope(["store.ts"]),
    );
    expect(out.map((entry) => entry.rel)).toEqual(["store.ts", "done.ts", "old.ts"]);
  });

  const file = (rel: string, state = "pending") => ({ rootId: "r", rel, state });
  const scope = (rels: string[]) => rels.map((rel) => ({ rootId: "r", rel }));

  it("puts files accepted in any proposal first, without repeats", () => {
    const out = adjustmentScope([
      { scope: scope(["a.ts"]), files: [file("new.ts", "accepted"), file("no.ts", "discarded")] },
      { scope: scope(["a.ts", "b.ts"]), files: [file("two.ts", "pending"), file("a.ts", "accepted")] },
    ]);
    expect(out.map((entry) => entry.rel)).toEqual(["new.ts", "a.ts", "b.ts"]);
  });

  it("reads the files a version modifies, even those it dropped", () => {
    const out = adjustmentScope([
      {
        scope: scope(["a.ts"]),
        files: [
          { ...file("port.ts"), operation: "modify" },
          { ...file("made.ts"), operation: "create" },
        ],
      },
      { scope: scope(["a.ts"]), files: [{ ...file("http.ts"), operation: "modify" }] },
    ]);
    expect(out.map((entry) => entry.rel)).toEqual(["http.ts", "port.ts", "a.ts"]);
  });

  it("stays inside the file limit, keeping what is on disk", () => {
    const many = Array.from({ length: MUSE_MAX_PLANNED_FILES }, (_, i) => `s${i}.ts`);
    const out = adjustmentScope([{ scope: scope(many), files: [file("new.ts", "accepted")] }]);
    expect(out).toHaveLength(MUSE_MAX_PLANNED_FILES);
    expect(out[0].rel).toBe("new.ts");
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

describe("answerPrefix", () => {
  it("quotes the question after what is already written", () => {
    expect(answerPrefix("", "First?")).toBe("Q: First?\nA: ");
    expect(answerPrefix("Use doubles.\n", "First?")).toBe("Use doubles.\n\nQ: First?\nA: ");
  });
});

describe("filesLeftOut", () => {
  const version = (id: string, ...files: Array<[string, string]>) => ({
    requirementArtifactId: id,
    files: files.map(([rel, state]) => ({ rootId: "r", rel, state })),
  });

  it("names pending files the newest version dropped, across versions", () => {
    expect(
      filesLeftOut([
        version("req-1", ["a.ts", "pending"], ["b.ts", "pending"]),
        version("req-1", ["c.ts", "pending"], ["b.ts", "pending"]),
        version("req-1", ["d.ts", "pending"]),
      ]),
    ).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("ignores written files and other requests", () => {
    expect(
      filesLeftOut([
        version("req-1", ["a.ts", "accepted"]),
        version("req-2", ["z.ts", "pending"]),
        version("req-1", ["b.ts", "pending"]),
      ]),
    ).toEqual([]);
  });
});
