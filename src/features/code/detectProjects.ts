// Nested code-project discovery: which folders inside a root look like
// an application, service or package. Pure grouping over manifest
// paths, plus a bounded async runner over injected directory deps.
// Detection never means analysis support: Java/Rust/Python projects
// are listed honestly while maps stay TypeScript-only. Never executes
// project code; never sends anything to Meta. Session-only cache.
import {
  MANIFEST_MAX_DIRS,
  MANIFEST_MAX_FILES,
  MANIFEST_MAX_PARSE_BYTES,
  scanRootTech,
  type ManifestDeps as ScanDeps,
} from "../workspace/manifestScan";

export type CodeProjectKind =
  | "angular"
  | "nestjs"
  | "typescript"
  | "rust"
  | "java"
  | "python";

/** Map analysis support for a detected project (detection ≠ support). */
export type CodeProjectAnalyzer = "ts" | "none";

export interface DetectedCodeProject {
  /** Stable scope key (`rootId::rel`). */
  key: string;
  rootId: string;
  /** Project folder relative to the root (`""` is the root itself). */
  rel: string;
  /** Folder name (the root name when rel is empty). */
  name: string;
  kind: CodeProjectKind;
  /** Manifest paths (relative) backing this project, sorted. */
  manifests: string[];
  analyzer: CodeProjectAnalyzer;
}

export interface PackageSniff {
  name: string | null;
  /** Present when the package declares workspace globs (a container). */
  workspaces: string[] | null;
  /** Dependency names (for Angular/NestJS hints). */
  deps: string[];
}

export type ManifestSniffDeps = ScanDeps;

export interface RootProjects {
  rootId: string;
  projects: DetectedCodeProject[];
  truncated: boolean;
}

/** Strong manifests: their directory is always a project. */
const STRONG_MANIFEST_KIND: Record<string, CodeProjectKind> = {
  "angular.json": "angular",
  "nest-cli.json": "nestjs",
  "pom.xml": "java",
  "build.gradle": "java",
  "build.gradle.kts": "java",
  "cargo.toml": "rust",
  "requirements.txt": "python",
  "pyproject.toml": "python",
  "setup.py": "python",
};

const ANALYZER_FOR_KIND: Record<CodeProjectKind, CodeProjectAnalyzer> = {
  angular: "ts",
  nestjs: "ts",
  typescript: "ts",
  rust: "none",
  java: "none",
  python: "none",
};

function dirOf(rel: string): string {
  const slash = rel.lastIndexOf("/");
  return slash === -1 ? "" : rel.slice(0, slash);
}

function baseOf(rootName: string, rel: string): string {
  if (rel === "") return rootName;
  const slash = rel.lastIndexOf("/");
  return slash === -1 ? rel : rel.slice(slash + 1);
}

function sniffPackageJson(text: string): PackageSniff | null {
  if (text.length > MANIFEST_MAX_PARSE_BYTES) return null;
  try {
    const parsed = JSON.parse(text) as {
      name?: unknown;
      workspaces?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces.filter((w): w is string => typeof w === "string")
      : parsed.workspaces !== undefined &&
          parsed.workspaces !== null &&
          typeof parsed.workspaces === "object" &&
          Array.isArray((parsed.workspaces as { packages?: unknown }).packages)
        ? ((parsed.workspaces as { packages: unknown[] }).packages.filter(
            (w): w is string => typeof w === "string",
          ))
        : null;
    const deps = {
      ...(parsed.devDependencies ?? {}),
      ...(parsed.dependencies ?? {}),
    };
    return {
      name: typeof parsed.name === "string" ? parsed.name : null,
      workspaces: workspaces !== null && workspaces.length > 0 ? workspaces : null,
      deps: Object.keys(deps),
    };
  } catch {
    return null;
  }
}

function kindForPackage(sniff: PackageSniff | null): CodeProjectKind {
  if (sniff !== null) {
    if (sniff.deps.includes("@angular/core")) return "angular";
    if (sniff.deps.includes("@nestjs/core")) return "nestjs";
  }
  return "typescript";
}

/**
 * Groups manifest paths into detected projects. A directory with a
 * strong manifest is a project; `package.json` counts unless it
 * declares workspaces (a monorepo container, not a service).
 * `tsconfig*.json` never creates a project by itself: nested build
 * configs are evidence, not applications. Sorted by rel.
 */
export function detectProjectsFromManifests(
  rootId: string,
  rootName: string,
  manifests: string[],
  packages: Record<string, PackageSniff | null> = {},
): DetectedCodeProject[] {
  const byDir = new Map<string, string[]>();
  for (const rel of manifests) {
    const dir = dirOf(rel);
    const list = byDir.get(dir) ?? [];
    list.push(rel);
    byDir.set(dir, list);
  }
  const projects: DetectedCodeProject[] = [];
  for (const [dir, rels] of byDir) {
    const names = rels.map((rel) => {
      const slash = rel.lastIndexOf("/");
      return (slash === -1 ? rel : rel.slice(slash + 1)).toLowerCase();
    });
    let kind: CodeProjectKind | null = null;
    for (const name of names) {
      const strong = STRONG_MANIFEST_KIND[name];
      if (strong !== undefined) {
        kind = strong;
        break;
      }
    }
    if (kind === null) {
      const packageRel = rels.find((rel) => {
        const slash = rel.lastIndexOf("/");
        return (slash === -1 ? rel : rel.slice(slash + 1)).toLowerCase() === "package.json";
      });
      if (packageRel !== undefined) {
        const sniff = packages[packageRel] ?? null;
        // A workspaces root is a container: its packages (nested
        // dirs) are the projects, never the root itself.
        if (sniff === null || sniff.workspaces === null) kind = kindForPackage(sniff);
      }
    }
    if (kind === null) continue;
    const sorted = [...rels].sort();
    projects.push({
      key: `${rootId}::${dir}`,
      rootId,
      rel: dir,
      name: baseOf(rootName, dir),
      kind,
      manifests: sorted,
      analyzer: ANALYZER_FOR_KIND[kind],
    });
  }
  projects.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return projects;
}

/** Session cache of discovery runs, keyed by root. */
const discoveryCache = new Map<string, RootProjects>();
const discoveryInflight = new Map<string, Promise<RootProjects>>();

/** Forgets every cached discovery (tests and root removal). */
export function clearDiscoveryCache(): void {
  discoveryCache.clear();
  discoveryInflight.clear();
}

async function runDiscovery(
  rootId: string,
  rootName: string,
  deps: ManifestSniffDeps,
  shouldAbort: () => boolean,
): Promise<RootProjects> {
  const scanned = await scanRootTech(rootId, deps, shouldAbort);
  const packages: Record<string, PackageSniff | null> = {};
  const packageRels = scanned.manifests.filter((rel) => {
    const slash = rel.lastIndexOf("/");
    return (slash === -1 ? rel : rel.slice(slash + 1)).toLowerCase() === "package.json";
  });
  for (const rel of packageRels.slice(0, MANIFEST_MAX_FILES)) {
    if (shouldAbort()) break;
    try {
      const content = await deps.readFile(rootId, rel);
      packages[rel] = sniffPackageJson(content.text);
    } catch {
      packages[rel] = null;
    }
  }
  return {
    rootId,
    projects: detectProjectsFromManifests(rootId, rootName, scanned.manifests, packages),
    truncated: scanned.truncated,
  };
}

/**
 * Discovers the detected projects of one root, cached per session
 * (concurrent callers share the in-flight run). Bounded by the
 * manifest scan caps (3 levels, 200 folders); `truncated` says so.
 */
export function discoverRootProjects(
  rootId: string,
  rootName: string,
  deps: ManifestSniffDeps,
  shouldAbort: () => boolean = () => false,
): Promise<RootProjects> {
  const cached = discoveryCache.get(rootId);
  if (cached !== undefined) return Promise.resolve(cached);
  const running = discoveryInflight.get(rootId);
  if (running !== undefined) return running;
  const job = runDiscovery(rootId, rootName, deps, shouldAbort).then((result) => {
    discoveryCache.set(rootId, result);
    discoveryInflight.delete(rootId);
    return result;
  });
  discoveryInflight.set(rootId, job);
  return job;
}

export { MANIFEST_MAX_DIRS };
