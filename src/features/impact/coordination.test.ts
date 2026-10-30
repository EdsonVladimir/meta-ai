import { describe, expect, test } from "vitest";
import {
  countPendingUnique,
  impactStatus,
  isStaleImpactResponse,
  MAX_GRAPH_NODES,
  paginate,
} from "./coordination";
import type { ImpactReportDto } from "./types";

function report(pending: boolean[]): ImpactReportDto {
  return {
    projectId: "proy-1",
    origin: {
      artifact: { id: "req-1", projectId: "proy-1", moduleId: "mod-1", kind: "requirement", title: null, archived: false },
      fromVersion: { id: "req-1-v1", number: 1, content: "before" },
      currentVersion: { id: "req-1-v2", number: 2, content: "now" },
    },
    affected: pending.map((requiresReview, i) => ({
      artifact: { id: `flujo-${i}`, projectId: "proy-1", moduleId: "mod-1", kind: "flow", title: null, archived: false },
      currentVersionId: `flujo-${i}-v1`,
      currentNumber: 1,
      requiresReview,
      staleSources: [],
      pins: [],
      approvals: [],
      approvedBefore: false,
      paths: [["req-1", `flujo-${i}`]],
    })),
  };
}

describe("isStaleImpactResponse", () => {
  test("only the exact query response counts", () => {
    expect(isStaleImpactResponse("a", "a")).toBe(false);
    expect(isStaleImpactResponse("a", "b")).toBe(true);
  });
});

describe("countPendingUnique", () => {
  test("counts pending items without duplicating artifacts", () => {
    const base = report([true, false, true]);
    expect(countPendingUnique(base)).toBe(2);
    const dup = report([true]);
    dup.affected.push({ ...dup.affected[0] });
    expect(countPendingUnique(dup)).toBe(1);
    expect(countPendingUnique(report([]))).toBe(0);
  });
});

describe("paginate", () => {
  test("bounded windows with the total intact", () => {
    expect(paginate(25, 0, 10)).toEqual({ page: 0, pages: 3, start: 0, end: 10 });
    expect(paginate(25, 2, 10)).toEqual({ page: 2, pages: 3, start: 20, end: 25 });
    expect(paginate(25, 9, 10).page).toBe(2);
    expect(paginate(0, 0, 10)).toEqual({ page: 0, pages: 1, start: 0, end: 0 });
  });
});

describe("impactStatus", () => {
  test("tells pending, pending approval and current apart", () => {
    const base = report([false]).affected[0];
    expect(impactStatus({ ...base, requiresReview: true })).toBe("pending");
    expect(
      impactStatus({ ...base, approvedBefore: true, approvals: [] }),
    ).toBe("awaiting_approval");
    expect(
      impactStatus({
        ...base,
        approvedBefore: true,
        approvals: [{ versionId: "v", approvedBy: "ana", at: "t" }],
      }),
    ).toBe("ok");
    expect(impactStatus(base)).toBe("ok");
    // Pending wins over historical.
    expect(
      impactStatus({ ...base, requiresReview: true, approvedBefore: true }),
    ).toBe("pending");
  });
});

describe("MAX_GRAPH_NODES", () => {
  test("the graph cap is positive and bounded", () => {
    expect(MAX_GRAPH_NODES).toBeGreaterThan(0);
    expect(MAX_GRAPH_NODES).toBeLessThanOrEqual(200);
  });
});
