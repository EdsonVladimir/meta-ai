// NestJS facts: routes from `@Controller` + verb decorators, and
// global pipeline (guards, interceptors). Pure: no IO, no
// cross-file resolution. Non-literal paths stay `${...}`.
import ts from "ts-compiler";
import type {
  PipelineFact,
  PipelineScope,
  StructureRouteFact,
} from "./structureTypes";

const VERB_DECORATORS = new Map([
  ["Get", "GET"],
  ["Post", "POST"],
  ["Put", "PUT"],
  ["Patch", "PATCH"],
  ["Delete", "DELETE"],
  ["Options", "OPTIONS"],
  ["Head", "HEAD"],
  ["All", "ALL"],
]);

function decoratorsOf(node: ts.Node): readonly ts.Decorator[] {
  const get = ts.getDecorators as unknown as
    | ((target: ts.Node) => readonly ts.Decorator[] | undefined)
    | undefined;
  return (
    get?.(node) ?? (node as { decorators?: readonly ts.Decorator[] }).decorators ?? []
  );
}

/** Decorator name (`@Public`, `@Post('x')` → `Public`, `Post`); null when exotic. */
function decoratorName(decorator: ts.Decorator): string | null {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return null;
}

function decoratorArgs(decorator: ts.Decorator): readonly ts.Expression[] {
  const expr = decorator.expression;
  return ts.isCallExpression(expr) ? expr.arguments : [];
}

/** A name from an identifier or `new X()` argument; null when unprovable. */
function classNameOf(argument: ts.Expression): string | null {
  if (ts.isIdentifier(argument)) return argument.text;
  if (ts.isNewExpression(argument) && ts.isIdentifier(argument.expression)) {
    return argument.expression.text;
  }
  return null;
}

/** String literal text; `${...}` for anything else (never guessed). */
function pathPart(argument: ts.Expression | undefined): string {
  if (argument !== undefined && ts.isStringLiteralLike(argument)) return argument.text;
  return "${...}";
}

function joinPath(base: string, leaf: string): string {
  const parts = [base, leaf]
    .map((part) => part.replace(/^\/+|\/+$/g, ""))
    .filter((part) => part !== "");
  return `/${parts.join("/")}`;
}

/** Class and method guards/interceptors merge, class first. */
function pipelineNames(
  decorators: readonly ts.Decorator[],
  kind: "UseGuards" | "UseInterceptors",
): string[] {
  const out: string[] = [];
  for (const decorator of decorators) {
    if (decoratorName(decorator) !== kind) continue;
    for (const argument of decoratorArgs(decorator)) {
      const name = classNameOf(argument);
      if (name !== null) out.push(name);
    }
  }
  return out;
}

export function collectNestRoutes(
  source: ts.SourceFile,
  node: ts.ClassDeclaration,
  evidence: (node: ts.Node, what: string) => string,
): StructureRouteFact[] {
  const classDecorators = decoratorsOf(node);
  const controller = classDecorators.find((entry) => decoratorName(entry) === "Controller");
  const controllerArgs = controller === undefined ? [] : decoratorArgs(controller);
  const base = controllerArgs.length === 0 ? "" : pathPart(controllerArgs[0]);
  const classGuards = pipelineNames(classDecorators, "UseGuards");
  const classInterceptors = pipelineNames(classDecorators, "UseInterceptors");

  const routes: StructureRouteFact[] = [];
  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const methodDecorators = decoratorsOf(member);
    let verb: string | null = null;
    let verbArgs: readonly ts.Expression[] = [];
    const names: string[] = [];
    for (const decorator of methodDecorators) {
      const name = decoratorName(decorator);
      if (name === null) continue;
      names.push(name);
      if (verb === null) {
        const mapped = VERB_DECORATORS.get(name);
        if (mapped !== undefined) {
          verb = mapped;
          verbArgs = decoratorArgs(decorator);
        }
      }
    }
    if (verb === null) continue;
    const path = joinPath(base, verbArgs.length === 0 ? "" : pathPart(verbArgs[0]));
    const bodyParam = member.parameters.find((param) =>
      decoratorsOf(param).some((entry) => decoratorName(entry) === "Body"),
    );
    const bodyTypeNode = bodyParam?.type;
    routes.push({
      member: member.name.getText(source),
      verb,
      path,
      bodyType: bodyTypeNode === undefined ? null : bodyTypeNode.getText(source),
      decorators: names.filter(
        (name) =>
          !VERB_DECORATORS.has(name) &&
          name !== "UseGuards" &&
          name !== "UseInterceptors" &&
          !name.startsWith("Api"),
      ),
      guards: [...classGuards, ...pipelineNames(methodDecorators, "UseGuards")],
      interceptors: [
        ...classInterceptors,
        ...pipelineNames(methodDecorators, "UseInterceptors"),
      ],
      evidence: evidence(member, `route ${verb} ${path}`),
    });
  }
  return routes;
}

interface PipelineHit {
  scope: PipelineScope;
  name: string;
  node: ts.Node;
}

function moduleProviderHits(node: ts.ClassDeclaration): PipelineHit[] {
  const out: PipelineHit[] = [];
  for (const decorator of decoratorsOf(node)) {
    if (decoratorName(decorator) !== "Module") continue;
    const first = decoratorArgs(decorator)[0];
    if (first === undefined || !ts.isObjectLiteralExpression(first)) continue;
    for (const prop of first.properties) {
      if (
        !ts.isPropertyAssignment(prop) ||
        !ts.isIdentifier(prop.name) ||
        prop.name.text !== "providers" ||
        !ts.isArrayLiteralExpression(prop.initializer)
      ) {
        continue;
      }
      for (const element of prop.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) continue;
        let provide: string | null = null;
        let useClass: string | null = null;
        for (const entry of element.properties) {
          if (!ts.isPropertyAssignment(entry) || !ts.isIdentifier(entry.name)) continue;
          if (entry.name.text === "provide" && ts.isIdentifier(entry.initializer)) {
            provide = entry.initializer.text;
          } else if (entry.name.text === "useClass" && ts.isIdentifier(entry.initializer)) {
            useClass = entry.initializer.text;
          }
        }
        if (useClass === null) continue;
        if (provide === "APP_GUARD") {
          out.push({ scope: "global-guard", name: useClass, node: element });
        } else if (provide === "APP_INTERCEPTOR") {
          out.push({ scope: "global-interceptor", name: useClass, node: element });
        }
      }
    }
  }
  return out;
}

export function collectNestPipeline(
  source: ts.SourceFile,
  evidence: (node: ts.Node, what: string) => string,
): PipelineFact[] {
  const hits: PipelineHit[] = [];
  const visit = (current: ts.Node): void => {
    if (ts.isClassDeclaration(current)) {
      hits.push(...moduleProviderHits(current));
    }
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.name) &&
      (current.expression.name.text === "useGlobalGuards" ||
        current.expression.name.text === "useGlobalInterceptors")
    ) {
      const scope: PipelineScope =
        current.expression.name.text === "useGlobalGuards"
          ? "global-guard"
          : "global-interceptor";
      for (const argument of current.arguments) {
        const name = classNameOf(argument);
        if (name !== null) hits.push({ scope, name, node: current });
      }
    }
    ts.forEachChild(current, visit);
  };
  for (const stmt of source.statements) visit(stmt);

  // Grouped by scope in first-appearance order, names in order.
  const facts: PipelineFact[] = [];
  const byScope = new Map<PipelineScope, PipelineFact>();
  for (const hit of hits) {
    const found = byScope.get(hit.scope);
    if (found === undefined) {
      const fact: PipelineFact = {
        scope: hit.scope,
        names: [hit.name],
        evidence: evidence(hit.node, hit.scope),
      };
      byScope.set(hit.scope, fact);
      facts.push(fact);
    } else {
      found.names.push(hit.name);
    }
  }
  return facts;
}
