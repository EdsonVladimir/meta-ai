// Flow facts of one class: injections, member calls and signal
// accesses. Pure: no IO, no cross-file resolution. `httpCalls`,
// `repositoryCalls` and `routes` stay empty until later tasks.
import ts from "ts-compiler";
import type {
  HttpUrlFact,
  StructureHttpCall,
  StructureInjection,
  StructureMemberCall,
  StructureSignalAccess,
  SymbolFlowFacts,
} from "./structureTypes";

const SIGNAL_WRITERS = new Set(["set", "update", "mutate"]);
/** `HttpClient` methods whose name is the HTTP verb. */
const HTTP_CLIENT_VERBS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
/** Field initializers whose callback runs as part of that field. */
const REACTIVE_WRAPPERS = new Set(["computed", "effect"]);

/** The `this` keyword node (`this.foo`, `this[k]`). */
function isThis(node: ts.Node): boolean {
  return node.kind === ts.SyntaxKind.ThisKeyword;
}

function modifiersOf(node: ts.Node): readonly ts.Modifier[] {
  const get = ts.getModifiers as unknown as
    | ((target: ts.Node) => readonly ts.Modifier[] | undefined)
    | undefined;
  return (
    get?.(node) ?? (node as { modifiers?: readonly ts.Modifier[] }).modifiers ?? []
  );
}

function isInjectionParam(param: ts.ParameterDeclaration): boolean {
  return modifiersOf(param).some(
    (mod) =>
      mod.kind === ts.SyntaxKind.PublicKeyword ||
      mod.kind === ts.SyntaxKind.PrivateKeyword ||
      mod.kind === ts.SyntaxKind.ProtectedKeyword ||
      mod.kind === ts.SyntaxKind.ReadonlyKeyword,
  );
}

function signalFieldsOf(source: ts.SourceFile, node: ts.ClassDeclaration): Set<string> {
  const out = new Set<string>();
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const init = member.initializer;
    if (init === undefined || !ts.isCallExpression(init)) continue;
    if (!ts.isIdentifier(init.expression)) continue;
    if (init.expression.text !== "signal" && init.expression.text !== "computed") continue;
    out.add(member.name.getText(source));
  }
  return out;
}

function collectInjections(
  source: ts.SourceFile,
  node: ts.ClassDeclaration,
  evidence: (node: ts.Node, what: string) => string,
): StructureInjection[] {
  const out: StructureInjection[] = [];
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const init = member.initializer;
    if (init === undefined || !ts.isCallExpression(init)) continue;
    if (!ts.isIdentifier(init.expression) || init.expression.text !== "inject") continue;
    const first = init.arguments[0];
    if (first === undefined || !ts.isIdentifier(first)) continue;
    out.push({
      field: member.name.getText(source),
      typeName: first.text,
      via: "inject",
      evidence: evidence(member, `inject(${first.text})`),
    });
  }
  for (const member of node.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    for (const param of member.parameters) {
      if (!ts.isIdentifier(param.name)) continue;
      if (param.type === undefined) continue;
      if (!isInjectionParam(param)) continue;
      out.push({
        field: param.name.text,
        typeName: param.type.getText(source),
        via: "constructor",
        evidence: evidence(param, "constructor injection"),
      });
    }
  }
  return out;
}

function isFunctionLike(node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/** The function a field holds: its initializer, or a computed/effect callback. */
function fieldFunction(member: ts.PropertyDeclaration): ts.ArrowFunction | ts.FunctionExpression | null {
  const init = member.initializer;
  if (isFunctionLike(init)) return init;
  if (
    init !== undefined &&
    ts.isCallExpression(init) &&
    ts.isIdentifier(init.expression) &&
    REACTIVE_WRAPPERS.has(init.expression.text) &&
    isFunctionLike(init.arguments[0])
  ) {
    return init.arguments[0];
  }
  return null;
}

/** The executable body of a class element with its member name; null when it has none. */
function walkableBody(
  source: ts.SourceFile,
  member: ts.ClassElement,
): { name: string; body: ts.Node } | null {
  if (ts.isConstructorDeclaration(member)) {
    return member.body === undefined ? null : { name: "constructor", body: member.body };
  }
  if (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member)
  ) {
    if (member.body === undefined) return null;
    const name = member.name === undefined ? "(anonymous)" : member.name.getText(source);
    return { name, body: member.body };
  }
  if (ts.isPropertyDeclaration(member)) {
    const fn = fieldFunction(member);
    return fn === null ? null : { name: member.name.getText(source), body: fn.body };
  }
  return null;
}

/** Same cut as `shortText(..., 40)` in tsAnalyze (kept local: no import cycle). */
function cutType(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 40 ? `${flat.slice(0, 39)}…` : flat;
}

function isHttpClientType(type: ts.TypeNode | undefined): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "HttpClient"
  );
}

function isInjectHttpClient(init: ts.Expression | undefined): boolean {
  if (init === undefined || !ts.isCallExpression(init)) return false;
  if (!ts.isIdentifier(init.expression) || init.expression.text !== "inject") return false;
  const first = init.arguments[0];
  if (first !== undefined && ts.isIdentifier(first) && first.text === "HttpClient") return true;
  const typeArg = init.typeArguments?.[0];
  return isHttpClientType(typeArg);
}

/**
 * Fields proven to be Angular `HttpClient`: annotated as such, or
 * injected with it (`inject(HttpClient)`, `inject<HttpClient>()`).
 * Constructor parameters count when they declare a field.
 */
export function httpClientFieldsOf(node: ts.ClassDeclaration): Set<string> {
  const out = new Set<string>();
  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      const name = member.name;
      if (!ts.isIdentifier(name) && !ts.isPrivateIdentifier(name)) continue;
      if (isHttpClientType(member.type) || isInjectHttpClient(member.initializer)) {
        out.add(ts.idText(name));
      }
    } else if (ts.isConstructorDeclaration(member)) {
      for (const param of member.parameters) {
        if (!ts.isIdentifier(param.name)) continue;
        if (!isInjectionParam(param)) continue;
        if (!isHttpClientType(param.type)) continue;
        out.add(param.name.text);
      }
    }
  }
  return out;
}

/**
 * URL reconstruction over a strict whitelist: string and template
 * literals, `+` concatenation, `this.<field>` with a resolving
 * initializer, and `environment.<x>` as the base token. Anything
 * else (calls, ternaries, parameters…) gives null.
 */
function resolveHttpUrl(
  source: ts.SourceFile,
  expr: ts.Expression | undefined,
  fields: Map<string, ts.Expression>,
  visiting: Set<string>,
): HttpUrlFact | null {
  if (expr === undefined) return null;
  if (ts.isStringLiteralLike(expr)) return { base: null, path: expr.text };
  if (ts.isTemplateExpression(expr)) {
    let base: string | null = null;
    let path = expr.head.text;
    for (const span of expr.templateSpans) {
      const part = resolveHttpUrl(source, span.expression, fields, visiting);
      if (part === null) {
        path += "${...}";
      } else {
        base = base ?? part.base;
        path += part.path;
      }
      path += span.literal.text;
    }
    return { base, path };
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveHttpUrl(source, expr.left, fields, visiting);
    const right = resolveHttpUrl(source, expr.right, fields, visiting);
    if (left === null || right === null) return null;
    return { base: left.base ?? right.base, path: left.path + right.path };
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "environment" &&
    ts.isIdentifier(expr.name)
  ) {
    return { base: expr.name.text, path: "" };
  }
  if (
    ts.isPropertyAccessExpression(expr) &&
    isThis(expr.expression) &&
    (ts.isIdentifier(expr.name) || ts.isPrivateIdentifier(expr.name))
  ) {
    const field = ts.idText(expr.name);
    const init = fields.get(field);
    if (init === undefined || visiting.has(field)) return null;
    visiting.add(field);
    const resolved = resolveHttpUrl(source, init, fields, visiting);
    visiting.delete(field);
    return resolved;
  }
  return null;
}

/** A literal element key (`this.s["go"]`); null when dynamic. */
function literalKey(argument: ts.Expression | undefined): string | null {
  if (argument === undefined) return null;
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isNumericLiteral(argument)) return argument.text;
  return null;
}

export function collectFlowFacts(
  source: ts.SourceFile,
  node: ts.ClassDeclaration,
  evidence: (node: ts.Node, what: string) => string,
): SymbolFlowFacts {
  const injections = collectInjections(source, node, evidence);
  const signals = signalFieldsOf(source, node);
  const httpFields = httpClientFieldsOf(node);
  const fieldInits = new Map<string, ts.Expression>();
  for (const member of node.members) {
    if (!ts.isPropertyDeclaration(member) || member.initializer === undefined) continue;
    if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) continue;
    fieldInits.set(ts.idText(member.name), member.initializer);
  }
  const calls: StructureMemberCall[] = [];
  const accesses: StructureSignalAccess[] = [];
  const httpCalls: StructureHttpCall[] = [];
  const unresolved: string[] = [];

  // True when the call took a member-call order slot (signals and
  // HTTP calls live in their own streams).
  const recordCall = (call: ts.CallExpression, member: string, order: number): boolean => {
    const callee = call.expression;
    // `this.http.<verb>(...)`: an HTTP call, never a member call.
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      isThis(callee.expression.expression) &&
      (ts.isIdentifier(callee.expression.name) ||
        ts.isPrivateIdentifier(callee.expression.name)) &&
      httpFields.has(ts.idText(callee.expression.name)) &&
      (ts.isIdentifier(callee.name) || ts.isPrivateIdentifier(callee.name))
    ) {
      const method = ts.idText(callee.name);
      if (!HTTP_CLIENT_VERBS.has(method)) {
        unresolved.push(evidence(call, `http ${method}`));
        return false;
      }
      const verb = method.toUpperCase();
      const typeArg = call.typeArguments?.[0];
      httpCalls.push({
        member,
        verb,
        url: resolveHttpUrl(source, call.arguments[0], fieldInits, new Set()),
        returnType: typeArg === undefined ? null : cutType(typeArg.getText(source)),
        evidence: evidence(call, `http ${verb}`),
      });
      return false;
    }
    // `this.field()` / `this.method()`: a signal read, or a call.
    if (ts.isPropertyAccessExpression(callee) && isThis(callee.expression)) {
      const name = callee.name.getText(source);
      if (signals.has(name)) {
        accesses.push({ member, signal: name, access: "read", evidence: evidence(call, `signal read ${name}`) });
        return false;
      }
      calls.push({ member, receiver: null, method: name, order, evidence: evidence(call, `call this.${name}`) });
      return true;
    }
    // `this.field.method()`: a signal write, or a call.
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      isThis(callee.expression.expression)
    ) {
      const field = callee.expression.name.getText(source);
      const method = callee.name.getText(source);
      if (signals.has(field)) {
        if (!SIGNAL_WRITERS.has(method)) return false;
        accesses.push({ member, signal: field, access: "write", evidence: evidence(call, `signal write ${field}`) });
        return false;
      }
      calls.push({ member, receiver: field, method, order, evidence: evidence(call, `call this.${field}.${method}`) });
      return true;
    }
    // `this.field["literal"]()` / `this["literal"]()`: provable keys resolve.
    if (ts.isElementAccessExpression(callee)) {
      const key = literalKey(callee.argumentExpression);
      if (key === null) {
        unresolved.push(evidence(call, "unresolved call"));
        return false;
      }
      if (isThis(callee.expression)) {
        calls.push({ member, receiver: null, method: key, order, evidence: evidence(call, `call this.${key}`) });
        return true;
      }
      if (
        ts.isPropertyAccessExpression(callee.expression) &&
        isThis(callee.expression.expression)
      ) {
        const field = callee.expression.name.getText(source);
        if (signals.has(field)) return false;
        calls.push({ member, receiver: field, method: key, order, evidence: evidence(call, `call this.${field}.${key}`) });
        return true;
      }
      return false;
    }
    // Locals, library and chained calls are not chain links, nor unknowns.
    return false;
  };

  // Every body walks once, past the member cap: facts must not break.
  for (const member of node.members) {
    const target = walkableBody(source, member);
    if (target === null) continue;
    let order = 0;
    const visit = (current: ts.Node): void => {
      if (ts.isCallExpression(current) && recordCall(current, target.name, order)) {
        order += 1;
      }
      ts.forEachChild(current, visit);
    };
    visit(target.body);
  }

  return {
    injections,
    calls,
    signals: accesses,
    httpCalls,
    repositoryCalls: [],
    routes: [],
    unresolved,
  };
}
