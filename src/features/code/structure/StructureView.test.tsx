// @vitest-environment jsdom
// Structure view: scope, injected analysis, inspector, verified
// navigation and staleness. The graph is a local double.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const backend = vi.hoisted(() => ({
  files: {} as Record<string, { text: string; fingerprint: string; size: number }>,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, Record<string, unknown>>) => {
    if (cmd === "code_read_file") {
      const input = (args?.input ?? {}) as { rootId: string; rel: string };
      const file = backend.files[`${input.rootId}::${input.rel}`];
      if (file === undefined) throw { kind: "code_not_found", message: "Does not exist" };
      return { ...file };
    }
    throw { kind: "unknown", message: `Unsimulated command: ${cmd}` };
  }),
}));

vi.mock("./StructureGraph", () => ({
  StructureGraph: ({
    symbols,
    visibleIds,
    onSelect,
  }: {
    symbols: Array<{ id: string; name: string }>;
    visibleIds: Set<string>;
    onSelect: (id: string | null) => void;
  }) => (
    <div data-testid="graph">
      {symbols
        .filter((symbol) => visibleIds.has(symbol.id))
        .map((symbol) => (
          <button key={symbol.id} type="button" onClick={() => onSelect(symbol.id)}>
            node:{symbol.name}
          </button>
        ))}
    </div>
  ),
}));

import { StructureView } from "./StructureView";
import { analyzeTsFiles } from "./tsAnalyze";
import { STRUCTURE_LIMITS, type StructureRange } from "./structureTypes";
import { DEFAULT_CODE_EDITOR_PREFS } from "../editorPrefs";

const MODEL = `export interface Named { name: string; }
export class Person implements Named {
  name = "";
  greet() {}
}`;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  backend.files = { "root-1::model.ts": { text: MODEL, fingerprint: "f0", size: MODEL.length } };
});

function renderView(opened: Array<{ rootId: string; rel: string; range: StructureRange | null }>) {
  return render(
    <StructureView
      scope={[{ rootId: "root-1", rel: "model.ts" }]}
      rootNames={{ "root-1": "frontend" }}
      onRemoveScope={() => {}}
      onAddActiveFile={() => {}}
      onAddActiveFolder={() => {}}
      tabs={[]}
      onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
      analyzeTs={async (files) => analyzeTsFiles(files)}
    />,
  );
}

describe("StructureView", () => {
  it("analyzes the scope and shows the diagram", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    renderView(opened);
    expect(screen.getByText("model.ts")).toBeDefined();
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    expect(screen.getByText("node:Named")).toBeDefined();
    expect(screen.getByText("node:Person")).toBeDefined();
  });

  it("the inspector details relations and opens in code with a range", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    renderView(opened);
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    fireEvent.click(screen.getByText("node:Person"));
    expect(screen.getByText("Relations")).toBeDefined();
    expect(screen.getByText("Named")).toBeDefined();
    fireEvent.click(screen.getByText("Open in code"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ rootId: "root-1", rel: "model.ts" });
    expect(opened[0].range).toMatchObject({ startLine: 2 });
  });

  it("when the file changed, opens without a range and marks stale", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    renderView(opened);
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    // External change after the analysis.
    backend.files["root-1::model.ts"] = {
      text: `${MODEL}\nexport class Extra {}`,
      fingerprint: "fx",
      size: 10,
    };
    fireEvent.click(screen.getByText("node:Person"));
    fireEvent.click(screen.getByText("Open in code"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0].range).toBeNull();
    expect(screen.getAllByText(/changed since the analysis/)).toHaveLength(2);
    expect(screen.getByText("Recalculate")).toBeDefined();
  });

  it("integrates the Rust analysis in the same contract", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    backend.files["root-1::lib.rs"] = { text: "pub struct S;", fingerprint: "f1", size: 14 };
    render(
      <StructureView
        scope={[{ rootId: "root-1", rel: "lib.rs" }]}
        rootNames={{ "root-1": "backend" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={() => {}}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async () => {
          throw new Error("must not be used for .rs");
        }}
        analyzeRust={async (files) => ({
          files: files.map((file) => ({
            rootId: file.rootId,
            rel: file.rel,
            hash: "h",
            bytes: 14,
            language: "rust" as const,
            status: "ok" as const,
            message: null,
          })),
          symbols: [
            {
              id: "rs:root-1:lib.rs#0",
              language: "rust" as const,
              kind: "struct" as const,
              name: "S",
              rootId: "root-1",
              rel: "lib.rs",
              range: { startLine: 1, startCol: 12, endLine: 1, endCol: 13 },
              members: [],
              membersTruncated: false,
              heuristic: null,
            },
          ],
          relations: [],
          endpoints: [],
          calls: [],
          symbolsTruncated: false,
          relationsTruncated: false,
          endpointsTruncated: false,
          callsTruncated: false,
          limits: STRUCTURE_LIMITS,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    expect(screen.getByText("node:S")).toBeDefined();
    fireEvent.click(screen.getByText("node:S"));
    expect(
      screen.getByText(
        (_, element) => element?.textContent === "S · structs · Rust",
      ),
    ).toBeDefined();
  });

  it("filters by kind and search", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    renderView(opened);
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    // Removing interfaces hides Named.
    fireEvent.click(screen.getByRole("checkbox", { name: "Interfaces" }));
    expect(screen.queryByText("node:Named")).toBeNull();
    expect(screen.getByText("node:Person")).toBeDefined();
    fireEvent.click(screen.getByRole("checkbox", { name: "Interfaces" }));
    // Searching filters by name.
    fireEvent.change(screen.getByPlaceholderText("Symbol name…"), {
      target: { value: "pers" },
    });
    expect(screen.queryByText("node:Named")).toBeNull();
    expect(screen.getByText("node:Person")).toBeDefined();
  });

  it("exposes the active-tab folder without analyzing it alone", () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    const onAddActiveFolder = vi.fn();
    render(
      <StructureView
        scope={[]}
        rootNames={{ "root-1": "frontend" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={onAddActiveFolder}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async (files) => analyzeTsFiles(files)}
      />,
    );
    fireEvent.click(screen.getByText("+ Active folder"));
    expect(onAddActiveFolder).toHaveBeenCalledTimes(1);
  });

  it("the Data tab lists types with members and code jumps", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    renderView(opened);
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    // Only the interface; the class stays in Classes.
    expect(screen.getByText("Named")).toBeDefined();
    expect(screen.queryByText("Person")).toBeNull();
    expect(screen.getByText("name")).toBeDefined();
    fireEvent.click(screen.getByText("Open in code"));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ rootId: "root-1", rel: "model.ts" });
    expect(opened[0].range).toMatchObject({ startLine: 1 });
  });

  it("the APIs tab joins, separates unused ones and navigates with a fingerprint", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    const server = `const app = express();\napp.get("/users", h);\napp.post("/users", h);\n`;
    const client = `fetch("/users");\nfetch("/missing", { method: "DELETE" });\n`;
    backend.files["root-1::server.ts"] = { text: server, fingerprint: "s", size: server.length };
    backend.files["root-1::client.ts"] = { text: client, fingerprint: "c", size: client.length };
    render(
      <StructureView
        scope={[
          { rootId: "root-1", rel: "server.ts" },
          { rootId: "root-1", rel: "client.ts" },
        ]}
        rootNames={{ "root-1": "app" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={() => {}}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async (files) => analyzeTsFiles(files)}
      />,
    );
    expect(screen.queryByRole("tab", { name: "APIs" })).toBeNull();
    fireEvent.click(screen.getByText("Analyze selection"));
    expect(await screen.findByTestId("graph")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "APIs" }));
    expect(screen.getByText("GET /users")).toBeDefined();
    expect(screen.getByText(/Exposed without detected use/)).toBeDefined();
    expect(screen.getByText("POST /users")).toBeDefined();
    expect(screen.getByText(/Consumed without a definition/)).toBeDefined();
    expect(screen.getByText("DELETE /missing")).toBeDefined();
    // Opening the exposing end verifies the fingerprint and jumps to the range.
    fireEvent.click(screen.getAllByText("app/server.ts:2")[0]);
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toMatchObject({ rootId: "root-1", rel: "server.ts" });
    expect(opened[0].range).toMatchObject({ startLine: 2 });
  });

  it("proposing code requires project, module, scope and prefs", async () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    // Without project or prefs: disabled with a reason.
    const { unmount } = render(
      <StructureView
        scope={[{ rootId: "root-1", rel: "model.ts" }]}
        rootNames={{ "root-1": "frontend" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={() => {}}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async (files) => analyzeTsFiles(files)}
      />,
    );
    const disabled = screen.getByText("Propose code");
    expect((disabled as HTMLButtonElement).disabled).toBe(true);
    unmount();
    // With everything: opens the dialog (without desktop, warns on listing).
    render(
      <StructureView
        scope={[{ rootId: "root-1", rel: "model.ts" }]}
        rootNames={{ "root-1": "frontend" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={() => {}}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async (files) => analyzeTsFiles(files)}
        projectId="proy-1"
        moduleId="mod-1"
        prefs={DEFAULT_CODE_EDITOR_PREFS}
      />,
    );
    const enabled = screen.getByText("Propose code");
    expect((enabled as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enabled);
    expect(await screen.findByRole("dialog", { name: "Propose code" })).toBeDefined();
  });

  it("with an empty scope shows the three-step guide", () => {
    const opened: Array<{ rootId: string; rel: string; range: StructureRange | null }> = [];
    render(
      <StructureView
        scope={[]}
        rootNames={{ "root-1": "frontend" }}
        onRemoveScope={() => {}}
        onAddActiveFile={() => {}}
        onAddActiveFolder={() => {}}
        tabs={[]}
        onOpenFile={(rootId, rel, range) => opened.push({ rootId, rel, range })}
        analyzeTs={async (files) => analyzeTsFiles(files)}
      />,
    );
    expect(screen.queryByTestId("graph")).toBeNull();
    expect(screen.getByText(/Add scope/)).toBeDefined();
    expect(screen.getByText(/Press.*Analyze selection.*diagram/)).toBeDefined();
    expect(screen.getByText(/Press a symbol to open its code/)).toBeDefined();
  });
});
