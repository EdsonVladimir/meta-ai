import { describe, expect, it } from "vitest";
import {
  EMPTY_RENDER,
  designTargets,
  isDesignActionable,
  parseSpecText,
  prettySpec,
  renderReducer,
  upsertDesignGeneration,
} from "./coordination";
import type { DesignGenerationDto, DesignProposalDto } from "./types";
import type { ArtifactDto } from "../requirements/types";

function proposal(overrides: Partial<DesignProposalDto> = {}): DesignProposalDto {
  return {
    title: "Flujo",
    spec: { title: "Flujo" },
    mermaid: "flowchart TD",
    explanation: "E",
    state: "pending",
    artifactId: null,
    ...overrides,
  };
}

function generation(id: string, stale = false): DesignGenerationDto {
  return {
    id,
    projectId: "proy-1",
    moduleId: "mod-2",
    kind: "flow",
    model: "muse-spark-1.3",
    contextVersionIds: ["req-3-v1"],
    templateVersion: 1,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    createdAt: "2026-10-28T12:00:00Z",
    stale,
    questions: [],
    proposal: proposal(),
  };
}

describe("upsertDesignGeneration", () => {
  it("añade al final y sustituye en su posición", () => {
    const next = upsertDesignGeneration([generation("gen-1")], generation("gen-2"));
    expect(next.map((g) => g.id)).toEqual(["gen-1", "gen-2"]);
    const updated = upsertDesignGeneration(next, generation("gen-1", true));
    expect(updated.map((g) => g.id)).toEqual(["gen-1", "gen-2"]);
    expect(updated[0].stale).toBe(true);
  });
});

describe("isDesignActionable", () => {
  it("solo pendiente, fresca y sin trabajo", () => {
    expect(isDesignActionable(proposal(), false, false)).toBe(true);
    expect(isDesignActionable(proposal(), true, false)).toBe(false);
    expect(isDesignActionable(proposal(), false, true)).toBe(false);
    expect(isDesignActionable(proposal({ state: "accepted" }), false, false)).toBe(false);
    expect(isDesignActionable(proposal({ state: "discarded" }), false, false)).toBe(false);
  });
});

describe("designTargets", () => {
  const artifacts: ArtifactDto[] = [
    { id: "req-3", projectId: "proy-1", moduleId: "mod-2", kind: "requirement" },
    { id: "flujo-4", projectId: "proy-1", moduleId: "mod-2", kind: "flow" },
    { id: "mer-5", projectId: "proy-1", moduleId: "mod-2", kind: "data_model" },
  ];

  it("filtra por tipo de diseño", () => {
    expect(designTargets(artifacts, "flow").map((a) => a.id)).toEqual(["flujo-4"]);
    expect(designTargets(artifacts, "data_model").map((a) => a.id)).toEqual(["mer-5"]);
  });
});

describe("prettySpec y parseSpecText", () => {
  it("serializa estable y parsea de vuelta", () => {
    const spec = { title: "T", nodes: [] };
    const text = prettySpec(spec);
    expect(text).toContain("\n");
    const parsed = parseSpecText(text);
    expect(parsed).toEqual({ ok: true, value: spec });
  });

  it("informa JSON inválido sin lanzar", () => {
    const parsed = parseSpecText("{ roto");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("JSON");
  });
});

describe("renderReducer", () => {
  it("retiene el último SVG válido ante errores", () => {
    const loading = renderReducer(EMPTY_RENDER, { type: "start" });
    expect(loading.status).toBe("loading");
    const ready = renderReducer(loading, { type: "ok", svg: "<svg/>" });
    expect(ready).toEqual({ status: "ready", svg: "<svg/>", error: null });
    const failed = renderReducer(ready, { type: "fail", error: "sintaxis" });
    expect(failed.status).toBe("error");
    expect(failed.svg).toBe("<svg/>");
    expect(failed.error).toBe("sintaxis");
    expect(renderReducer(failed, { type: "reset" })).toEqual(EMPTY_RENDER);
  });
});
