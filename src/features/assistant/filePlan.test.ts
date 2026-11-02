import { describe, expect, it } from "vitest";
import { collectPlanPaths, fitPlan } from "./filePlan";

const file = (rel: string, role: string) => ({ rel, role, reason: "" });

describe("collectPlanPaths", () => {
  it("lists source paths and skips generated folders and large files", async () => {
    const tree: Record<string, Array<{ name: string; rel: string; kind: string; size: number | null }>> = {
      "": [
        { name: "src", rel: "src", kind: "dir", size: null },
        { name: "playwright-report", rel: "playwright-report", kind: "dir", size: null },
        { name: "big.ts", rel: "big.ts", kind: "file", size: 300_000 },
        { name: "a.spec.ts", rel: "a.spec.ts", kind: "file", size: 5 },
      ],
      src: [{ name: "a.ts", rel: "src/a.ts", kind: "file", size: 10 }],
      "playwright-report": [{ name: "x.html", rel: "playwright-report/x.html", kind: "file", size: 1 }],
    };
    const out = await collectPlanPaths("", async (rel) => ({ entries: tree[rel] ?? [] }));
    expect(out).toEqual([{ rel: "src/a.ts", size: 10 }]);
  });
});

describe("fitPlan", () => {
  const sizes = new Map([
    ["m.ts", 60],
    ["p.ts", 60],
    ["s.ts", 60],
    ["huge.ts", 90_000],
  ]);

  it("puts files to change first and says what did not fit", () => {
    const out = fitPlan([file("p.ts", "pattern"), file("m.ts", "modify")], sizes, () => false, 100);
    expect(out.scope).toEqual(["m.ts"]);
    expect(out.leftOut).toEqual(["p.ts"]);
  });

  it("uses signatures when known and whole files when not", () => {
    expect(fitPlan([file("s.ts", "signatures")], sizes, () => true).signatures).toEqual(["s.ts"]);
    expect(fitPlan([file("s.ts", "signatures")], sizes, () => false).scope).toEqual(["s.ts"]);
  });

  it("flags a file to change that Muse would only see in part", () => {
    expect(fitPlan([file("huge.ts", "modify")], sizes, () => false).partial).toEqual(["huge.ts"]);
    expect(fitPlan([file("huge.ts", "pattern")], sizes, () => false).partial).toEqual([]);
  });
});
