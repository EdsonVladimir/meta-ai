// Code structure contract: the same for TypeScript and Rust. A
// DETECTED model, independent of the requirements domain and the
// proposed designs: analysis creates no approvals, requirements or
// generation dependencies. Everything unverifiable is marked
// unresolved; relations are never invented.
export type StructureLanguage = "ts" | "rust";

export type StructureKind =
  | "class"
  | "interface"
  | "struct"
  | "enum"
  | "trait"
  | "function"
  | "component";

/** 1-based range, ready for Monaco (setSelection/reveal). */
export interface StructureRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export type StructureMemberKind = "field" | "method" | "variant";

export interface StructureMember {
  name: string;
  kind: StructureMemberKind;
  /**
   * Trimmed signature as it appears in the code: `(params): return`
   * for methods, `: type` / `= value` for fields. Never a body.
   */
  detail: string;
  /** Visibility as written; absent = no modifier in the code. */
  visibility?: "public" | "private" | "protected";
  /** Set only when the modifier is present in the code. */
  isStatic?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;
  range?: StructureRange;
  bodyHash?: string;
  paramTypes?: string[];
  returnType?: string | null;
}

export interface StructureSymbol {
  /** Stable and reproducible within the analysis. */
  id: string;
  language: StructureLanguage;
  kind: StructureKind;
  name: string;
  rootId: string;
  rel: string;
  range: StructureRange;
  members: StructureMember[];
  membersTruncated: boolean;
  /** Note when the kind was decided by heuristic (e.g. component). */
  heuristic: string | null;
  /**
   * Decorator names on the declaration (TS only, e.g. "Controller").
   * Optional: Rust and old snapshots omit it.
   */
  decorators?: string[];
  /**
   * Framework module metadata (TS only): plain identifiers named in
   * `@Module`/`@NgModule` metadata arrays, per role (controllers,
   * providers, imports, exports, declarations…). Optional: Rust
   * and old snapshots omit it. Resolution to symbol ids happens in
   * the map model, per batch like relations.
   */
  moduleRefs?: StructureModuleRef[];
  /**
   * Metadata entries skipped while reading module metadata: array
   * elements that are not plain identifiers (calls, spreads,
   * arrows…). 0/undefined means everything was readable.
   */
  moduleOpaque?: number;
  flow?: SymbolFlowFacts;
  component?: ComponentFacts;
}

export interface StructureInjection {
  field: string;
  typeName: string;
  via: "inject" | "constructor" | "repository";
  evidence: string;
}
export interface StructureMemberCall {
  member: string;
  /** Field the call goes through; null for `this.method()`. */
  receiver: string | null;
  method: string;
  /** Source order inside the member, from 0. */
  order: number;
  evidence: string;
}
export interface StructureSignalAccess {
  member: string;
  signal: string;
  access: "read" | "write";
  evidence: string;
}
export interface HttpUrlFact {
  /** `environment.x` property kept as a token, e.g. "urlAcme". */
  base: string | null;
  /** Path text; substitutions appear as `${...}`. */
  path: string;
}
export interface StructureHttpCall {
  member: string;
  verb: string;
  /** null: verb proven, URL not reconstructable. */
  url: HttpUrlFact | null;
  returnType: string | null;
  evidence: string;
}
export interface StructureRepositoryCall {
  member: string;
  /** Entity name from `@InjectRepository(E)`. */
  entity: string;
  method: string;
  evidence: string;
}
export interface StructureRouteFact {
  member: string;
  verb: string;
  path: string;
  bodyType: string | null;
  decorators: string[];
  guards: string[];
  interceptors: string[];
  evidence: string;
}
export interface SymbolFlowFacts {
  injections: StructureInjection[];
  calls: StructureMemberCall[];
  signals: StructureSignalAccess[];
  httpCalls: StructureHttpCall[];
  repositoryCalls: StructureRepositoryCall[];
  routes: StructureRouteFact[];
  /** Calls not followed (dynamic access, computed names). */
  unresolved: string[];
}
export interface TemplateUse {
  /** Tag, or attribute name for directives. */
  name: string;
  kind: "element" | "attribute" | "pipe";
  line: number;
}
export interface TemplateFacts {
  rel: string;
  uses: TemplateUse[];
}
export interface ComponentFacts {
  kind: "component" | "directive" | "pipe";
  /** Selector, or the pipe name. */
  selector: string | null;
  standalone: boolean | null;
  imports: string[];
  templateRel: string | null;
  styleRels: string[];
  /** Set after the assets step. */
  template?: TemplateFacts | null;
  missingAssets?: string[];
}
export interface RouteRecordFact {
  path: string | null;
  component: string | null;
  /** Literal `import()` target of loadComponent/loadChildren. */
  lazyImport: string | null;
  canActivate: string[];
  childOf: string | null;
  evidence: string;
}
export type PipelineScope = "http-client" | "global-guard" | "global-interceptor";
export interface PipelineFact {
  scope: PipelineScope;
  /** Names in registration order. */
  names: string[];
  evidence: string;
}

/** One name listed in a `@Module`/`@NgModule` metadata array. */
export interface StructureModuleRef {
  /** Metadata property it was listed under ("controllers"…). */
  role: string;
  name: string;
}

export type StructureRelationKind = "extends" | "implements" | "references" | "instantiates";

export type StructureResolution = "resolved" | "unresolved" | "ambiguous";

export interface StructureRelation {
  id: string;
  kind: StructureRelationKind;
  from: string;
  /** Target symbol or null when unverified. */
  to: string | null;
  toName: string;
  status: StructureResolution;
  /** Evidence: file:line and origin construct. */
  evidence: string;
}

/**
 * Detected HTTP API point: what a backend EXPOSES (a declared route)
 * or what a frontend CONSUMES (a call). The per-language subset is
 * documented in each extractor; `url` keeps the original literal and
 * the normalization for joining lives in ONE place (`apiLinks.ts`),
 * never in the extractors.
 */
export interface ApiEndpoint {
  /** Stable and reproducible within the analysis. */
  id: string;
  /** Uppercase verb or ALL (matches any method). */
  method: string;
  /** Original literal as it appears in the code. */
  url: string;
  rootId: string;
  rel: string;
  range: StructureRange;
  /** Evidence: file:line and origin construct. */
  evidence: string;
  /** Note when detection is by shape without a verified receiver. */
  note: string | null;
}

/**
 * HTTP call detected in the code (e.g. `fetch`, `axios`, `reqwest`).
 * Absolute ones (`http…`) are kept: the view separates them as
 * external instead of pretending they point at the local backend.
 */
export interface ApiCall {
  id: string;
  method: string;
  url: string;
  rootId: string;
  rel: string;
  range: StructureRange;
  evidence: string;
  note: string | null;
}

export type StructureFileStatus = "ok" | "partial" | "error" | "unsupported";

/**
 * Static module dependency found in a file (TS `import`/`export from`).
 * `resolvedRel` is set only when the specifier points at another analyzed
 * file; anything else (packages, aliases, files outside the scope) stays
 * unresolved with its raw specifier as evidence.
 */
export interface FileImport {
  raw: string;
  resolvedRel: string | null;
  status: "resolved" | "external" | "missing";
  /** 1-based line of the import statement. */
  line: number;
}

export interface StructureFile {
  rootId: string;
  rel: string;
  hash: string;
  bytes: number;
  language: StructureLanguage | null;
  status: StructureFileStatus;
  message: string | null;
  /** Static imports (TS only). Optional: Rust and old snapshots omit it. */
  imports?: FileImport[];
}

export interface StructureLimits {
  maxFiles: number;
  maxSymbols: number;
  maxRelations: number;
  maxMembers: number;
  maxEndpoints: number;
  maxCalls: number;
}

/** Documented analysis caps (here to avoid dragging parsers). */
export const STRUCTURE_LIMITS: StructureLimits = {
  maxFiles: 20,
  maxSymbols: 300,
  maxRelations: 500,
  maxMembers: 50,
  maxEndpoints: 200,
  maxCalls: 200,
};

export interface StructureResult {
  files: StructureFile[];
  symbols: StructureSymbol[];
  relations: StructureRelation[];
  endpoints: ApiEndpoint[];
  calls: ApiCall[];
  symbolsTruncated: boolean;
  relationsTruncated: boolean;
  endpointsTruncated: boolean;
  callsTruncated: boolean;
  limits: StructureLimits;
  routeRecords?: RouteRecordFact[];
  pipeline?: PipelineFact[];
}

/** Analyzer input: already-read content (saved on disk). */
export interface StructureInput {
  rootId: string;
  rel: string;
  content: string;
  hash: string;
}
