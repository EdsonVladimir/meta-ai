// Monaco test double: observable models without a real DOM. It covers
// the surface used by CodeEditor and the conflict diff.
import type { MonacoApi } from "./monacoLoader";

export interface FakeModel {
  value: string;
  listeners: Array<() => void>;
  language: string;
}

interface FakeRange {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

function lineCountOf(value: string): number {
  return value === "" ? 1 : value.split("\n").length;
}

function valueInRange(value: string, range: FakeRange): string {
  const lines = value.split("\n");
  const startLine = Math.min(Math.max(range.startLineNumber, 1), lines.length);
  const endLine = Math.min(Math.max(range.endLineNumber, 1), lines.length);
  if (startLine === endLine) {
    const line = lines[startLine - 1] ?? "";
    const from = Math.min(Math.max(range.startColumn, 1), line.length + 1);
    const to = Math.min(Math.max(range.endColumn, 1), line.length + 1);
    return line.slice(Math.min(from, to) - 1, Math.max(from, to) - 1);
  }
  const [fromLine, toLine] = startLine < endLine ? [startLine, endLine] : [endLine, startLine];
  const [fromCol, toCol] =
    startLine < endLine ? [range.startColumn, range.endColumn] : [range.endColumn, range.startColumn];
  const first = (lines[fromLine - 1] ?? "").slice(Math.max(fromCol, 1) - 1);
  const last = (lines[toLine - 1] ?? "").slice(0, Math.max(toCol, 1) - 1);
  return [first, ...lines.slice(fromLine, toLine - 1), last].join("\n");
}

export function createMonacoFake() {
  const models = new Map<string, FakeModel & { api: object }>();
  const calls: string[] = [];
  let lastEditor: {
    moveCursor: (
      position: { lineNumber: number; column: number },
      selection: FakeRange | null,
    ) => void;
  } | null = null;

  function getModel(key: string) {
    const model = models.get(`ruth://${key}`);
    if (model === undefined) throw new Error(`no model for ${key}`);
    return model;
  }

  function liveModel(uri: string) {
    const model = models.get(uri);
    if (model === undefined) throw new Error(`no model for ${uri}`);
    return model;
  }

  const loader = () =>
    Promise.resolve(
      {
        editor: {
          defineTheme: (name: string) => {
            calls.push(`theme:${name}`);
          },
          setTheme: (name: string) => {
            calls.push(`set-theme:${name}`);
          },
          create: (container: object, options: object) => {
            void container;
            calls.push(`create:${JSON.stringify(options)}`);
            let currentModel: {
              getValueInRange: (range: FakeRange) => string;
              getLineCount: () => number;
            } | null = null;
            let position = { lineNumber: 1, column: 1 };
            let selection: FakeRange | null = null;
            const positionListeners: Array<() => void> = [];
            const selectionListeners: Array<() => void> = [];
            const editor = {
              setModel: (model: object | null) => {
                currentModel = model as typeof currentModel;
              },
              getModel: () => currentModel,
              getPosition: () => ({ ...position }),
              getSelection: () => (selection === null ? null : { ...selection }),
              onDidChangeCursorPosition: (fn: () => void) => {
                positionListeners.push(fn);
                return { dispose: () => {} };
              },
              onDidChangeCursorSelection: (fn: () => void) => {
                selectionListeners.push(fn);
                return { dispose: () => {} };
              },
              updateOptions: (next: object) => {
                calls.push(`update:${JSON.stringify(next)}`);
              },
              saveViewState: () => null,
              restoreViewState: () => {},
              layout: () => {
                calls.push("layout");
              },
              dispose: () => {},
              setSelection: (next: object) => {
                calls.push(`select:${JSON.stringify(next)}`);
              },
              revealRangeInCenter: () => {
                calls.push("reveal");
              },
              focus: () => {
                calls.push("focus");
              },
            };
            lastEditor = {
              moveCursor: (next, nextSelection) => {
                position = { ...next };
                selection = nextSelection === null ? null : { ...nextSelection };
                for (const fn of [...positionListeners]) fn();
                for (const fn of [...selectionListeners]) fn();
              },
            };
            return editor;
          },
          createDiffEditor: (_container: object, options?: Record<string, unknown>) => {
            calls.push(
              `diff:${JSON.stringify({
                renderSideBySide: options?.renderSideBySide,
                readOnly: options?.readOnly,
                theme: options?.theme,
              })}`,
            );
            return {
              setModel: () => {
                calls.push("diff-model");
              },
              updateOptions: (next: object) => {
                calls.push(`diff-update:${JSON.stringify(next)}`);
              },
              layout: () => {},
              dispose: () => {
                calls.push("diff-dispose");
              },
            };
          },
          createModel: (value: string, language: string, uri: { toString: () => string }) => {
            const model: FakeModel = { value, listeners: [], language };
            const key = uri.toString();
            const api = {
              getValue: () => liveModel(key).value,
              getValueInRange: (range: FakeRange) => valueInRange(liveModel(key).value, range),
              getLineCount: () => lineCountOf(liveModel(key).value),
              setValue: (next: string) => {
                liveModel(key).value = next;
              },
              onDidChangeContent: (fn: () => void) => {
                liveModel(key).listeners.push(fn);
                return { dispose: () => {} };
              },
              dispose: () => {},
            };
            models.set(key, { ...model, api });
            return api;
          },
          setModelLanguage: () => {},
        },
        Uri: { parse: (text: string) => ({ toString: () => text }) },
      } as unknown as MonacoApi,
    );

  /** Simulates typing in a tab model (fires onChange). */
  function typeIn(key: string, value: string) {
    const model = getModel(key);
    model.value = value;
    for (const fn of [...model.listeners]) fn();
  }

  function valueOf(key: string): string {
    return getModel(key).value;
  }

  function hasModel(key: string): boolean {
    return models.has(`ruth://${key}`);
  }

  function moveCursor(
    position: { lineNumber: number; column: number },
    selection: FakeRange | null = null,
  ) {
    if (lastEditor === null) throw new Error("no editor created");
    lastEditor.moveCursor(position, selection);
  }

  return { loader, typeIn, valueOf, hasModel, moveCursor, calls };
}

