// Bounded manifest discovery: which stacks a root plausibly holds.
// Shallow breadth-first walk (depth + directory caps) looking only for
// known manifest names; small manifests are read for framework hints.
// Never executes project code; never sends anything to Meta. Results
// are session-only: cheap to recompute, never persisted.

export type DetectedTech =
  | "TypeScript"
  | "Angular"
  | "NestJS"
  | "Rust"
  | "Java"
  | "Python"
  | "Unknown";

/** How deep below the root manifests are looked for (root = 0). */
export const MANIFEST_MAX_DEPTH = 3;
/** Directories visited per root before stopping with truncated=true. */
export const MANIFEST_MAX_DIRS = 200;
/** Manifest paths reported per root. */
export const MANIFEST_MAX_FILES = 40;
/** package.json files larger than this are not parsed for frameworks. */
export const MANIFEST_MAX_PARSE_BYTES = 65536;

export interface RootTech {
  rootId: string;
  techs: DetectedTech[];
  manifests: string[];
  truncated: boolean;
}

interface DirListing {
  entries: Array<{ rel: string; kind: string; name: string }>;
  truncated: boolean;
}

export interface ManifestDeps {
  listDir: (rootId: string, rel: string) => Promise<DirListing>;
  readFile: (rootId: string, rel: string) => Promise<{ text: string }>;
}

const MANIFEST_FILES: Record<string, DetectedTech> = {
  "package.json": "TypeScript",
  "angular.json": "Angular",
  "nest-cli.json": "NestJS",
  "tsconfig.json": "TypeScript",
  "cargo.toml": "Rust",
  "pom.xml": "Java",
  "build.gradle": "Java",
  "build.gradle.kts": "Java",
  "requirements.txt": "Python",
  "pyproject.toml": "Python",
  "setup.py": "Python",
};

function frameworkHints(packageJson: string): DetectedTech[] {
  const found: DetectedTech[] = [];
  try {
    const parsed = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...parsed.devDependencies, ...parsed.dependencies };
    if ("@angular/core" in deps) found.push("Angular");
    if ("@nestjs/core" in deps) found.push("NestJS");
  } catch {
    // Unparseable manifests still count as TypeScript evidence.
  }
  return found;
}

/**
 * Scans one root for manifests. Deterministic breadth-first order;
 * `shouldAbort` (checked per directory) cancels cooperatively and
 * reports what was found so far with truncated=true.
 */
export async function scanRootTech(
  rootId: string,
  deps: ManifestDeps,
  shouldAbort: () => boolean = () => false,
): Promise<RootTech> {
  const techs = new Set<DetectedTech>();
  const manifests: string[] = [];
  const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
  let head = 0;
  let dirsVisited = 0;
  let truncated = false;
  while (head < queue.length) {
    if (shouldAbort()) {
      truncated = true;
      break;
    }
    if (dirsVisited >= MANIFEST_MAX_DIRS) {
      truncated = true;
      break;
    }
    const current = queue[head];
    head += 1;
    dirsVisited += 1;
    let listing: DirListing;
    try {
      listing = await deps.listDir(rootId, current.rel);
    } catch {
      continue;
    }
    if (listing.truncated) truncated = true;
    for (const entry of listing.entries) {
      if (entry.kind === "dir") {
        if (current.depth < MANIFEST_MAX_DEPTH) queue.push({ rel: entry.rel, depth: current.depth + 1 });
        else truncated = true;
        continue;
      }
      if (entry.kind !== "file") continue;
      const tech = MANIFEST_FILES[entry.name.toLowerCase()];
      if (tech === undefined) continue;
      techs.add(tech);
      if (manifests.length < MANIFEST_MAX_FILES) manifests.push(entry.rel);
      else truncated = true;
      if (entry.name.toLowerCase() === "package.json") {
        try {
          const content = await deps.readFile(rootId, entry.rel);
          if (content.text.length <= MANIFEST_MAX_PARSE_BYTES) {
            for (const hint of frameworkHints(content.text)) techs.add(hint);
          }
        } catch {
          // Unreadable manifests keep their filename evidence.
        }
      }
    }
  }
  manifests.sort();
  return {
    rootId,
    techs: techs.size === 0 ? ["Unknown"] : [...techs].sort(),
    manifests,
    truncated,
  };
}
