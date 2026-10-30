// In-memory analysis summaries: boards publish, Overview reads.
// Session-only, keyed by analyzed scope (`rootId::rel`); entries
// carry their own timestamp and never pretend to track disk changes
// (re-analysis republishes).
export interface RootAnalysisSummary {
  rootId: string;
  /** Analyzed folder relative to the root (`""` is the whole root). */
  scopeRel: string;
  /** Readable scope name (project or folder). */
  scopeName: string;
  files: number;
  edges: number;
  truncated: boolean;
  at: number;
}

const summaries = new Map<string, RootAnalysisSummary>();

export function publishAnalysisSummary(summary: RootAnalysisSummary): void {
  summaries.set(`${summary.rootId}::${summary.scopeRel}`, { ...summary });
}

export function readAnalysisSummaries(): RootAnalysisSummary[] {
  return [...summaries.values()].map((summary) => ({ ...summary }));
}

export function clearAnalysisSummaries(): void {
  summaries.clear();
}
