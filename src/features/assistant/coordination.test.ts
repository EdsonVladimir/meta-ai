import { describe, expect, it } from "vitest";
import { mergeAssistantHistory, resolveSend } from "./coordination";
import type { DesignGenerationDto } from "../design/types";
import type { GenerationDto } from "../proposals/types";

function reqGeneration(partial: Partial<GenerationDto> = {}): GenerationDto {
  return {
    id: "gen-1",
    projectId: "p",
    moduleId: "m",
    model: "muse-spark-1.3",
    description: "d",
    contextVersionIds: [],
    templateVersion: 1,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    createdAt: "2026-01-02T00:00:00Z",
    stale: false,
    questions: [],
    proposals: [],
    ...partial,
  };
}

function designGeneration(partial: Partial<DesignGenerationDto> = {}): DesignGenerationDto {
  return {
    id: "des-1",
    projectId: "p",
    moduleId: "m",
    kind: "flow",
    model: "muse-spark-1.3",
    contextVersionIds: [],
    templateVersion: 2,
    usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    createdAt: "2026-01-03T00:00:00Z",
    stale: false,
    questions: [],
    proposal: { title: "Flujo", spec: {}, mermaid: "", explanation: "", state: "pending" },
    ...partial,
  };
}

describe("historial del asistente", () => {
  it("combina, ordena por fecha y acota", () => {
    const entries = mergeAssistantHistory(
      [reqGeneration({ id: "gen-1" })],
      [
        designGeneration({ id: "des-1" }),
        designGeneration({
          id: "upd-1",
          createdAt: "2026-01-04T00:00:00Z",
          targetArtifactId: "flujo-1",
          targetVersionId: "flujo-1-v2",
        }),
      ],
    );
    expect(entries.map((e) => e.id)).toEqual(["upd-1", "des-1", "gen-1"]);
    expect(entries[0]).toMatchObject({ kind: "update", tokens: "5+5 = 10", openCount: 1 });
    expect(entries[2]).toMatchObject({ kind: "requirements", title: "0 propuestas" });
  });

  it("marca desactualizadas y cuenta pendientes", () => {
    const entries = mergeAssistantHistory(
      [
        reqGeneration({
          stale: true,
          proposals: [
            { tempId: "t1", title: "A", description: "", acceptance: [], assumptions: [], state: "pending" },
            { tempId: "t2", title: "B", description: "", acceptance: [], assumptions: [], state: "accepted", artifactId: "r1" },
          ],
        }),
      ],
      [],
    );
    expect(entries[0]).toMatchObject({ stale: true, openCount: 1, title: "2 propuestas" });
  });
});

describe("envío explícito", () => {
  it("exige acción y texto; el texto solo alimenta requisitos", () => {
    expect(resolveSend(null, "hola")).toEqual({ ok: false, reason: "no_action" });
    expect(resolveSend("design", "   ")).toEqual({ ok: false, reason: "empty" });
    expect(resolveSend("requirements", "ventas")).toEqual({
      ok: true,
      action: "requirements",
      feedComposer: true,
    });
    expect(resolveSend("design", "ventas")).toEqual({
      ok: true,
      action: "design",
      feedComposer: false,
    });
  });
});
