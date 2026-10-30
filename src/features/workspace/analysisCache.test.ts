// analysisCache: publish/read roundtrip, keyed by analyzed scope.
import { afterEach, describe, expect, it } from "vitest";
import {
  clearAnalysisSummaries,
  publishAnalysisSummary,
  readAnalysisSummaries,
} from "./analysisCache";

afterEach(() => clearAnalysisSummaries());

describe("analysisCache", () => {
  it("keeps the latest summary per root", () => {
    publishAnalysisSummary({ rootId: "a", scopeRel: "", scopeName: "a", files: 10, edges: 4, truncated: false, at: 1 });
    publishAnalysisSummary({ rootId: "a", scopeRel: "", scopeName: "a", files: 12, edges: 5, truncated: true, at: 2 });
    publishAnalysisSummary({ rootId: "a", scopeRel: "apps/fe", scopeName: "fe", files: 3, edges: 0, truncated: false, at: 3 });
    const summaries = readAnalysisSummaries();
    expect(summaries).toHaveLength(2);
    expect(summaries.find((s) => s.scopeRel === "")).toMatchObject({ files: 12, at: 2 });
    expect(summaries.find((s) => s.scopeRel === "apps/fe")).toMatchObject({ files: 3 });
  });

  it("returns copies that cannot mutate the cache", () => {
    publishAnalysisSummary({ rootId: "a", scopeRel: "", scopeName: "a", files: 1, edges: 0, truncated: false, at: 1 });
    const [first] = readAnalysisSummaries();
    first.files = 999;
    expect(readAnalysisSummaries()[0].files).toBe(1);
  });
});
