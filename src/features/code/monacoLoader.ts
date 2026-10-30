// Lazy Monaco loading: the editor (and its workers) downloads only on
// the first file open. The editor API is imported (`editor.api`, with
// the local find included) plus lazy Monarch grammars: each travels in
// its own chunk and downloads only when used. Two honest exceptions,
// documented in the UI as what they are:
// - JSON only exists as a local Monaco service: it brings highlighting
//   and its own validation (a ~400 KiB worker), with no AI involved.
// - TOML has no grammar in Monaco 0.57: it highlights as INI.
// None of this is a complete language analysis.
import type * as monaco from "monaco-editor";

export type MonacoApi = typeof monaco;

let cached: Promise<MonacoApi> | null = null;

export function loadMonaco(): Promise<MonacoApi> {
  if (cached === null) {
    cached = (async () => {
      const editorWorkerModule = await import("monaco-editor/editor/editor.worker?worker");
      const jsonWorkerModule = await import("monaco-editor/language/json/json.worker?worker");
      const EditorWorker = editorWorkerModule.default as new () => Worker;
      const JsonWorker = jsonWorkerModule.default as new () => Worker;
      (
        self as unknown as {
          MonacoEnvironment?: { getWorker: (_moduleId: string, label: string) => Worker };
        }
      ).MonacoEnvironment = {
        getWorker: (_moduleId, label) =>
          label === "json" ? new JsonWorker() : new EditorWorker(),
      };
      const api = (await import(
        "monaco-editor/editor/editor.api"
      )) as unknown as MonacoApi;
      // Literal imports (not a variable loop): Vite creates one chunk
      // per language, and only the requested ones.
      await Promise.all([
        import("monaco-editor/languages/definitions/typescript/register"),
        import("monaco-editor/languages/definitions/javascript/register"),
        import("monaco-editor/languages/definitions/rust/register"),
        import("monaco-editor/languages/definitions/python/register"),
        import("monaco-editor/languages/definitions/html/register"),
        import("monaco-editor/languages/definitions/css/register"),
        import("monaco-editor/languages/definitions/markdown/register"),
        import("monaco-editor/languages/definitions/yaml/register"),
        import("monaco-editor/languages/definitions/ini/register"),
        import("monaco-editor/languages/definitions/shell/register"),
        import("monaco-editor/languages/definitions/dockerfile/register"),
        // @ts-expect-error: the package ships no types for this contribution.
        import("monaco-editor/language/json/monaco.contribution"),
      ]);
      return api;
    })();
  }
  return cached;
}
