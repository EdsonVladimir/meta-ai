import { describe, expect, it } from "vitest";
import { fileIconForName } from "./fileIcons";

describe("file icons", () => {
  it("tells TypeScript, Rust and data apart", () => {
    expect(fileIconForName("src/model.ts")).toMatchObject({ kind: "code", badge: "TS" });
    expect(fileIconForName("src/lib.rs")).toMatchObject({ kind: "code", badge: "RS" });
    expect(fileIconForName("data.json")).toMatchObject({ kind: "data", badge: "{}" });
  });

  it("recognizes special names and uses default text", () => {
    expect(fileIconForName("Dockerfile")).toMatchObject({ badge: "D", label: "Dockerfile" });
    expect(fileIconForName("Makefile")).toMatchObject({ badge: "M", label: "Makefile" });
    expect(fileIconForName("notes")).toMatchObject({ kind: "text", badge: "", label: "File" });
  });

  it("covers images, xml, styles and environment", () => {
    expect(fileIconForName("before.png")).toMatchObject({ kind: "image", badge: "IM" });
    expect(fileIconForName("logo.svg")).toMatchObject({ kind: "image", label: "Image" });
    expect(fileIconForName("view.xml")).toMatchObject({ kind: "markup", badge: "‹›" });
    expect(fileIconForName("theme.scss")).toMatchObject({ kind: "style", badge: "#" });
    expect(fileIconForName(".env")).toMatchObject({ kind: "config", badge: "≡" });
    expect(fileIconForName(".prettierrc")).toMatchObject({ kind: "text", label: "File" });
  });
});
