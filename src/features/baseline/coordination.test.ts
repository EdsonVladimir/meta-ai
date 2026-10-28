import { describe, expect, it } from "vitest";
import {
  blockerTitle,
  defaultZipName,
  formatBytes,
  isStaleBaselineResponse,
  kindLabel,
  prepareKey,
} from "./coordination";

describe("frescura de respuestas", () => {
  it("descarta respuestas de otra consulta", () => {
    expect(isStaleBaselineResponse("a", "b")).toBe(true);
    expect(isStaleBaselineResponse("a", "a")).toBe(false);
  });

  it("la clave incluye proyecto, módulo y selección ordenada", () => {
    const one = prepareKey("p", "m", ["b", "a"]);
    const two = prepareKey("p", "m", ["a", "b"]);
    expect(one).toBe(two);
    expect(prepareKey("p", "m", ["a"])).not.toBe(one);
    expect(prepareKey("p", "other", ["a", "b"])).not.toBe(one);
  });
});

describe("nombre del ZIP", () => {
  it("deriva un nombre seguro del nombre y el ID", () => {
    expect(defaultZipName("Entrega ventas", "base-1")).toBe("entrega-ventas-base-1.zip");
  });

  it("neutraliza separadores y caracteres especiales", () => {
    const name = defaultZipName("../../etc/evil ñandú", "base-../1");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^[a-z0-9-]+\.zip$/);
  });

  it("usa valores por defecto si no queda nada", () => {
    expect(defaultZipName("!!!", "???")).toBe("entrega-baseline.zip");
  });
});

describe("tamaños", () => {
  it("formatea bytes, KB y MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("no inventa valores ante entradas inválidas", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("etiquetas", () => {
  it("nombra tipos y bloqueos conocidos", () => {
    expect(kindLabel("requirement")).toBe("requisito");
    expect(kindLabel("flow")).toBe("flujo");
    expect(kindLabel("data_model")).toBe("modelo ER");
    expect(kindLabel("raro")).toBe("raro");
    expect(blockerTitle("draft")).toBe("Sin aprobar");
    expect(blockerTitle("stale_sources")).toBe("Fuentes desactualizadas");
    expect(blockerTitle("otro")).toBe("otro");
  });
});
