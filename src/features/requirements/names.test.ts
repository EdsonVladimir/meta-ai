// Pure names and titles: mirror validation and labels.
import { describe, expect, test } from "vitest";
import { artifactLabel, MAX_NAME_CHARS, needsIdSecondary, validateName } from "./names";

describe("validateName", () => {
  test("rejects empties and respects the maximum", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("   ")).not.toBeNull();
    expect(validateName("Sales")).toBeNull();
    expect(validateName("x".repeat(MAX_NAME_CHARS))).toBeNull();
    expect(validateName("x".repeat(MAX_NAME_CHARS + 1))).toContain("120");
  });

  test("counts characters, not bytes or edge spaces", () => {
    expect(validateName("  Sales  ")).toBeNull();
    expect(validateName("ñ".repeat(MAX_NAME_CHARS))).toBeNull();
    expect(validateName("ñ".repeat(MAX_NAME_CHARS + 1))).not.toBeNull();
  });
});

describe("artifactLabel", () => {
  test("title, derived or ID in that order", () => {
    expect(artifactLabel("Title", "First line", "req-1")).toBe("Title");
    expect(artifactLabel(null, "First line", "req-1")).toBe("First line");
    expect(artifactLabel(null, null, "req-1")).toBe("req-1");
    expect(artifactLabel("", "", "req-1")).toBe("req-1");
  });
});

describe("needsIdSecondary", () => {
  test("only when the label hides the ID", () => {
    expect(needsIdSecondary("Title", "req-1")).toBe(true);
    expect(needsIdSecondary("req-1", "req-1")).toBe(false);
  });
});
