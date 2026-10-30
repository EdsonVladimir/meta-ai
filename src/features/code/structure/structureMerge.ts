// Per-language result merging: concatenates files, symbols,
// relations, endpoints and calls. Cross-language references stay
// unresolved: each analyzer only sees its own set (documented). API
// joins compute later, over the merged result (`apiLinks.ts`).
import type { StructureResult } from "./structureTypes";

export function emptyResult(): StructureResult {
  return {
    files: [],
    symbols: [],
    relations: [],
    endpoints: [],
    calls: [],
    symbolsTruncated: false,
    relationsTruncated: false,
    endpointsTruncated: false,
    callsTruncated: false,
    limits: {
      maxFiles: 0,
      maxSymbols: 0,
      maxRelations: 0,
      maxMembers: 0,
      maxEndpoints: 0,
      maxCalls: 0,
    },
  };
}

export function combineResults(parts: StructureResult[]): StructureResult {
  const nonEmpty = parts.filter((part) => part.files.length > 0);
  return {
    files: nonEmpty.flatMap((part) => part.files),
    symbols: nonEmpty.flatMap((part) => part.symbols),
    relations: nonEmpty.flatMap((part) => part.relations),
    endpoints: nonEmpty.flatMap((part) => part.endpoints),
    calls: nonEmpty.flatMap((part) => part.calls),
    symbolsTruncated: nonEmpty.some((part) => part.symbolsTruncated),
    relationsTruncated: nonEmpty.some((part) => part.relationsTruncated),
    endpointsTruncated: nonEmpty.some((part) => part.endpointsTruncated),
    callsTruncated: nonEmpty.some((part) => part.callsTruncated),
    limits: nonEmpty[0]?.limits ?? emptyResult().limits,
  };
}
