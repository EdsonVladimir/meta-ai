import { describe, expect, it } from "vitest";
import type { ArchMap, ArchMapFile } from "./archModel";
import type { FileImport } from "../structure/structureTypes";
import {
  aliasTarget,
  ancestorFolders,
  collectLibraries,
  isInExternalFolder,
  packageName,
} from "./externalLibraries";

function ext(raw: string, names: string[] = []): FileImport {
  return { raw, resolvedRel: null, status: "external", line: 1, names };
}

function file(rel: string, imports: FileImport[]): ArchMapFile {
  return { rootId: "r", rel, imports } as unknown as ArchMapFile;
}

function mapOf(files: ArchMapFile[]): ArchMap {
  return { files } as unknown as ArchMap;
}

describe("packageName", () => {
  it("groups subpaths under their package", () => {
    expect(packageName("rxjs/operators")).toBe("rxjs");
    expect(packageName("@angular/material/table")).toBe("@angular/material");
    expect(packageName("node:fs")).toBe("node");
  });

  it("leaves out assets and root aliases", () => {
    expect(packageName("swiper/css")).toBe("swiper");
    expect(packageName("./theme.scss")).toBeNull();
    expect(packageName("primeicons/primeicons.css")).toBeNull();
    expect(packageName("@/lib/x")).toBeNull();
    expect(packageName("~/lib/x")).toBeNull();
  });
});

describe("marked folders", () => {
  it("matches whole folder segments only", () => {
    const folders = [{ rootId: "r", rel: "src/lib" }];
    expect(isInExternalFolder("r", "src/lib/a.ts", folders)).toBe(true);
    expect(isInExternalFolder("r", "src/library/a.ts", folders)).toBe(false);
    expect(isInExternalFolder("other", "src/lib/a.ts", folders)).toBe(false);
  });

  it("lists the folders above a file, deepest first", () => {
    expect(ancestorFolders("src/app/ui/a.ts")).toEqual(["src/app/ui", "src/app", "src"]);
    expect(ancestorFolders("a.ts")).toEqual([]);
  });
});

describe("aliasTarget", () => {
  const rels = ["src/app/core/auth.ts", "src/app/ui/index.ts", "src/a/x.ts", "src/b/x.ts"];

  it("finds the one file a path alias ends in", () => {
    expect(aliasTarget("@app/core/auth", rels)).toBe("src/app/core/auth.ts");
    expect(aliasTarget("src/app/core/auth", rels)).toBe("src/app/core/auth.ts");
    expect(aliasTarget("@app/ui", rels)).toBe("src/app/ui/index.ts");
  });

  it("never picks between two files or matches a partial name", () => {
    expect(aliasTarget("@app/x", rels)).toBeNull();
    expect(aliasTarget("@app/uth", rels)).toBeNull();
    expect(aliasTarget("rxjs", rels)).toBeNull();
  });
});

describe("collectLibraries", () => {
  it("merges one package across files, most used first", () => {
    const libraries = collectLibraries(
      mapOf([
        file("a.ts", [ext("@angular/core", ["Component"]), ext("rxjs", ["map"])]),
        file("b.ts", [ext("@angular/core", ["Injectable"])]),
      ]),
      [],
    );
    expect(libraries.map((library) => library.name)).toEqual(["@angular/core", "rxjs"]);
    expect(libraries[0].usedBy.map((user) => user.rel)).toEqual(["a.ts", "b.ts"]);
    expect(libraries[0].names).toEqual(["Component", "Injectable"]);
  });

  it("does not take a path alias to our own code for a library", () => {
    const libraries = collectLibraries(
      mapOf([file("src/a.ts", [ext("@app/core/auth")]), file("src/core/auth.ts", [])]),
      [],
    );
    expect(libraries).toEqual([]);
  });

  it("counts relative, alias and package imports of a marked folder", () => {
    const relative: FileImport = {
      raw: "../lib/ui/table",
      resolvedRel: "src/lib/ui/table.ts",
      status: "resolved",
      line: 1,
      names: ["Table"],
    };
    const libraries = collectLibraries(
      mapOf([
        file("src/a/one.ts", [relative]),
        file("src/a/two.ts", [ext("@app/ui/table", ["Row"])]),
        file("src/a/three.ts", [ext("@lib/other", ["Pager"])]),
        file("src/lib/ui/table.ts", [ext("rxjs")]),
      ]),
      [{ rootId: "r", rel: "src/lib" }],
    );
    expect(libraries).toHaveLength(1);
    expect(libraries[0].name).toBe("lib");
    expect(libraries[0].usedBy.map((user) => user.rel)).toEqual([
      "src/a/one.ts",
      "src/a/three.ts",
      "src/a/two.ts",
    ]);
    expect(libraries[0].names).toEqual(["Pager", "Row", "Table"]);
  });

  it("keeps an unused marked folder and drops other roots' folders", () => {
    const libraries = collectLibraries(mapOf([file("a.ts", [])]), [
      { rootId: "r", rel: "vendor" },
      { rootId: "other", rel: "vendor" },
    ]);
    expect(libraries).toHaveLength(1);
    expect(libraries[0].usedBy).toEqual([]);
  });

  it("limits users to the filtered files", () => {
    const libraries = collectLibraries(
      mapOf([file("a.ts", [ext("rxjs")]), file("b.ts", [ext("lodash")])]),
      [],
      new Set(["a.ts"]),
    );
    expect(libraries.map((library) => library.name)).toEqual(["rxjs"]);
  });
});
