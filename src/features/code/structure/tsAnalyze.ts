// TypeScript structure extractor over the real AST (ts-compiler,
// TypeScript 5.9: the repo 7 is the native port without a compiler API).
// Pure and synchronous: the worker runs it off the UI thread.
//
// Supported subset:
// - Top-level and namespace-nested classes and interfaces.
// - Declared properties and methods (name + trimmed type/signature).
// - `extends` and `implements`.
// - Type references in fields, parameters and returns.
// - Functions and components (an uppercase function or arrow const in
//   .tsx, as an explicit heuristic).
//
// NOT supported (documented, not invented):
// - Cross-file resolution via imports: global uniqueness only.
// - Conditional, mapped, template-literal types: trimmed as text.
// - Mixins, re-exports (`export *`), `typeof X`.
// - Composition/aggregation inference: everything is `references`.
//
// ARCH MAP additions (English from here, per project decision):
// - Static imports per file (`import` / `export from`), resolved against
//   the analyzed rels of the same root (extension/index probing, `.js` ->
//   `.ts`). Packages, aliases, assets and out-of-scope files stay
//   unresolved with their raw specifier as evidence.
// - Decorator names on classes (e.g. `@Controller("x")` -> "Controller").
// - `new X()` inside symbol bodies -> `instantiates` relations, resolved
//   by the same strict uniqueness rule. Top-level `new` outside any symbol
//   is covered by the file import edge instead.
//
// HTTP APIs (documented subset, same file):
// - ENDPOINTS (what is exposed): `<obj>.<verb>(<literal>, ...)` with a
//   verb in get/post/put/patch/delete/options/head/all and a first
//   text-literal argument starting with `/` (the Express/Hono shape;
//   `all` registers with method ALL).
// - CALLS (what is consumed): `fetch(url, {method}?)`,
//   `axios.<verb>(url)` and `axios({url, method?})`; the URL must be a
//   text literal or a template (substitutions stay as `${...}` and the
//   join normalizes them). Default method: GET.
// - NOT supported: `app.route().get()`, concatenated or variable URLs,
//   `axios(config)` with a non-literal object, `XMLHttpRequest`,
//   websockets and other HTTP clients.
// - Honest limit: any `<obj>.get('/…')` (even a `map.get`) registers
//   as an endpoint by shape; joining with real calls is what gives it
//   meaning in the API view. The one exception: receivers that are
//   `HttpClient` fields (`this.<field>` in `httpClientFieldsOf`) never
//   register — those calls are consumed APIs, recorded as flow facts
//   (`StructureHttpCall`) instead.
//
// Strict resolution: a name only connects when it identifies ONE single
// analyzed symbol. The same name in two files does NOT connect (marked
// ambiguous); missing names are marked unresolved with their evidence.
import ts from "ts-compiler";
import { fnv1aHex } from "../model";
import { STRUCTURE_LIMITS } from "./structureTypes";
import { collectFlowFacts, httpClientFieldsOf } from "./tsFlowFacts";
import { collectHttpInterceptors } from "./tsAngularFacts";
import { collectNestPipeline } from "./tsNestFacts";
import type {
  ApiCall,
  ApiEndpoint,
  PipelineFact,
  StructureInput,
  StructureMember,
  StructureModuleRef,
  StructureRange,
  StructureRelation,
  StructureResult,
  StructureSymbol,
} from "./structureTypes";

interface PendingRef {
  from: string;
  kind: StructureRelation["kind"];
  toName: string;
  evidence: string;
  ordinal: number;
}

interface RawImport {
  raw: string;
  line: number;
  names: string[];
}

interface FileSymbols {
  symbols: StructureSymbol[];
  refs: PendingRef[];
  endpoints: ApiEndpoint[];
  calls: ApiCall[];
  rawImports: RawImport[];
  partial: boolean;
  message: string | null;
  pipeline: PipelineFact[];
}

const HTTP_VERBS = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
const ROUTE_VERBS = new Set([...HTTP_VERBS, "all"]);

/** Static URL literal: text or template (substitutions → `${...}`). */
function staticUrl(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let out = node.head.text;
    for (const span of node.templateSpans) {
      out += "${...}";
      out += span.literal.text;
    }
    return out;
  }
  return null;
}

/** `method: "POST"` inside a literal options object. */
function methodOfOptions(node: ts.Expression | undefined): string | null {
  if (node === undefined || !ts.isObjectLiteralExpression(node)) return null;
  for (const prop of node.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      prop.name !== undefined &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "method" &&
      ts.isStringLiteral(prop.initializer) &&
      prop.initializer.text.trim() !== ""
    ) {
      return prop.initializer.text.trim().toUpperCase();
    }
  }
  return null;
}

function apiId(rootId: string, rel: string, ordinal: number): string {
  return `tsapi:${rootId}:${rel}#${ordinal}`;
}

function isNamed(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name;
}

function toRange(source: ts.SourceFile, node: ts.Node): StructureRange {
  const start = source.getLineAndCharacterOfPosition(node.getStart(source));
  const end = source.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: start.line + 1,
    startCol: start.character + 1,
    endLine: end.line + 1,
    endCol: end.character + 1,
  };
}

function evidenceOf(source: ts.SourceFile, node: ts.Node, what: string): string {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${source.fileName}:${pos.line + 1} (${what})`;
}

function shortText(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** FNV-1a of the node text with whitespace runs collapsed: body changes move it, formatting does not. */
function memberBodyHash(source: ts.SourceFile, node: ts.Node): string {
  return fnv1aHex(node.getText(source).replace(/\s+/g, " "));
}

function paramTypesOf(
  source: ts.SourceFile,
  parameters: readonly ts.ParameterDeclaration[],
): string[] {
  return parameters.map((param) =>
    param.type === undefined ? "unknown" : param.type.getText(source),
  );
}

function signatureTypesOf(
  source: ts.SourceFile,
  member:
    | ts.MethodDeclaration
    | ts.MethodSignature
    | ts.GetAccessorDeclaration
    | ts.SetAccessorDeclaration,
): { paramTypes: string[]; returnType: string | null } {
  // Setters cannot declare a return type; anything else missing one is null.
  const type = ts.isSetAccessorDeclaration(member) ? undefined : member.type;
  return {
    paramTypes: paramTypesOf(source, member.parameters),
    returnType: type === undefined ? null : shortText(type.getText(source), 40),
  };
}

/** Type names mentioned in a type node (unresolved). */
function typeNamesOf(node: ts.Node): string[] {
  const names: string[] = [];
  function visit(current: ts.Node): void {
    if (ts.isTypeReferenceNode(current)) {
      const name = current.typeName;
      if (ts.isIdentifier(name)) names.push(name.text);
      // QualifiedName (A.B): the root registers to avoid inventing.
      else if (ts.isQualifiedName(name)) names.push(name.left.getText());
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return names;
}

function memberDetail(source: ts.SourceFile, node: ts.Node): string {
  return shortText(node.getText(source));
}

/** Modifiers as written on the declaration (sparse: absent = not present). */
function memberFlags(node: ts.Node): {
  visibility?: "public" | "private" | "protected";
  isStatic?: boolean;
  isAsync?: boolean;
  isReadonly?: boolean;
} {
  const get = ts.getModifiers as unknown as
    | ((target: ts.Node) => readonly ts.Modifier[] | undefined)
    | undefined;
  const found: readonly ts.Modifier[] =
    get?.(node) ?? (node as { modifiers?: readonly ts.Modifier[] }).modifiers ?? [];
  const flags: {
    visibility?: "public" | "private" | "protected";
    isStatic?: boolean;
    isAsync?: boolean;
    isReadonly?: boolean;
  } = {};
  for (const mod of found) {
    switch (mod.kind) {
      case ts.SyntaxKind.PublicKeyword:
        flags.visibility = "public";
        break;
      case ts.SyntaxKind.PrivateKeyword:
        flags.visibility = "private";
        break;
      case ts.SyntaxKind.ProtectedKeyword:
        flags.visibility = "protected";
        break;
      case ts.SyntaxKind.StaticKeyword:
        flags.isStatic = true;
        break;
      case ts.SyntaxKind.AsyncKeyword:
        flags.isAsync = true;
        break;
      case ts.SyntaxKind.ReadonlyKeyword:
        flags.isReadonly = true;
        break;
    }
  }
  return flags;
}

/**
 * Trimmed signature, never a body: `(params): return` for methods,
 * `: type` / `= value` for fields.
 */
function signatureDetail(source: ts.SourceFile, node: ts.Node): string {
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    const params = node.parameters.map((p) => shortText(p.getText(source), 40)).join(", ");
    const returns =
      "type" in node && node.type !== undefined
        ? `: ${shortText(node.type.getText(source), 40)}`
        : "";
    return shortText(`(${params})${returns}`);
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    const type =
      node.type !== undefined ? `: ${shortText(node.type.getText(source), 40)}` : "";
    const init =
      ts.isPropertyDeclaration(node) && node.initializer !== undefined
        ? ` = ${shortText(node.initializer.getText(source), 24)}`
        : "";
    return shortText(`${type}${init}`.trim());
  }
  return memberDetail(source, node);
}

function collectMembers(
  source: ts.SourceFile,
  members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
  limit: number,
): { members: StructureMember[]; truncated: boolean } {
  const out: StructureMember[] = [];
  let truncated = false;
  const push = (member: StructureMember): void => {
    if (out.length >= limit) {
      truncated = true;
      return;
    }
    out.push(member);
  };
  for (const member of members) {
    if (
      ts.isPropertyDeclaration(member) ||
      ts.isPropertySignature(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isMethodSignature(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      const name = member.name !== undefined ? member.name.getText(source) : "(anonymous)";
      const isMethod =
        ts.isMethodDeclaration(member) ||
        ts.isMethodSignature(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member);
      const signature =
        ts.isMethodDeclaration(member) ||
        ts.isMethodSignature(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
          ? signatureTypesOf(source, member)
          : null;
      push({
        name: shortText(name, 60),
        kind: isMethod ? "method" : "field",
        detail: signatureDetail(source, member),
        range: toRange(source, member),
        bodyHash: memberBodyHash(source, member),
        ...(signature ?? {}),
        ...memberFlags(member),
      });
    } else if (ts.isConstructorDeclaration(member)) {
      push({
        name: "constructor",
        kind: "method",
        detail: signatureDetail(source, member),
        range: toRange(source, member),
        bodyHash: memberBodyHash(source, member),
        paramTypes: paramTypesOf(source, member.parameters),
        returnType: null,
        ...memberFlags(member),
      });
      // Parameter properties (`constructor(private x)`) are fields too.
      for (const param of member.parameters) {
        if (!ts.isIdentifier(param.name)) continue;
        const flags = memberFlags(param);
        if (flags.visibility === undefined && flags.isReadonly !== true) continue;
        const type =
          param.type !== undefined ? `: ${shortText(param.type.getText(source), 40)}` : "";
        push({
          name: param.name.text,
          kind: "field",
          detail: type,
          range: toRange(source, param),
          bodyHash: memberBodyHash(source, param),
          ...flags,
        });
      }
    } else if (ts.isIndexSignatureDeclaration(member)) {
      push({
        name: "[index]",
        kind: "field",
        detail: memberDetail(source, member),
        range: toRange(source, member),
        bodyHash: memberBodyHash(source, member),
      });
    }
    if (truncated) break;
  }
  return { members: out, truncated };
}

function collectTypeRefs(
  source: ts.SourceFile,
  members: ts.NodeArray<ts.ClassElement | ts.TypeElement>,
  from: string,
  refs: PendingRef[],
  ordinal: { next: number },
): void {
  for (const member of members) {
    // Constructor parameters carry the injected dependencies (the NestJS
    // `constructor(private readonly svc: SalesService)` pattern).
    if (ts.isConstructorDeclaration(member)) {
      const seen = new Set<string>();
      for (const param of member.parameters) {
        if (param.type === undefined) continue;
        for (const name of typeNamesOf(param.type)) {
          if (seen.has(name)) continue;
          seen.add(name);
          refs.push({
            from,
            kind: "references",
            toName: name,
            evidence: evidenceOf(source, param, "constructor injection"),
            ordinal: ordinal.next++,
          });
        }
      }
      continue;
    }
    if (
      ts.isPropertyDeclaration(member) ||
      ts.isPropertySignature(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isMethodSignature(member)
    ) {
      const targets = member.type !== undefined ? typeNamesOf(member.type) : [];
      if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) {
        for (const param of member.parameters) {
          if (param.type !== undefined) targets.push(...typeNamesOf(param.type));
        }
      }
      const seen = new Set<string>();
      for (const name of targets) {
        if (seen.has(name)) continue;
        seen.add(name);
        refs.push({
          from,
          kind: "references",
          toName: name,
          evidence: evidenceOf(source, member, "used type"),
          ordinal: ordinal.next++,
        });
      }
    }
  }
}

function heritageNames(
  source: ts.SourceFile,
  node: ts.ClassLikeDeclaration | ts.InterfaceDeclaration,
  from: string,
  refs: PendingRef[],
  ordinal: { next: number },
): void {
  for (const clause of node.heritageClauses ?? []) {
    const kind = clause.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
    for (const type of clause.types) {
      const name = type.expression.getText(source).split("<")[0].trim().split(".")[0];
      if (name !== "") {
        refs.push({
          from,
          kind,
          toName: name,
          evidence: evidenceOf(source, type, kind),
          ordinal: ordinal.next++,
        });
      }
    }
  }
}

function symbolId(rootId: string, rel: string, ordinal: number): string {
  return `ts:${rootId}:${rel}#${ordinal}`;
}

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  const get = ts.getDecorators as unknown as
    | ((target: ts.Node) => readonly ts.Decorator[] | undefined)
    | undefined;
  return (
    get?.(node) ?? (node as { decorators?: readonly ts.Decorator[] }).decorators ?? []
  );
}

/** Decorator names on a declaration (e.g. `@Controller("x")` → "Controller"). */
function decoratorNamesOf(node: ts.Node): string[] {
  const out: string[] = [];
  for (const decorator of decoratorsOf(node).slice(0, 8)) {
    const expr = decorator.expression;
    if (ts.isIdentifier(expr)) out.push(expr.text);
    else if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
      out.push(expr.expression.text);
    }
  }
  return [...new Set(out)];
}

/** Decorators that declare a framework module (NestJS / Angular). */
const MODULE_DECORATORS = new Set(["Module", "NgModule"]);

/**
 * `@Module`/`@NgModule` metadata references: plain identifiers in
 * metadata-array properties (`controllers`, `providers`, `imports`,
 * `exports`, `declarations`…), per role. Dynamic entries (calls
 * like `TypeOrmModule.forRoot()`, spreads, arrows) are counted as
 * opaque, never guessed.
 */
function moduleMetadataOf(
  source: ts.SourceFile,
  node: ts.Node,
): { refs: StructureModuleRef[]; opaque: number } {
  const refs: StructureModuleRef[] = [];
  let opaque = 0;
  for (const decorator of decoratorsOf(node)) {
    const expr = decorator.expression;
    const name = ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)
      ? expr.expression.text
      : null;
    if (name === null || !MODULE_DECORATORS.has(name)) continue;
    if (!ts.isCallExpression(expr) || expr.arguments.length === 0) continue;
    const first = expr.arguments[0];
    if (!ts.isObjectLiteralExpression(first)) continue;
    for (const prop of first.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isArrayLiteralExpression(prop.initializer)) continue;
      const role = ts.isIdentifier(prop.name)
        ? prop.name.text
        : shortText(prop.name.getText(source), 40);
      for (const element of prop.initializer.elements) {
        if (ts.isIdentifier(element)) refs.push({ role, name: element.text });
        else opaque += 1;
      }
    }
  }
  return { refs, opaque };
}

/**
 * `new X()` occurrences inside a symbol body, attributed to that symbol.
 * Top-level instantiations outside any symbol are NOT emitted here: the
 * file-level import edge already covers that coupling.
 */
function collectNews(
  source: ts.SourceFile,
  node: ts.Node,
  from: string,
  refs: PendingRef[],
  ordinal: { next: number },
): void {
  function visit(current: ts.Node): void {
    if (
      ts.isNewExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text !== ""
    ) {
      refs.push({
        from,
        kind: "instantiates",
        toName: current.expression.text,
        evidence: evidenceOf(source, current, `new ${current.expression.text}`),
        ordinal: ordinal.next++,
      });
    }
    ts.forEachChild(current, visit);
  }
  // The node itself is the declaration (never a `new`); walk its children.
  ts.forEachChild(node, visit);
}

/** Non-code extensions: resolved as external assets, never as missing code. */
const ASSET_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".html",
  ".json",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
]);

/**
 * Resolves a relative import specifier against the analyzed files of the
 * same root. Returns the resolved rel, or null when it points outside the
 * scope, escapes the root, or is not a relative specifier at all.
 */
export function resolveImportSpec(
  fromRel: string,
  spec: string,
  scopeRels: Set<string>,
): string | null {
  if (!spec.startsWith(".")) return null;
  const base = spec.split("?")[0].split("#")[0];
  const lower = base.toLowerCase();
  for (const ext of ASSET_EXTENSIONS) {
    if (lower.endsWith(ext)) return null;
  }
  const dir = fromRel.split("/").slice(0, -1);
  for (const seg of base.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (dir.length === 0) return null;
      dir.pop();
    } else {
      dir.push(seg);
    }
  }
  const joined = dir.join("/");
  const noJs = joined.replace(/\.jsx?$/i, (m) => (m.toLowerCase() === ".jsx" ? ".tsx" : ".ts"));
  const candidates = [
    noJs,
    `${noJs}.ts`,
    `${noJs}.tsx`,
    `${noJs}/index.ts`,
    `${noJs}/index.tsx`,
  ];
  // Exact matches first (covers explicit ".ts" specifiers too).
  if (scopeRels.has(joined)) return joined;
  for (const candidate of candidates) {
    if (scopeRels.has(candidate)) return candidate;
  }
  return null;
}

/** Local names an import binds; re-exports and namespaces bind none here. */
function importedNames(stmt: ts.Statement): string[] {
  if (!ts.isImportDeclaration(stmt) || stmt.importClause === undefined) return [];
  const clause = stmt.importClause;
  const names = clause.name === undefined ? [] : [clause.name.text];
  if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) names.push(element.name.text);
  }
  return names;
}

function parseFile(input: StructureInput, ordinal: { next: number }): FileSymbols {
  const isTsx = input.rel.toLowerCase().endsWith(".tsx");
  const source = ts.createSourceFile(input.rel, input.content, ts.ScriptTarget.Latest, true);
  const symbols: StructureSymbol[] = [];
  const refs: PendingRef[] = [];
  const endpoints: ApiEndpoint[] = [];
  const calls: ApiCall[] = [];
  // `parseDiagnostics` exists at runtime but not in the public types:
  // bounded, tolerant access.
  const diagnostics = (
    source as unknown as { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics;
  const problems = Array.isArray(diagnostics) ? diagnostics : [];
  const partial = problems.length > 0;
  const message = partial
    ? `Partial syntax: ${problems
        .slice(0, 3)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
        .join("; ")}`
    : null;

  function emitClass(node: ts.ClassDeclaration): void {
    const name = node.name?.getText(source) ?? "default";
    const id = symbolId(input.rootId, input.rel, ordinal.next++);
    const collected = collectMembers(source, node.members, STRUCTURE_LIMITS.maxMembers);
    const decorators = decoratorNamesOf(node);
    const moduleMeta = decorators.some((entry) => MODULE_DECORATORS.has(entry))
      ? moduleMetadataOf(source, node)
      : null;
    symbols.push({
      id,
      language: "ts",
      kind: "class",
      name: shortText(name, 60),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      members: collected.members,
      membersTruncated: collected.truncated,
      heuristic: node.name === undefined ? "anonymous class with a default export" : null,
      bodyHash: memberBodyHash(source, node),
      decorators,
      flow: collectFlowFacts(source, node, (target, what) => evidenceOf(source, target, what)),
      ...(moduleMeta !== null && moduleMeta.refs.length > 0
        ? { moduleRefs: moduleMeta.refs }
        : {}),
      ...(moduleMeta !== null && moduleMeta.opaque > 0
        ? { moduleOpaque: moduleMeta.opaque }
        : {}),
    });
    heritageNames(source, node, id, refs, ordinal);
    collectTypeRefs(source, node.members, id, refs, ordinal);
    collectNews(source, node, id, refs, ordinal);
  }

  function emitInterface(node: ts.InterfaceDeclaration): void {
    const id = symbolId(input.rootId, input.rel, ordinal.next++);
    const collected = collectMembers(source, node.members, STRUCTURE_LIMITS.maxMembers);
    symbols.push({
      id,
      language: "ts",
      kind: "interface",
      name: shortText(node.name.getText(source), 60),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      members: collected.members,
      membersTruncated: collected.truncated,
      heuristic: null,
      bodyHash: memberBodyHash(source, node),
    });
    heritageNames(source, node, id, refs, ordinal);
    collectTypeRefs(source, node.members, id, refs, ordinal);
  }

  function emitEnum(node: ts.EnumDeclaration): void {
    const id = symbolId(input.rootId, input.rel, ordinal.next++);
    const members: StructureMember[] = [];
    let truncated = false;
    for (const member of node.members) {
      if (members.length >= STRUCTURE_LIMITS.maxMembers) {
        truncated = true;
        break;
      }
      const name = member.name !== undefined ? member.name.getText(source) : "(anonymous)";
      const init = member.initializer !== undefined ? ` = ${shortText(member.initializer.getText(source), 40)}` : "";
      members.push({ name: shortText(name, 60), kind: "variant", detail: shortText(`${name}${init}`, 80) });
    }
    symbols.push({
      id,
      language: "ts",
      kind: "enum",
      name: shortText(node.name.getText(source), 60),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      members,
      membersTruncated: truncated,
      heuristic: null,
      bodyHash: memberBodyHash(source, node),
    });
  }

  function emitFunction(name: string, node: ts.Node, heuristic: string | null): void {
    const id = symbolId(input.rootId, input.rel, ordinal.next++);
    symbols.push({
      id,
      language: "ts",
      kind: heuristic === null ? "function" : "component",
      name: shortText(name, 60),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      members: [],
      membersTruncated: false,
      heuristic,
      bodyHash: memberBodyHash(source, node),
    });
    collectNews(source, node, id, refs, ordinal);
  }

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node)) {
      emitClass(node);
      return;
    }
    if (ts.isInterfaceDeclaration(node)) {
      emitInterface(node);
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      emitEnum(node);
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      const name = node.name.getText(source);
      // Explicit heuristic: an uppercase function in .tsx ≈ a component.
      const heuristic =
        isTsx && /^[A-Z]/.test(name) ? "uppercase function in .tsx (heuristic)" : null;
      emitFunction(name, node, heuristic);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer !== undefined &&
          (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
        ) {
          const name = decl.name.text;
          // Explicit heuristic: an uppercase const in .tsx ≈ a component.
          const heuristic =
            isTsx && /^[A-Z]/.test(name) ? "uppercase const in .tsx (heuristic)" : null;
          emitFunction(name, decl, heuristic);
        }
      }
      return;
    }
    if (ts.isModuleDeclaration(node) && node.body !== undefined && ts.isModuleBlock(node.body)) {
      for (const stmt of node.body.statements) visit(stmt);
      return;
    }
    ts.forEachChild(node, visit);
  }

  for (const stmt of source.statements) visit(stmt);

  // Static module dependencies (resolved against the scope afterwards).
  const rawImports: RawImport[] = [];
  for (const stmt of source.statements) {
    const spec =
      ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)
        ? stmt.moduleSpecifier
        : undefined;
    if (spec !== undefined && ts.isStringLiteral(spec) && spec.text.trim() !== "") {
      const pos = source.getLineAndCharacterOfPosition(stmt.getStart(source));
      rawImports.push({ raw: spec.text, line: pos.line + 1, names: importedNames(stmt) });
    }
  }

  function emitEndpoint(method: string, url: string, node: ts.Node, what: string): void {
    endpoints.push({
      id: apiId(input.rootId, input.rel, ordinal.next++),
      method,
      url: shortText(url, 300),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      evidence: evidenceOf(source, node, what),
      note: null,
    });
  }

  function emitCall(method: string, url: string, node: ts.Node, what: string): void {
    calls.push({
      id: apiId(input.rootId, input.rel, ordinal.next++),
      method,
      url: shortText(url, 300),
      rootId: input.rootId,
      rel: input.rel,
      range: toRange(source, node),
      evidence: evidenceOf(source, node, what),
      note: null,
    });
  }

  // HttpClient fields of the enclosing class (null outside classes):
  // their calls are consumed APIs, never exposed endpoints.
  let httpFields: Set<string> | null = null;

  // Full walk (includes method bodies): routes and calls.
  function visitCalls(node: ts.Node): void {
    if (ts.isClassDeclaration(node)) {
      const outer = httpFields;
      httpFields = httpClientFieldsOf(node);
      ts.forEachChild(node, visitCalls);
      httpFields = outer;
      return;
    }
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (ts.isPropertyAccessExpression(target)) {
        const verb = target.name.text.toLowerCase();
        const receiver = target.expression;
        const httpReceiver =
          httpFields !== null &&
          ts.isPropertyAccessExpression(receiver) &&
          receiver.expression.kind === ts.SyntaxKind.ThisKeyword &&
          (ts.isIdentifier(receiver.name) || ts.isPrivateIdentifier(receiver.name)) &&
          httpFields.has(ts.idText(receiver.name));
        if (ROUTE_VERBS.has(verb) && !isNamed(receiver, "axios") && !httpReceiver) {
          const url = staticUrl(node.arguments[0]);
          if (url !== null && url.startsWith("/")) {
            emitEndpoint(verb.toUpperCase(), url, node, `route ${verb}`);
          }
        } else if (
          isNamed(receiver, "axios") &&
          HTTP_VERBS.has(verb) &&
          node.arguments[0] !== undefined
        ) {
          const url = staticUrl(node.arguments[0]);
          if (url !== null) emitCall(verb.toUpperCase(), url, node, `axios.${verb}`);
        }
      } else if (isNamed(target, "fetch") && node.arguments[0] !== undefined) {
        const url = staticUrl(node.arguments[0]);
        if (url !== null) {
          emitCall(methodOfOptions(node.arguments[1]) ?? "GET", url, node, "fetch");
        }
      } else if (isNamed(target, "axios") && node.arguments[0] !== undefined) {
        // `axios({url, method?})` with a literal object.
        const options = node.arguments[0];
        if (ts.isObjectLiteralExpression(options)) {
          let url: string | null = null;
          let method: string | null = null;
          for (const prop of options.properties) {
            if (!ts.isPropertyAssignment(prop) || prop.name === undefined) continue;
            const key = ts.isIdentifier(prop.name) ? prop.name.text : null;
            if (key === "url") url = staticUrl(prop.initializer);
            else if (key === "method" && ts.isStringLiteral(prop.initializer)) {
              method = prop.initializer.text.trim().toUpperCase();
            }
          }
          if (url !== null) emitCall(method ?? "GET", url, node, "axios({...})");
        }
      }
    }
    ts.forEachChild(node, visitCalls);
  }

  for (const stmt of source.statements) visitCalls(stmt);
  const pipeline = [
    ...collectNestPipeline(source, (target, what) => evidenceOf(source, target, what)),
    ...collectHttpInterceptors(source, (target, what) => evidenceOf(source, target, what)),
  ];
  return { symbols, refs, endpoints, calls, rawImports, partial, message, pipeline };
}

/**
 * Analyzes already-read TypeScript files. Deterministic: IDs come from
 * the input order and the AST order; two equal passes yield the same
 * result. Resolution requires global name uniqueness.
 */
export function analyzeTsFiles(inputs: StructureInput[]): StructureResult {
  const files = inputs.slice(0, STRUCTURE_LIMITS.maxFiles);
  const ordinal = { next: 0 };
  const allSymbols: StructureSymbol[] = [];
  const allRefs: PendingRef[] = [];
  const allEndpoints: ApiEndpoint[] = [];
  const allCalls: ApiCall[] = [];
  const allPipelines: PipelineFact[] = [];
  // Import resolution scope: rels per root (imports never cross roots).
  const scopeByRoot = new Map<string, Set<string>>();
  for (const input of files) {
    const rels = scopeByRoot.get(input.rootId) ?? new Set<string>();
    rels.add(input.rel);
    scopeByRoot.set(input.rootId, rels);
  }
  const fileRows = files.map((input) => {
    let parsed: FileSymbols;
    try {
      parsed = parseFile(input, ordinal);
    } catch (raw) {
      return {
        rootId: input.rootId,
        rel: input.rel,
        hash: input.hash,
        bytes: input.content.length,
        language: "ts" as const,
        status: "error" as const,
        message: raw instanceof Error ? raw.message : "Could not analyze.",
      };
    }
    allSymbols.push(...parsed.symbols);
    allRefs.push(...parsed.refs);
    allEndpoints.push(...parsed.endpoints);
    allCalls.push(...parsed.calls);
    allPipelines.push(...parsed.pipeline);
    const scopeRels = scopeByRoot.get(input.rootId) ?? new Set<string>();
    const imports = parsed.rawImports.map((found) => {
      const resolvedRel = resolveImportSpec(input.rel, found.raw, scopeRels);
      return {
        raw: found.raw,
        resolvedRel,
        status: (resolvedRel !== null
          ? "resolved"
          : found.raw.startsWith(".")
            ? "missing"
            : "external") as "resolved" | "external" | "missing",
        line: found.line,
        ...(found.names.length > 0 ? { names: found.names } : {}),
      };
    });
    return {
      rootId: input.rootId,
      rel: input.rel,
      hash: input.hash,
      bytes: input.content.length,
      language: "ts" as const,
      status: parsed.partial ? ("partial" as const) : ("ok" as const),
      message: parsed.message,
      imports,
    };
  });

  const symbols = allSymbols.slice(0, STRUCTURE_LIMITS.maxSymbols);
  const symbolsTruncated = allSymbols.length > symbols.length;
  const kept = new Set(symbols.map((symbol) => symbol.id));
  const byName = new Map<string, StructureSymbol[]>();
  for (const symbol of symbols) {
    const list = byName.get(symbol.name) ?? [];
    list.push(symbol);
    byName.set(symbol.name, list);
  }

  const relations: StructureRelation[] = [];
  for (const ref of allRefs) {
    if (!kept.has(ref.from)) continue;
    if (relations.length >= STRUCTURE_LIMITS.maxRelations) break;
    const candidates = byName.get(ref.toName) ?? [];
    const status =
      candidates.length === 1 ? "resolved" : candidates.length === 0 ? "unresolved" : "ambiguous";
    relations.push({
      id: `tsrel:${ref.from}:${ref.kind}:${ref.toName}#${ref.ordinal}`,
      kind: ref.kind,
      from: ref.from,
      to: status === "resolved" ? candidates[0].id : null,
      toName: ref.toName,
      status,
      evidence: ref.evidence,
    });
  }
  const relationsTruncated =
    relations.length >= STRUCTURE_LIMITS.maxRelations &&
    allRefs.filter((ref) => kept.has(ref.from)).length > relations.length;

  const endpoints = allEndpoints.slice(0, STRUCTURE_LIMITS.maxEndpoints);
  const calls = allCalls.slice(0, STRUCTURE_LIMITS.maxCalls);

  return {
    files: fileRows,
    symbols,
    relations,
    endpoints,
    calls,
    symbolsTruncated,
    relationsTruncated,
    endpointsTruncated: allEndpoints.length > endpoints.length,
    callsTruncated: allCalls.length > calls.length,
    limits: STRUCTURE_LIMITS,
    ...(allPipelines.length > 0 ? { pipeline: allPipelines } : {}),
  };
}
