// Angular facts: `@Component`/`@Directive`/`@Pipe` metadata, and HTTP
// client interceptors registered with
// `provideHttpClient(withInterceptors([...]))`. Pure: no IO, no
// cross-file resolution. Only literals and plain identifiers are
// collected; anything else is skipped, never guessed.
import ts from "ts-compiler";
import { scanTemplate } from "./ngTemplate";
import type { ComponentFacts, PipelineFact, RouteRecordFact } from "./structureTypes";
import { decoratorsOf } from "./tsFlowFacts";

const COMPONENT_KINDS: Record<string, ComponentFacts["kind"]> = {
  Component: "component",
  Directive: "directive",
  Pipe: "pipe",
};

/** Root-relative path of an asset named from `fromRel`. */
export function resolveAssetRel(fromRel: string, target: string): string {
  const parts = fromRel.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function literalText(node: ts.Expression | undefined): string | null {
  if (node === undefined) return null;
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

export function collectComponentFacts(
  source: ts.SourceFile,
  node: ts.ClassDeclaration,
  rel: string,
): ComponentFacts | null {
  for (const decorator of decoratorsOf(node)) {
    const call = decorator.expression;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) continue;
    const kind = COMPONENT_KINDS[call.expression.text];
    const meta = call.arguments[0];
    if (kind === undefined || meta === undefined || !ts.isObjectLiteralExpression(meta)) continue;
    const props = new Map<string, ts.Expression>();
    for (const prop of meta.properties) {
      if (ts.isPropertyAssignment(prop)) props.set(prop.name.getText(source), prop.initializer);
    }
    const selector = literalText(props.get(kind === "pipe" ? "name" : "selector"));
    const standalone = props.get("standalone");
    const imports = props.get("imports");
    const templateUrl = literalText(props.get("templateUrl"));
    const styleUrls = props.get("styleUrls");
    const styles = [
      literalText(props.get("styleUrl")),
      ...(styleUrls !== undefined && ts.isArrayLiteralExpression(styleUrls)
        ? styleUrls.elements.map(literalText)
        : []),
    ].filter((entry): entry is string => entry !== null);
    const facts: ComponentFacts = {
      kind,
      selector,
      standalone:
        standalone?.kind === ts.SyntaxKind.TrueKeyword
          ? true
          : standalone?.kind === ts.SyntaxKind.FalseKeyword
            ? false
            : null,
      imports:
        imports !== undefined && ts.isArrayLiteralExpression(imports)
          ? imports.elements.filter(ts.isIdentifier).map((entry) => entry.text)
          : [],
      templateRel: templateUrl === null ? null : resolveAssetRel(rel, templateUrl),
      styleRels: styles.map((entry) => resolveAssetRel(rel, entry)),
    };
    const inlineStyles = props.get("styles");
    const styleTexts = (
      inlineStyles !== undefined && ts.isArrayLiteralExpression(inlineStyles)
        ? inlineStyles.elements.map(literalText)
        : [literalText(inlineStyles)]
    ).filter((entry): entry is string => entry !== null);
    if (styleTexts.length > 0) facts.styleTexts = styleTexts;
    const inline = props.get("template");
    const text = literalText(inline);
    if (inline !== undefined && text !== null) {
      const start = source.getLineAndCharacterOfPosition(inline.getStart(source)).line + 1;
      facts.template = scanTemplate(rel, text, start);
      facts.templateLine = start;
      facts.templateText = text;
    }
    return facts;
  }
  return null;
}

export function collectHttpInterceptors(
  source: ts.SourceFile,
  evidence: (node: ts.Node, what: string) => string,
): PipelineFact[] {
  const names: string[] = [];
  let first: ts.Node | null = null;
  const visit = (current: ts.Node): void => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "withInterceptors"
    ) {
      const arg = current.arguments[0];
      if (arg !== undefined && ts.isArrayLiteralExpression(arg)) {
        for (const element of arg.elements) {
          if (!ts.isIdentifier(element)) continue;
          if (first === null) first = current;
          names.push(element.text);
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  for (const stmt of source.statements) visit(stmt);
  if (names.length === 0 || first === null) return [];
  return [{ scope: "http-client", names, evidence: evidence(first, "http-client") }];
}

/** Literal target and exported name of `() => import("./x").then((m) => m.Y)`. */
function lazyTarget(node: ts.Expression): { target: string; exported: string | null } | null {
  let target: string | null = null;
  let exported: string | null = null;
  const visit = (current: ts.Node): void => {
    if (ts.isCallExpression(current)) {
      if (current.expression.kind === ts.SyntaxKind.ImportKeyword) {
        target = literalText(current.arguments[0]);
      } else if (
        ts.isPropertyAccessExpression(current.expression) &&
        current.expression.name.text === "then"
      ) {
        const callback = current.arguments[0];
        if (
          callback !== undefined &&
          ts.isArrowFunction(callback) &&
          ts.isPropertyAccessExpression(callback.body)
        ) {
          exported = callback.body.name.text;
        }
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return target === null ? null : { target, exported };
}

function joinPaths(parent: string | null, path: string | null): string | null {
  if (parent === null || path === null) return null;
  const joined = [parent, path].filter((part) => part !== "").join("/");
  return joined;
}

/**
 * Route tables: arrays typed `Routes`, or given to `provideRouter`,
 * `RouterModule.forRoot` or `forChild`. Only literal paths and plain
 * identifiers count; anything else stays out, never guessed.
 */
export function collectRouteRecords(
  source: ts.SourceFile,
  rel: string,
  evidence: (node: ts.Node, what: string) => string,
): RouteRecordFact[] {
  const named = new Map<string, ts.ArrayLiteralExpression>();
  const tables = new Set<ts.ArrayLiteralExpression>();
  const arrayOf = (node: ts.Expression | undefined): ts.ArrayLiteralExpression | null => {
    if (node === undefined) return null;
    if (ts.isArrayLiteralExpression(node)) return node;
    return ts.isIdentifier(node) ? (named.get(node.text) ?? null) : null;
  };
  const scan = (current: ts.Node): void => {
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer !== undefined &&
      ts.isArrayLiteralExpression(current.initializer)
    ) {
      named.set(current.name.text, current.initializer);
      const type = current.type?.getText(source);
      if (type === "Routes" || type === "Route[]") tables.add(current.initializer);
    }
    ts.forEachChild(current, scan);
  };
  const scanCalls = (current: ts.Node): void => {
    if (ts.isCallExpression(current)) {
      const name = ts.isIdentifier(current.expression)
        ? current.expression.text
        : ts.isPropertyAccessExpression(current.expression)
          ? current.expression.name.text
          : "";
      if (name === "provideRouter" || name === "forRoot" || name === "forChild") {
        const table = arrayOf(current.arguments[0]);
        if (table !== null) tables.add(table);
      }
    }
    ts.forEachChild(current, scanCalls);
  };
  scan(source);
  scanCalls(source);

  const out: RouteRecordFact[] = [];
  const read = (table: ts.ArrayLiteralExpression, parent: string | null): void => {
    for (const element of table.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const props = new Map<string, ts.Expression>();
      for (const prop of element.properties) {
        if (ts.isPropertyAssignment(prop)) props.set(prop.name.getText(source), prop.initializer);
      }
      const path = joinPaths(parent, literalText(props.get("path")));
      const component = props.get("component");
      const page = props.get("loadComponent");
      const nested = props.get("loadChildren");
      const lazy = lazyTarget(page ?? nested ?? ts.factory.createNull());
      const guards = props.get("canActivate");
      if (component !== undefined || lazy !== null) {
        out.push({
          rel,
          path,
          component:
            component !== undefined && ts.isIdentifier(component)
              ? component.text
              : (lazy?.exported ?? null),
          lazyImport: lazy?.target ?? null,
          loadsChildren: nested !== undefined,
          canActivate:
            guards !== undefined && ts.isArrayLiteralExpression(guards)
              ? guards.elements.filter(ts.isIdentifier).map((entry) => entry.text)
              : [],
          evidence: evidence(element, `route ${path ?? "?"}`),
        });
      }
      const children = props.get("children");
      if (children !== undefined && ts.isArrayLiteralExpression(children)) read(children, path);
    }
  };
  for (const table of tables) read(table, "");
  return out;
}

/** `bootstrapApplication(App)` and `bootstrap: [App]`. */
export function collectBootstrap(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (current: ts.Node): void => {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      current.expression.text === "bootstrapApplication"
    ) {
      const first = current.arguments[0];
      if (first !== undefined && ts.isIdentifier(first)) out.push(first.text);
    }
    if (
      ts.isPropertyAssignment(current) &&
      current.name.getText(source) === "bootstrap" &&
      ts.isArrayLiteralExpression(current.initializer)
    ) {
      out.push(...current.initializer.elements.filter(ts.isIdentifier).map((entry) => entry.text));
    }
    ts.forEachChild(current, visit);
  };
  visit(source);
  return out;
}
