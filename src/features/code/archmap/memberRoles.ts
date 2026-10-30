// Card presentation facts derived from the analysis as extracted,
// never guessed: the file language from its real extension, each
// member's role from its extracted kind and written signature, and
// lifecycle hooks only with framework evidence (an external import
// of the framework plus an `implements` of the hook interface or,
// for Angular, a component/directive decorator). Anything the
// extraction did not capture stays unknown.
import type { StructureMember, StructureRelation, StructureSymbol } from "../structure/structureTypes";

/** Display name per real file extension (lowercase, without the dot). */
const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "TS",
  mts: "TS",
  cts: "TS",
  tsx: "TSX",
  js: "JS",
  mjs: "JS",
  cjs: "JS",
  jsx: "JSX",
  html: "HTML",
  htm: "HTML",
  css: "CSS",
  scss: "SCSS",
  java: "Java",
  rs: "Rust",
  xml: "XML",
  sql: "SQL",
};

/** Language badge from the file's own extension; "Unknown" without one. */
export function languageBadge(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "Unknown";
  const ext = base.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? ext.toUpperCase();
}

/** Long language name for the inspector ("TypeScript file"). */
export function languageName(rel: string): string {
  const badge = languageBadge(rel);
  switch (badge) {
    case "TS":
      return "TypeScript";
    case "TSX":
      return "TypeScript (TSX)";
    case "JS":
      return "JavaScript";
    case "JSX":
      return "JavaScript (JSX)";
    default:
      return badge;
  }
}

export interface LifecycleHook {
  /** Member name as written (e.g. `ngOnInit`). */
  name: string;
  framework: "Angular" | "NestJS";
  /** Why it counts as a hook, in plain words. */
  evidence: string;
}

interface HookFramework {
  framework: LifecycleHook["framework"];
  /** External import specifiers that prove the framework is in use. */
  packages: string[];
  /** Hook method name → the interface that declares it. */
  hooks: Record<string, string>;
  /** Decorators that make a class hook-capable without `implements`. */
  decorators: string[];
}

const HOOK_FRAMEWORKS: HookFramework[] = [
  {
    framework: "Angular",
    packages: ["@angular/core"],
    hooks: {
      ngOnChanges: "OnChanges",
      ngOnInit: "OnInit",
      ngDoCheck: "DoCheck",
      ngAfterContentInit: "AfterContentInit",
      ngAfterContentChecked: "AfterContentChecked",
      ngAfterViewInit: "AfterViewInit",
      ngAfterViewChecked: "AfterViewChecked",
      ngOnDestroy: "OnDestroy",
    },
    decorators: ["Component", "Directive"],
  },
  {
    framework: "NestJS",
    packages: ["@nestjs/common", "@nestjs/core"],
    hooks: {
      onModuleInit: "OnModuleInit",
      onApplicationBootstrap: "OnApplicationBootstrap",
      onModuleDestroy: "OnModuleDestroy",
      beforeApplicationShutdown: "BeforeApplicationShutdown",
      onApplicationShutdown: "OnApplicationShutdown",
    },
    decorators: [],
  },
];

/**
 * Lifecycle hooks of one class with framework evidence. A method name
 * alone never qualifies: the file must import the framework, and the
 * class must implement the hook interface (or, for Angular, carry a
 * component/directive decorator). Rust symbols never qualify.
 */
export function detectLifecycleHooks(
  symbol: StructureSymbol,
  relations: StructureRelation[],
  externals: string[],
): LifecycleHook[] {
  if (symbol.language !== "ts" || (symbol.kind !== "class" && symbol.kind !== "component")) {
    return [];
  }
  const implemented = new Set(
    relations
      .filter((rel) => rel.from === symbol.id && rel.kind === "implements")
      .map((rel) => rel.toName),
  );
  const decorators = symbol.decorators ?? [];
  const found: LifecycleHook[] = [];
  for (const def of HOOK_FRAMEWORKS) {
    const pkg = def.packages.find((name) => externals.includes(name));
    if (pkg === undefined) continue;
    const decorator = def.decorators.find((name) => decorators.includes(name)) ?? null;
    for (const member of symbol.members) {
      if (member.kind !== "method") continue;
      const iface = def.hooks[member.name];
      if (iface === undefined) continue;
      if (implemented.has(iface)) {
        found.push({
          name: member.name,
          framework: def.framework,
          evidence: `implements ${iface}; file imports ${pkg}`,
        });
      } else if (decorator !== null) {
        found.push({
          name: member.name,
          framework: def.framework,
          evidence: `@${decorator} class; file imports ${pkg}`,
        });
      }
    }
  }
  return found;
}

export type MemberRole =
  | "constructor"
  | "lifecycle"
  | "method"
  | "function-property"
  | "property"
  | "variant";

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  constructor: "Constructor",
  lifecycle: "Lifecycle hook",
  method: "Method",
  "function-property": "Property holding a function",
  property: "Property",
  variant: "Variant",
};

/** Icon glyph per role (paired with a label; never color alone). */
export const MEMBER_ROLE_ICON: Record<MemberRole, string> = {
  constructor: "C",
  lifecycle: "M",
  method: "M",
  "function-property": "ƒ",
  property: "P",
  variant: "V",
};

/**
 * A field whose written type or initializer is visibly a function:
 * `: (a: T) => R`, `= (x) => …`, `= async (…) =>`, `= function…`.
 * Truncated signatures that hide the arrow stay plain properties.
 */
function holdsFunction(detail: string): boolean {
  if (/^:\s*(<[^>]*>\s*)?\(.*\)\s*=>/.test(detail)) return true;
  const eq = detail.indexOf("= ");
  if (eq < 0) return false;
  const init = detail.slice(eq + 2);
  return (
    /^(async\s+)?function\b/.test(init) ||
    /^(async\s+)?(<[^>]*>\s*)?\([^)]*\)\s*(:\s*[^=]+)?=>/.test(init) ||
    /^(async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(init)
  );
}

/** Role of one member from its extracted kind and written signature only. */
export function memberRole(
  member: StructureMember,
  symbol: { kind: StructureSymbol["kind"]; lifecycle?: LifecycleHook[] },
): MemberRole {
  if (member.kind === "variant") return "variant";
  if (member.kind === "field") return holdsFunction(member.detail) ? "function-property" : "property";
  if (
    member.name === "constructor" &&
    (symbol.kind === "class" || symbol.kind === "component")
  ) {
    return "constructor";
  }
  if (symbol.lifecycle?.some((hook) => hook.name === member.name) === true) return "lifecycle";
  return "method";
}

export interface SignatureParts {
  /** Parameter list without the parentheses; null when not a call signature. */
  params: string | null;
  /** Written return type; null when not annotated (inferred, unknown here). */
  returns: string | null;
}

/**
 * Splits a written call signature `(params): R` (TS) or
 * `(params) -> R` (Rust) at the top-level closing parenthesis.
 * Non-call details (field types, variants) yield nulls.
 */
export function splitSignature(detail: string): SignatureParts {
  if (!detail.startsWith("(")) return { params: null, returns: null };
  let depth = 0;
  for (let i = 0; i < detail.length; i += 1) {
    const ch = detail[i];
    if (ch === "(" || ch === "[" || ch === "{" || ch === "<") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}" || (ch === ">" && detail[i - 1] !== "=" && detail[i - 1] !== "-")) {
      depth -= 1;
      if (depth === 0 && ch === ")") {
        const params = detail.slice(1, i);
        const rest = detail.slice(i + 1).trim();
        const returns = rest.startsWith(":")
          ? rest.slice(1).trim()
          : rest.startsWith("->")
            ? rest.slice(2).trim()
            : "";
        return { params, returns: returns === "" ? null : returns };
      }
    }
  }
  // Truncated before the closing parenthesis: keep what was written.
  return { params: detail.slice(1), returns: null };
}

export interface MemberCounts {
  methods: number;
  properties: number;
  variants: number;
}

/** Counter totals per extracted kind (constructors and hooks are methods). */
export function memberCounts(members: StructureMember[]): MemberCounts {
  const counts: MemberCounts = { methods: 0, properties: 0, variants: 0 };
  for (const member of members) {
    if (member.kind === "method") counts.methods += 1;
    else if (member.kind === "field") counts.properties += 1;
    else counts.variants += 1;
  }
  return counts;
}

/** Modifiers as written, in source order of importance. */
export function memberModifiers(member: StructureMember): string[] {
  return [
    member.isStatic === true ? "static" : null,
    member.isAsync === true ? "async" : null,
    member.isReadonly === true ? "readonly" : null,
  ].filter((part): part is string => part !== null);
}

/** One member as text: modifiers, name and trimmed signature, never invented. */
export function memberLabel(member: StructureMember): string {
  const flags = [member.visibility ?? null, ...memberModifiers(member)].filter(
    (part): part is string => part !== null,
  );
  const head = [...flags, member.name].join(" ");
  if (member.detail === "") return head;
  return member.detail.startsWith("(") ? `${head}${member.detail}` : `${head} ${member.detail}`;
}
