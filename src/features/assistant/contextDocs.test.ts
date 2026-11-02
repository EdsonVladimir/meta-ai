// Doc suggestions: order, default selection, caps, skips. The scan
// test fakes listDir/discovery; no IO, no network.
import { describe, expect, it, vi } from "vitest";
import {
  CONTEXT_DOC_DEFAULT_SELECTED,
  CONTEXT_DOC_SUGGESTIONS_MAX,
  formatDocSize,
  scanContextDocs,
  suggestContextDocs,
} from "./contextDocs";
import { clearDiscoveryCache } from "../code/detectProjects";
import type { CodeEntryDto, CodeRootDto } from "../code/types";

function file(name: string, rel: string, size: number | null = 10): CodeEntryDto {
  return { name, rel, kind: "file", size };
}

function dir(name: string, rel: string): CodeEntryDto {
  return { name, rel, kind: "dir", size: null };
}

function root(overrides: Partial<CodeRootDto> & { id: string }): CodeRootDto {
  return {
    path: `/repo/${overrides.id}`,
    name: overrides.id,
    missing: false,
    aiBlocked: false,
    projectId: "p1",
    ...overrides,
  };
}

describe("suggestContextDocs", () => {
  it("orders AGENTS, CLAUDE, README, docs/**, then service READMEs", () => {
    const out = suggestContextDocs({
      roots: [{ id: "r", blocked: false, missing: false }],
      rootEntries: new Map([
        [
          "r",
          [
            file("README.md", "README.md"),
            file("notes.md", "notes.md"),
            file("AGENTS.md", "AGENTS.md"),
            file("CLAUDE.md", "CLAUDE.md"),
            dir("docs", "docs"),
            dir("api", "api"),
          ],
        ],
      ]),
      dirEntries: new Map([
        [
          "r::docs",
          [file("guide.md", "docs/guide.md"), file("plan.txt", "docs/plan.txt"), dir("node_modules", "docs/node_modules")],
        ],
        ["r::docs/node_modules", [file("evil.md", "docs/node_modules/evil.md")]],
        ["r::api", [file("README.md", "api/README.md")]],
      ]),
      services: [{ rootId: "r", rel: "api" }],
    });
    expect(out.suggestions.map((item) => item.rel)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "README.md",
      "docs/guide.md",
      "api/README.md",
    ]);
    expect(out.defaultSelected).toHaveLength(5);
  });

  it("dedupes, caps at 40, and defaults to the first 8", () => {
    const docs = Array.from({ length: 45 }, (_, i) => file(`f${i}.md`, `docs/f${i}.md`));
    const out = suggestContextDocs({
      roots: [{ id: "r", blocked: false, missing: false }],
      rootEntries: new Map([
        ["r", [file("README.md", "README.md"), dir("docs", "docs")]],
      ]),
      dirEntries: new Map([["r::docs", docs]]),
      // A service at the root repeats its README: listed once.
      services: [{ rootId: "r", rel: "" }],
    });
    expect(out.suggestions).toHaveLength(CONTEXT_DOC_SUGGESTIONS_MAX);
    expect(out.suggestions[0].rel).toBe("README.md");
    expect(out.defaultSelected).toHaveLength(CONTEXT_DOC_DEFAULT_SELECTED);
    expect(out.defaultSelected[0].rel).toBe("README.md");
  });

  it("skips blocked and missing roots and map-skipped folders", () => {
    const out = suggestContextDocs({
      roots: [
        { id: "ok", blocked: false, missing: false },
        { id: "blocked", blocked: true, missing: false },
        { id: "gone", blocked: false, missing: true },
      ],
      rootEntries: new Map([
        ["ok", [file("README.md", "README.md")]],
        ["blocked", [file("README.md", "README.md")]],
        ["gone", [file("README.md", "README.md")]],
      ]),
      dirEntries: new Map(),
      services: [],
    });
    expect(out.suggestions).toEqual([{ rootId: "ok", rel: "README.md", size: 10 }]);
  });
});

describe("formatDocSize", () => {
  it("formats bytes, KB, MB and unknown", () => {
    expect(formatDocSize(null)).toBe("unknown size");
    expect(formatDocSize(800)).toBe("800 B");
    expect(formatDocSize(2048)).toBe("2.0 KB");
    expect(formatDocSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("scanContextDocs", () => {
  it("collects root files, docs/** and service READMEs, skipping failures", async () => {
    clearDiscoveryCache();
    const roots = [root({ id: "r" }), root({ id: "bad", aiBlocked: true })];
    const listDir = vi.fn(async (rootId: string, rel: string) => {
      if (rootId === "r" && rel === "") {
        return {
          entries: [
            file("README.md", "README.md", 100),
            file("package.json", "package.json", 20),
            dir("docs", "docs"),
            dir("api", "api"),
          ],
          truncated: false,
        };
      }
      if (rootId === "r" && rel === "docs") {
        return { entries: [file("guide.md", "docs/guide.md", 200)], truncated: false };
      }
      if (rootId === "r" && rel === "api") {
        return { entries: [file("README.md", "api/README.md", 300)], truncated: false };
      }
      return { entries: [], truncated: false };
    });
    const readFile = vi.fn(async (rootId: string, rel: string) => {
      if (rootId === "r" && rel === "package.json") {
        return { text: '{"name":"r"}', fingerprint: "h", size: 20 };
      }
      throw { kind: "code_not_found", message: "missing" };
    });
    const out = await scanContextDocs(roots, { listDir, readFile });
    expect(out.suggestions.map((item) => item.rel)).toEqual([
      "README.md",
      "docs/guide.md",
    ]);
    // Blocked roots are never listed.
    expect(listDir.mock.calls.some(([id]) => id === "bad")).toBe(false);
    clearDiscoveryCache();
  });
});
