// Angular pipeline facts: HTTP client interceptors.
import { expect, it } from "vitest";
import { analyzeTsFiles } from "./tsAnalyze";

function analyze(content: string, rel = "a.ts") {
  return analyzeTsFiles([{ rootId: "root-1", rel, content, hash: `h:${rel}` }]);
}

it("reads withInterceptors in order", () => {
  const result = analyze(`bootstrapApplication(App, { providers: [
  provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
] });`);
  expect(result.pipeline).toEqual([
    expect.objectContaining({ scope: "http-client", names: ["authInterceptor", "errorInterceptor"] }),
  ]);
});
