// Nombres y títulos puros: validación espejo y etiquetas.
import { describe, expect, test } from "vitest";
import { artifactLabel, MAX_NAME_CHARS, needsIdSecondary, validateName } from "./names";

describe("validateName", () => {
  test("rechaza vacíos y respeta el máximo", () => {
    expect(validateName("")).not.toBeNull();
    expect(validateName("   ")).not.toBeNull();
    expect(validateName("Ventas")).toBeNull();
    expect(validateName("x".repeat(MAX_NAME_CHARS))).toBeNull();
    expect(validateName("x".repeat(MAX_NAME_CHARS + 1))).toContain("120");
  });

  test("cuenta caracteres, no bytes ni espacios extremos", () => {
    expect(validateName("  Ventas  ")).toBeNull();
    expect(validateName("ñ".repeat(MAX_NAME_CHARS))).toBeNull();
    expect(validateName("ñ".repeat(MAX_NAME_CHARS + 1))).not.toBeNull();
  });
});

describe("artifactLabel", () => {
  test("título, derivado o ID en ese orden", () => {
    expect(artifactLabel("Título", "Primera línea", "req-1")).toBe("Título");
    expect(artifactLabel(null, "Primera línea", "req-1")).toBe("Primera línea");
    expect(artifactLabel(null, null, "req-1")).toBe("req-1");
    expect(artifactLabel("", "", "req-1")).toBe("req-1");
  });
});

describe("needsIdSecondary", () => {
  test("solo cuando la etiqueta oculta el ID", () => {
    expect(needsIdSecondary("Título", "req-1")).toBe(true);
    expect(needsIdSecondary("req-1", "req-1")).toBe(false);
  });
});
