// Angular pipeline facts: HTTP client interceptors registered with
// `provideHttpClient(withInterceptors([...]))`. Pure: no IO, no
// cross-file resolution. Only plain identifiers are collected;
// anything else is skipped, never guessed.
import ts from "ts-compiler";
import type { PipelineFact } from "./structureTypes";

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
