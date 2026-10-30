// manifestScan: bounded discovery, framework hints, caps, abort.
import { describe, expect, it } from "vitest";
import { scanRootTech, type ManifestDeps } from "./manifestScan";

function entry(rel: string, kind: string) {
  return { rel, kind, name: rel.split("/").pop() ?? rel };
}

function depsOf(
  tree: Record<string, Array<{ rel: string; kind: string }>>,
  contents: Record<string, string> = {},
  seen: string[] = [],
): ManifestDeps {
  return {
    listDir: async (_root, rel) => {
      seen.push(rel);
      return {
        entries: (tree[rel] ?? []).map((e) => ({
          ...e,
          name: e.rel.split("/").pop() ?? e.rel,
        })),
        truncated: false,
      };
    },
    readFile: async (_root, rel) => {
      const text = contents[rel];
      if (text === undefined) throw new Error("missing");
      return { text };
    },
  };
}

describe("scanRootTech", () => {
  it("detects Angular from package.json dependencies", async () => {
    const deps = depsOf(
      { "": [entry("package.json", "file"), entry("src", "dir")] },
      { "package.json": JSON.stringify({ dependencies: { "@angular/core": "19.0.0" } }) },
    );
    const found = await scanRootTech("root-1", deps);
    expect(found.techs).toEqual(["Angular", "TypeScript"]);
    expect(found.manifests).toEqual(["package.json"]);
    expect(found.truncated).toBe(false);
  });

  it("detects NestJS, Rust and Java markers in nested folders", async () => {
    const deps = depsOf(
      {
        "": [entry("api", "dir"), entry("Cargo.toml", "file")],
        api: [entry("api/nest-cli.json", "file"), entry("api/pom.xml", "file")],
      },
      { "api/nest-cli.json": "{}" },
    );
    const found = await scanRootTech("root-1", deps);
    expect(found.techs).toEqual(["Java", "NestJS", "Rust"]);
    expect(found.techs).not.toContain("Unknown");
  });

  it("reports Unknown when nothing matches", async () => {
    const deps = depsOf({ "": [entry("README.md", "file")] });
    const found = await scanRootTech("root-1", deps);
    expect(found.techs).toEqual(["Unknown"]);
    expect(found.manifests).toEqual([]);
  });

  it("keeps filename evidence for unparseable manifests", async () => {
    const deps = depsOf(
      { "": [entry("package.json", "file")] },
      { "package.json": "{oops" },
    );
    const found = await scanRootTech("root-1", deps);
    expect(found.techs).toEqual(["TypeScript"]);
    expect(found.manifests).toEqual(["package.json"]);
  });

  it("stops below the depth cap and reports truncation", async () => {
    const tree: Record<string, Array<{ rel: string; kind: string }>> = {
      "": [entry("d1", "dir")],
      d1: [entry("d1/d2", "dir")],
      "d1/d2": [entry("d1/d2/d3", "dir")],
      "d1/d2/d3": [entry("d1/d2/d3/d4", "dir")],
      "d1/d2/d3/d4": [entry("d1/d2/d3/d4/pom.xml", "file")],
    };
    const seen: string[] = [];
    const found = await scanRootTech("root-1", depsOf(tree, {}, seen));
    expect(seen).not.toContain("d1/d2/d3/d4");
    expect(found.truncated).toBe(true);
    expect(found.techs).toEqual(["Unknown"]);
  });

  it("cancels cooperatively keeping partial results", async () => {
    const deps = depsOf({
      "": [entry("package.json", "file"), entry("sub", "dir")],
      sub: [entry("sub/pom.xml", "file")],
    });
    let calls = 0;
    const found = await scanRootTech("root-1", deps, () => {
      calls += 1;
      return calls > 1;
    });
    expect(found.manifests).toEqual(["package.json"]);
    expect(found.truncated).toBe(true);
  });
});
