// TypeScript analysis worker: the AST is walked off the UI thread.
// The message carries already-read files; the response, the IR.
import { analyzeTsFiles } from "./tsAnalyze";
import { STRUCTURE_LIMITS } from "./structureTypes";
import type { StructureInput, StructureResult } from "./structureTypes";

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<{ files: StructureInput[] }>) => void) | null;
  postMessage: (message: StructureResult) => void;
};

worker.onmessage = (event) => {
  try {
    worker.postMessage(analyzeTsFiles(event.data.files));
  } catch (raw) {
    // A total failure does not hang the UI: per-file error, no symbols.
    worker.postMessage({
      files: event.data.files.map((file) => ({
        rootId: file.rootId,
        rel: file.rel,
        hash: file.hash,
        bytes: file.content.length,
        language: null,
        status: "error",
        message: raw instanceof Error ? raw.message : "Analysis failed.",
      })),
      symbols: [],
      relations: [],
      endpoints: [],
      calls: [],
      symbolsTruncated: false,
      relationsTruncated: false,
      endpointsTruncated: false,
      callsTruncated: false,
      limits: STRUCTURE_LIMITS,
    });
  }
};
