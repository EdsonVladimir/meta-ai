import { describe, expect, it } from "vitest";
import {
  EMPTY_RENDER,
  buildLinkIndex,
  designTargets,
  isDesignActionable,
  isUpdateGeneration,
  parseSpecText,
  prettySpec,
  renderReducer,
  resumableUpdate,
  updateGenerationsFor,
  upsertDesignGeneration,
} from "./coordination";
import type { DesignGenerationDto, DesignProposalDto } from "./types";
import type { ArtifactDto, RequirementDetail } from "../requirements/types";

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
    { id: "req-3", projectId: "proy-1", moduleId: "mod-2", kind: "requirement", title: null, archived: false },
    { id: "flujo-4", projectId: "proy-1", moduleId: "mod-2", kind: "flow", title: null, archived: false },
    { id: "mer-5", projectId: "proy-1", moduleId: "mod-2", kind: "data_model", title: null, archived: false },
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

describe("update generations", () => {
  function update(id: string, target: string, stale = false): DesignGenerationDto {
    return {
      ...generation(id, stale),
      targetArtifactId: target,
      targetVersionId: `${target}-v1`,
    };
  }

  it("distingue creaciones de actualizaciones por objetivo", () => {
    expect(isUpdateGeneration(generation("gen-1"))).toBe(false);
    expect(isUpdateGeneration(update("gen-2", "flujo-4"))).toBe(true);
    expect(isUpdateGeneration({ ...update("gen-3", ""), targetArtifactId: "" })).toBe(false);
  });

  it("filtra propuestas por artefacto objetivo", () => {
    const gens = [generation("gen-1"), update("gen-2", "flujo-4"), update("gen-3", "mer-5")];
    expect(updateGenerationsFor(gens, "flujo-4").map((g) => g.id)).toEqual(["gen-2"]);
    expect(updateGenerationsFor(gens, "flujo-9")).toEqual([]);
  });

  it("retoma la más reciente pendiente y fresca", () => {
    const gens = [
      update("gen-1", "flujo-4", true),
      { ...update("gen-2", "flujo-4"), proposal: proposal({ state: "accepted" }) },
      update("gen-3", "flujo-4"),
    ];
    expect(resumableUpdate(gens, "flujo-4")?.id).toBe("gen-3");
    expect(resumableUpdate(gens.slice(0, 2), "flujo-4")).toBeNull();
    expect(resumableUpdate(gens, "mer-5")).toBeNull();
  });
});

function detail(
  id: string,
  kind: string,
  versions: Array<{ id: string; sources?: string[] }>,
  current: string,
): RequirementDetail {
  return {
    artifact: { id, projectId: "p", moduleId: "m", kind, title: null, archived: false },
    versions: versions.map((v, i) => ({
      id: v.id,
      number: i + 1,
      content: "c",
      provenance: { kind: "human", by: "ana" },
      sources: v.sources ?? [],
    })),
    approvals: [],
    currentVersionId: current,
  };
}

describe("buildLinkIndex", () => {
  // req-1 (v1, v2 actual), req-2 (v1); flujo-1 fija req-1-v2 y req-2-v1;
  // mer-2 fija req-1-v1 (antigua) y flujo-1-v1 (intermedio).
  const details = [
    detail("req-1", "requirement", [{ id: "req-1-v1" }, { id: "req-1-v2" }], "req-1-v2"),
    detail("req-2", "requirement", [{ id: "req-2-v1" }], "req-2-v1"),
    detail("flujo-1", "flow", [{ id: "flujo-1-v1", sources: ["req-1-v2", "req-2-v1"] }], "flujo-1-v1"),
    detail(
      "mer-2",
      "data_model",
      [{ id: "mer-2-v1", sources: ["req-1-v1", "flujo-1-v1"] }],
      "mer-2-v1",
    ),
    detail("flujo-9", "flow", [{ id: "flujo-9-v1", sources: ["mer-2-v1"] }], "flujo-9-v1"),
  ];

  it("vincula diseños directos con sus versiones fijadas", () => {
    const index = buildLinkIndex(details);
    const links = index.byRequirement["req-1"];
    expect(links.map((l) => [l.artifactId, l.link])).toEqual([
      ["flujo-1", "direct"],
      ["mer-2", "direct"],
      ["flujo-9", "transitive"],
    ]);
    expect(links[0].pinnedVersions).toEqual(["req-1-v2"]);
    expect(links[0].stale).toBe(false);
  });

  it("marca vínculos a versiones antiguas y la vía transitiva", () => {
    const index = buildLinkIndex(details);
    const links = index.byRequirement["req-1"];
    const legacy = links.find((l) => l.artifactId === "mer-2");
    expect(legacy?.stale).toBe(true);
    expect(legacy?.pinnedVersions).toEqual(["req-1-v1"]);
    const transitive = links.find((l) => l.artifactId === "flujo-9");
    expect(transitive?.link).toBe("transitive");
    expect(transitive?.via).toContain("mer-2");
  });

  it("calcula vigencia por diseño desde fuentes exactas", () => {
    const index = buildLinkIndex(details);
    expect(index.freshness["flujo-1"].stale).toBe(false);
    expect(index.freshness["mer-2"].stale).toBe(true);
    const pins = index.freshness["mer-2"].pins;
    expect(pins.find((p) => p.versionId === "req-1-v1")).toMatchObject({
      artifactId: "req-1",
      currentVersionId: "req-1-v2",
      stale: true,
    });
    expect(pins.find((p) => p.versionId === "flujo-1-v1")?.stale).toBe(false);
  });

  it("un diseño compartido aparece bajo cada requisito fuente", () => {
    const index = buildLinkIndex(details);
    expect(index.byRequirement["req-2"].map((l) => l.artifactId)).toContain("flujo-1");
    expect(index.byRequirement["req-1"].map((l) => l.artifactId)).toContain("flujo-1");
  });

  it("ignora versiones desconocidas sin inventar vínculos", () => {
    const ghost = detail(
      "flujo-x",
      "flow",
      [{ id: "flujo-x-v1", sources: ["req-999-v1"] }],
      "flujo-x-v1",
    );
    const index = buildLinkIndex([...details, ghost]);
    expect(index.byRequirement["req-1"].some((l) => l.artifactId === "flujo-x")).toBe(false);
    expect(index.freshness["flujo-x"].stale).toBe(false);
    expect(index.freshness["flujo-x"].pins[0].artifactId).toBeNull();
  });

  it("requisito sin diseños produce lista vacía", () => {
    const solo = detail("req-solo", "requirement", [{ id: "req-solo-v1" }], "req-solo-v1");
    const index = buildLinkIndex([solo]);
    expect(index.byRequirement["req-solo"]).toEqual([]);
  });
});
