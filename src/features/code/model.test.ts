import { describe, expect, it } from "vitest";
import { analyzableLanguage, closeTab, duplicatedNames, fnv1aHex, folderScopeOutcome, languageForFile, openTab, parentDir, tabKey, tabQualifier, tabsOfRoot } from "./model";
import type { CodeTab } from "./types";

function tab(rootId: string, rel: string, name: string, rootName = "r"): CodeTab {
  return {
    rootId,
    rootName,
    rel,
    name,
    content: null,
    error: null,
    loading: false,
    savedText: null,
    dirty: false,
    saving: false,
    saveError: null,
    language: "plaintext",
  };
}

describe("tabKey", () => {
  it("identifies by root + path", () => {
    expect(tabKey("root-1", "src/a.ts")).toBe("root-1::src/a.ts");
    expect(tabKey("root-1", "src/a.ts")).not.toBe(tabKey("root-2", "src/a.ts"));
  });
});

describe("openTab", () => {
  it("opens without duplicating: reopening focuses", () => {
    const first = openTab([], { rootId: "root-1", rootName: "fe", rel: "a.ts", name: "a.ts" });
    expect(first.tabs).toHaveLength(1);
    expect(first.active).toBe("root-1::a.ts");
    const again = openTab(first.tabs, { rootId: "root-1", rootName: "fe", rel: "a.ts", name: "a.ts" });
    expect(again.tabs).toHaveLength(1);
    expect(again.active).toBe("root-1::a.ts");
  });

  it("the same name on another root is another tab", () => {
    const first = openTab([], { rootId: "root-1", rootName: "fe", rel: "main.ts", name: "main.ts" });
    const second = openTab(first.tabs, { rootId: "root-2", rootName: "be", rel: "main.ts", name: "main.ts" });
    expect(second.tabs).toHaveLength(2);
    expect(second.active).toBe("root-2::main.ts");
  });
});

describe("closeTab", () => {
  it("closes and activates the neighbor", () => {
    let tabs: CodeTab[] = [];
    let active: string | null = null;
    for (const rel of ["a.ts", "b.ts", "c.ts"]) {
      const next = openTab(tabs, { rootId: "root-1", rootName: "r", rel, name: rel });
      tabs = next.tabs;
      active = next.active;
    }
    const closed = closeTab(tabs, "root-1::c.ts", active);
    expect(closed.tabs.map((t) => t.rel)).toEqual(["a.ts", "b.ts"]);
    expect(closed.active).toBe("root-1::b.ts");
    const all = closeTab(closeTab(closed.tabs, "root-1::a.ts", closed.active).tabs, "root-1::b.ts", "root-1::b.ts");
    expect(all.tabs).toEqual([]);
    expect(all.active).toBeNull();
  });
});

describe("disambiguation", () => {
  it("marks duplicated names with their root", () => {
    const tabs = [tab("root-1", "main.ts", "main.ts", "frontend"), tab("root-2", "src/main.ts", "main.ts", "backend")];
    expect(duplicatedNames(tabs)).toEqual(new Set(["main.ts"]));
    expect(tabQualifier(tabs[0], tabs)).toBe("frontend");
    expect(tabQualifier(tabs[1], tabs)).toBe("backend · src");
    const solo = [tab("root-1", "alone.ts", "alone.ts")];
    expect(tabQualifier(solo[0], solo)).toBe("");
  });
});

describe("languageForFile", () => {
  it("infers from the extension and falls back to plain text", () => {
    expect(languageForFile("src/a.ts")).toBe("typescript");
    expect(languageForFile("a.tsx")).toBe("typescript");
    expect(languageForFile("a.rs")).toBe("rust");
    expect(languageForFile("a.json")).toBe("json");
    expect(languageForFile("a.md")).toBe("markdown");
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("no-extension")).toBe("plaintext");
    expect(languageForFile("a.odd")).toBe("plaintext");
  });

  it("openTab sets the initial language", () => {
    const next = openTab([], { rootId: "root-1", rootName: "r", rel: "a.rs", name: "a.rs" });
    expect(next.tabs[0].language).toBe("rust");
    expect(next.tabs[0].dirty).toBe(false);
  });
});

describe("fnv1aHex", () => {
  it("is stable and tells contents apart", () => {
    // Vectors shared with `ruth-code::fnv1a_hex` (UTF-8 bytes).
    expect(fnv1aHex("")).toBe("811c9dc5");
    expect(fnv1aHex("hola")).toBe("b2c65197");
    expect(fnv1aHex("♥")).toBe("40c382c3");
    expect(fnv1aHex("hola")).not.toBe(fnv1aHex("hola!"));
    expect(fnv1aHex("uno dos")).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("analyzableLanguage", () => {
  it("classifies by extension", () => {
    expect(analyzableLanguage("a.ts")).toBe("ts");
    expect(analyzableLanguage("src/A.TSX")).toBe("ts");
    expect(analyzableLanguage("lib.rs")).toBe("rust");
    expect(analyzableLanguage("a.json")).toBeNull();
    expect(analyzableLanguage("Makefile")).toBeNull();
  });
});

describe("tabsOfRoot", () => {
  it("lists the tabs of a root", () => {
    const tabs = [tab("root-1", "a.ts", "a.ts"), tab("root-2", "b.ts", "b.ts")];
    expect(tabsOfRoot(tabs, "root-2")).toEqual(["root-2::b.ts"]);
  });
});

describe("parentDir", () => {
  it("returns the containing folder or the root", () => {
    expect(parentDir("src/app/model.ts")).toBe("src/app");
    expect(parentDir("model.ts")).toBe("");
    expect(parentDir("a/b/c.rs")).toBe("a/b");
  });
});

describe("folderScopeOutcome", () => {
  it("tells additions, cap, empties and duplicates apart", () => {
    expect(folderScopeOutcome(3, 3, 3, 20)).toBe("added");
    expect(folderScopeOutcome(3, 1, 20, 20)).toBe("full");
    expect(folderScopeOutcome(0, 0, 5, 20)).toBe("none");
    expect(folderScopeOutcome(2, 0, 5, 20)).toBe("dupes");
    // The cap wins over any other case.
    expect(folderScopeOutcome(0, 0, 20, 20)).toBe("full");
  });
});
