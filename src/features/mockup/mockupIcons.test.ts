// Pure tests for the icon catalog: uniqueness, alphabet and search.
// Parity with Rust `MOCKUP_ICONS` is exercised on save (Rust rejects
// foreign ids); the expected catalog content is pinned here.
import { describe, expect, it } from "vitest";
import { MOCKUP_ICON_CATALOG, isMockupIcon, searchMockupIcons } from "./mockupIcons";

describe("MOCKUP_ICON_CATALOG", () => {
  it("has 31 unique icons with an identifier alphabet", () => {
    expect(MOCKUP_ICON_CATALOG).toHaveLength(31);
    const ids = MOCKUP_ICON_CATALOG.map((icon) => icon.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it("recognizes members and rejects foreigners", () => {
    expect(isMockupIcon("save")).toBe(true);
    expect(isMockupIcon("plane")).toBe(false);
    expect(isMockupIcon("")).toBe(false);
  });

  it("searches by label, id or keyword", () => {
    expect(searchMockupIcons("").length).toBe(31);
    expect(searchMockupIcons("save").map((icon) => icon.id)).toContain("save");
    expect(searchMockupIcons("chevron").length).toBe(4);
    expect(searchMockupIcons("zzz")).toEqual([]);
  });
});
