// Analysis worker client: creates it on demand, discards it on
// response and, when the environment lacks workers, falls back to
// direct analysis (in a deferred chunk, never in the initial bundle).
import type { StructureInput, StructureResult } from "./structureTypes";

const WORKER_TIMEOUT_MS = 30_000;

async function analyzeDirect(files: StructureInput[]): Promise<StructureResult> {
  const { analyzeTsFiles } = await import("./tsAnalyze");
  return analyzeTsFiles(files);
}

/** Analyzes TypeScript off the UI thread when possible. */
export function defaultAnalyzeTs(files: StructureInput[]): Promise<StructureResult> {
  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL("./structureWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = null;
    }
    if (worker === null) {
      void analyzeDirect(files).then(resolve);
      return;
    }
    const active: Worker = worker;
    const timer = setTimeout(() => {
      active.terminate();
      void analyzeDirect(files).then(resolve);
    }, WORKER_TIMEOUT_MS);
    active.onmessage = (event: MessageEvent<StructureResult>) => {
      clearTimeout(timer);
      active.terminate();
      resolve(event.data);
    };
    active.onerror = () => {
      clearTimeout(timer);
      active.terminate();
      void analyzeDirect(files).then(resolve);
    };
    active.postMessage({ files });
  });
}
