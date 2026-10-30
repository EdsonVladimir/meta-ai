// @vitest-environment jsdom
// Analysis worker client: without Worker in the environment it falls
// back to direct analysis and resolves with the same result.
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAnalyzeTs } from "./tsWorkerClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tsWorkerClient", () => {
  it("without Worker uses direct analysis", async () => {
    vi.stubGlobal("Worker", undefined);
    const result = await defaultAnalyzeTs([
      {
        rootId: "root-1",
        rel: "a.ts",
        content: "export class Tienda { comprar(): void {} }",
        hash: "h1",
      },
    ]);
    expect(result.files.length).toBe(1);
    expect(result.symbols.some((s) => s.name === "Tienda")).toBe(true);
  });

  it("when the worker fails answers through the direct path", async () => {
    // Worker that exists but breaks instantly: onerror → direct.
    class BrokenWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      constructor(_url: URL, _opts?: object) {
        queueMicrotask(() => this.onerror?.());
      }
      postMessage(): void {}
      terminate(): void {}
    }
    vi.stubGlobal("Worker", BrokenWorker);
    const result = await defaultAnalyzeTs([
      { rootId: "root-1", rel: "a.ts", content: "export const x = 1;", hash: "h2" },
    ]);
    expect(result.files.length).toBe(1);
  });
});
