// Flow facts of one class: injections, member calls and signal
// accesses. Pure: no IO, no cross-file resolution. `httpCalls`,
// `repositoryCalls` and `routes` stay empty until later tasks.
import ts from "ts-compiler";
import type {
  StructureInjection,
  StructureMemberCall,
  StructureSignalAccess,
  SymbolFlowFacts,
} from "./structureTypes";

const SIGNAL_WRITERS = new Set(["set", "update", "mutate"]);
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
  const calls: StructureMemberCall[] = [];
  const accesses: StructureSignalAccess[] = [];
  const unresolved: string[] = [];

  const recordCall = (call: ts.CallExpression, member: string, order: number): boolean => {
    const callee = call.expression;
    // `this.field()` / `this.method()`: a signal read, or a call.
    if (ts.isPropertyAccessExpression(callee) && isThis(callee.expression)) {
      const name = callee.name.getText(source);
      if (signals.has(name)) {
        accesses.push({ member, signal: name, access: "read", evidence: evidence(call, `signal read ${name}`) });
      } else {
        calls.push({ member, receiver: null, method: name, order, evidence: evidence(call, `call this.${name}`) });
      }
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
      } else {
        calls.push({ member, receiver: field, method, order, evidence: evidence(call, `call this.${field}.${method}`) });
      }
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
    httpCalls: [],
    repositoryCalls: [],
    routes: [],
    unresolved,
  };
}
