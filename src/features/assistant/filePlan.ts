// Muse picks the files for a change: the paths it can choose from and
// how its choice fits the message. Pure with injected IO. A plan holds
// what the change needs, not a fixed count: the bound is the size that
// fits one message, and the files to change go first.
import { COLLECT_SKIPPED_DIR_NAMES } from "../code/archmap/projectMaps";

/** Same bounds as `MAX_PLAN_PATHS` and `MAX_CODE_SCOPE_FILE_CHARS`. */
export const PLAN_MAX_PATHS = 1_500;
export const PLAN_FILE_CHARS = 24_000;
/** Room for file contents in a 160,000-character message. */
export const PLAN_BUDGET_CHARS = 100_000;
const PLAN_MAX_DIRS = 600;
const MAX_READABLE_BYTES = 262_144;
const SOURCE = /\.(ts|tsx|js|jsx|mts|rs|java|kt|py|go|cs|php|rb|html|css|scss|sql|json|md)$/i;
const NOT_SOURCE = /(\.spec\.|\.test\.|\.d\.ts$|\.min\.|package-lock\.json$)/i;
const SKIPPED_DIRS = new Set([
  ...COLLECT_SKIPPED_DIR_NAMES.map((name) => name.toLowerCase()),
  "playwright-report",
  "test-results",
]);

export type PlanRole = "modify" | "pattern" | "signatures";

export interface PlannedFile {
  rel: string;
  role: string;
  reason: string;
}

export interface PlanPath {
  rel: string;
  size: number;
}

interface Entry {
  name: string;
  rel: string;
  kind: string;
  size?: number | null;
}

/** Every path a plan may choose, nearest first. Names only. */
export async function collectPlanPaths(
  rootRel: string,
  listDir: (rel: string) => Promise<{ entries: Entry[] }>,
): Promise<PlanPath[]> {
  const out: PlanPath[] = [];
  const queue = [rootRel];
  let walked = 0;
  while (queue.length > 0 && walked < PLAN_MAX_DIRS && out.length < PLAN_MAX_PATHS) {
    const dir = queue.shift() as string;
    walked += 1;
    const { entries } = await listDir(dir);
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.kind === "dir") {
        if (!SKIPPED_DIRS.has(entry.name.toLowerCase())) queue.push(entry.rel);
      } else if (
        entry.kind === "file" &&
        SOURCE.test(entry.name) &&
        !NOT_SOURCE.test(entry.name) &&
        (entry.size ?? 0) <= MAX_READABLE_BYTES
      ) {
        out.push({ rel: entry.rel, size: entry.size ?? 0 });
      }
    }
  }
  return out.slice(0, PLAN_MAX_PATHS);
}

export interface FittedPlan {
  /** Sent whole. */
  scope: string[];
  /** Sent as classes and methods only. */
  signatures: string[];
  /** Left out: they did not fit. */
  leftOut: string[];
  /** Files to change that Muse will only see in part. */
  partial: string[];
}

/**
 * Fits a plan in one message. Files to change go first, then patterns;
 * a file with no known signatures is sent whole, because a name alone
 * tells Muse nothing. Nothing is cut without saying so.
 */
export function fitPlan(
  planned: PlannedFile[],
  sizes: Map<string, number>,
  hasSignatures: (rel: string) => boolean,
  budget: number = PLAN_BUDGET_CHARS,
): FittedPlan {
  const out: FittedPlan = { scope: [], signatures: [], leftOut: [], partial: [] };
  let used = 0;
  const take = (file: PlannedFile): void => {
    const cost = Math.min(sizes.get(file.rel) ?? PLAN_FILE_CHARS, PLAN_FILE_CHARS);
    if (used + cost > budget) {
      out.leftOut.push(file.rel);
      return;
    }
    used += cost;
    out.scope.push(file.rel);
    if (file.role === "modify" && (sizes.get(file.rel) ?? 0) > PLAN_FILE_CHARS) {
      out.partial.push(file.rel);
    }
  };
  planned.filter((file) => file.role === "modify").forEach(take);
  planned.filter((file) => file.role === "pattern").forEach(take);
  for (const file of planned.filter((entry) => entry.role === "signatures")) {
    if (hasSignatures(file.rel)) out.signatures.push(file.rel);
    else take(file);
  }
  return out;
}
