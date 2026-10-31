// Angular facts: `@Component`/`@Directive`/`@Pipe` metadata, and HTTP
// client interceptors registered with
// `provideHttpClient(withInterceptors([...]))`. Pure: no IO, no
// cross-file resolution. Only literals and plain identifiers are
// collected; anything else is skipped, never guessed.
import ts from "ts-compiler";
import { scanTemplate } from "./ngTemplate";
import type { ComponentFacts, PipelineFact } from "./structureTypes";
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
