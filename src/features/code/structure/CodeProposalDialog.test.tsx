// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CodeProposalDialog, type CodeGenApi } from "./CodeProposalDialog";
import type { CodeGenRequest } from "../client";
import { DEFAULT_CODE_EDITOR_PREFS } from "../editorPrefs";
import type {
  CodeGenContextDto,
  CodeGenerationDto,
  CodeProposalFileDto,
} from "../types";
import type { ArtifactDto } from "../../requirements/types";
import { useRequirementsUi } from "../../requirements/uiStore";
import { analyzeTsFiles } from "./tsAnalyze";

afterEach(() => cleanup());

function req(id: string, title: string): ArtifactDto {
  return { id, projectId: "proy-1", moduleId: "mod-1", kind: "requirement", title, archived: false };
}

function fileDto(pos: number, overrides: Partial<CodeProposalFileDto> = {}): CodeProposalFileDto {
  return {
    pos,
    rootId: "root-1",
    rel: pos === 0 ? "src/a.ts" : "src/b.ts",
    operation: pos === 0 ? "modify" : "create",
    state: "pending",
    decidedAt: null,
    content: pos === 0 ? "const a = 2;\n" : "export {};\n",
    expectedFingerprint: pos === 0 ? "9:aa" : null,
    ...overrides,
  };
}

function generationDto(overrides: Partial<CodeGenerationDto> = {}): CodeGenerationDto {
  return {
    id: "cgen-1",
    projectId: "proy-1",
    moduleId: "mod-1",
    requirementArtifactId: "req-1",
    requirementVersionId: "req-1-v1",
    screenArtifactId: "",
    screenId: "",
    screenVersionId: "",
    screenSources: [],
    model: "m",
    templateVersion: 1,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    createdAt: "t",
    explanation: "Adds the discount.",
    assumptions: ["In-memory stock."],
    questions: ["On reserve or on confirm?"],
    scope: [{ rootId: "root-1", rel: "src/a.ts", fingerprint: "9:aa" }],
    files: [fileDto(0), fileDto(1)],
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

function contextDto(): CodeGenContextDto {
  return {
    projectId: "proy-1",
    moduleId: "mod-1",
    artifactId: "req-1",
    versionId: "req-1-v1",
    requirementChars: 30,
    screenId: "",
    screenTitle: "",
    screenChars: 0,
    screenSources: [],
    files: [{ rootId: "root-1", rel: "src/a.ts", fingerprint: "9:aa", bytes: 14, chars: 14 }],
    totalChars: 44,
  };
}

function screenContextDto(): CodeGenContextDto {
  return {
    ...contextDto(),
    artifactId: "mock-1",
    versionId: "mock-1-v2",
    requirementChars: 0,
    screenId: "signup",
    screenTitle: "User signup",
    screenChars: 120,
    screenSources: [{ artifactId: "req-1", versionId: "req-1-v1", chars: 30 }],
    totalChars: 164,
  };
}

function fakeApi(overrides: Partial<CodeGenApi> = {}): CodeGenApi {
  return {
    listRequirements: async () => [req("req-1", "Discount stock")],
    listMockupScreens: async () => [
      {
        artifactId: "mock-1",
        title: "Signup",
        versionId: "mock-1-v2",
        screens: [{ id: "signup", title: "User signup" }],
      },
    ],
    genContext: async () => contextDto(),
    generate: async () => generationDto(),
    listGenerations: async () => [],
    acceptFile: async (_generationId, pos) => ({
      generation: generationDto({
        files: [fileDto(0, { state: pos === 0 ? "accepted" : "pending", decidedAt: "t1" }), fileDto(1)],
      }),
      alreadyAccepted: false,
      fingerprint: "14:bb",
      size: 14,
    }),
    discardFile: async () => generationDto(),
    readFile: async () => ({ text: "const a = 1;\n", fingerprint: "9:aa", size: 14 }),
    ...overrides,
  };
}

type DialogExtra = Record<string, unknown>;

function renderDialog(api: CodeGenApi, extra?: DialogExtra): {
  onFileAccepted: ReturnType<typeof vi.fn>;
  onReanalyze: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
};
function renderDialog(extra: DialogExtra): {
  onFileAccepted: ReturnType<typeof vi.fn>;
  onReanalyze: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
};
function renderDialog(
  apiOrExtra: CodeGenApi | DialogExtra = fakeApi(),
  extra: DialogExtra = {},
) {
  const isApi = typeof (apiOrExtra as CodeGenApi).generate === "function";
  // The single-arg form reports generations as "gen-1" for the reporting test.
  const api = isApi
    ? (apiOrExtra as CodeGenApi)
    : fakeApi({ generate: async () => generationDto({ id: "gen-1" }) });
  const props = isApi ? extra : (apiOrExtra as DialogExtra);
  const onFileAccepted = vi.fn();
  const onReanalyze = vi.fn(async () => {});
  const onClose = vi.fn();
  render(
    <CodeProposalDialog
      projectId="proy-1"
      moduleId="mod-1"
      scope={[{ rootId: "root-1", rel: "src/a.ts" }]}
      rootNames={{ "root-1": "app" }}
      baseline={null}
      current={null}
      onReanalyze={onReanalyze}
      onFileAccepted={onFileAccepted}
      onClose={onClose}
      prefs={DEFAULT_CODE_EDITOR_PREFS}
      loader={() => Promise.reject(new Error("no monaco"))}
      api={api}
      {...props}
    />,
  );
  return { onFileAccepted, onReanalyze, onClose };
}

const generate_ = (): Promise<void> => generate();

async function generate(): Promise<void> {
  fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), {
    target: { value: "req-1" },
  });
  fireEvent.click(screen.getByText("Preview"));
  fireEvent.click(await screen.findByText("Generate proposal"));
  await screen.findByText(/Proposal gen-1/);
}

describe("code proposal dialog", () => {
  it("steps aside for the X-ray and keeps the proposal", async () => {
    const onViewOnXray = vi.fn();
    const { onClose } = renderDialog({ onViewOnXray });
    expect(screen.queryByRole("button", { name: "View on X-ray" })).toBeNull();
    await generate();
    fireEvent.click(screen.getByRole("button", { name: "View on X-ray" }));
    expect(onViewOnXray).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores Escape while hidden", async () => {
    const onGeneration = vi.fn();
    const { onClose } = renderDialog({ hidden: true, onGeneration });
    onGeneration.mockClear();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(onGeneration).not.toHaveBeenCalledWith(null);
  });

  it("picks a requirement, previews and generates the proposal", async () => {
    const api = fakeApi();
    renderDialog(api);
    expect(await screen.findByText("Discount stock")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    expect(await screen.findByText("Will go to Meta")).toBeDefined();
    expect(screen.getByText("req-1-v1")).toBeDefined();
    expect(screen.getByText(/app\/src\/a\.ts/)).toBeDefined();
    fireEvent.click(screen.getByText("Generate proposal"));
    expect(await screen.findByText(/Proposal cgen-1/)).toBeDefined();
    expect(screen.getByText("Adds the discount.")).toBeDefined();
    expect(screen.getByText("In-memory stock.")).toBeDefined();
    expect(screen.getByText("On reserve or on confirm?")).toBeDefined();
    expect(screen.getByText(/~ app\/src\/a\.ts/)).toBeDefined();
    expect(screen.getByText(/\+ app\/src\/b\.ts/)).toBeDefined();
  });

  it("picks a screen, previews the origin with sources and generates", async () => {
    const genContext = vi.fn(async () => screenContextDto());
    const generate = vi.fn(async () =>
      generationDto({
        requirementArtifactId: "",
        requirementVersionId: "",
        screenArtifactId: "mock-1",
        screenId: "signup",
        screenVersionId: "mock-1-v2",
        screenSources: [{ artifactId: "req-1", versionId: "req-1-v1" }],
        templateVersion: 2,
      }),
    );
    renderDialog(fakeApi({ genContext, generate }));
    fireEvent.click(screen.getByRole("radio", { name: "Screen" }));
    fireEvent.change(await screen.findByLabelText("Mockup"), { target: { value: "mock-1" } });
    fireEvent.change(screen.getByLabelText("Screen", { selector: "select" }), {
      target: { value: "signup" },
    });
    fireEvent.click(screen.getByText("Preview"));
    expect(await screen.findByText("Will go to Meta")).toBeDefined();
    expect(genContext).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { kind: "screen", mockupId: "mock-1", screenId: "signup" },
      }),
    );
    expect(screen.getByText("User signup")).toBeDefined();
    expect(screen.getByText("mock-1-v2")).toBeDefined();
    expect(screen.getByText("req-1-v1")).toBeDefined();
    fireEvent.click(screen.getByText("Generate proposal"));
    expect(await screen.findByText(/Proposal cgen-1/)).toBeDefined();
    expect(screen.getByText(/mock-1\/signup @ mock-1-v2/)).toBeDefined();
  });

  it("with a draft in the mockup warns and offers saving everything", async () => {
    useRequirementsUi.setState({
      docStatus: { "mockup:mock-1": { label: "mockup Registro", dirty: true, saving: false, error: null } },
    });
    try {
      renderDialog(fakeApi());
      fireEvent.click(screen.getByRole("radio", { name: "Screen" }));
      fireEvent.change(await screen.findByLabelText("Mockup"), { target: { value: "mock-1" } });
      expect(
        await screen.findByText(/has unsaved changes: the context will use the saved version/),
      ).toBeDefined();
      const before = useRequirementsUi.getState().saveAllSignal;
      fireEvent.click(screen.getByText("Save all"));
      expect(useRequirementsUi.getState().saveAllSignal).toBe(before + 1);
    } finally {
      useRequirementsUi.setState({ docStatus: {} });
    }
  });

  it("without mockups says so without breaking the requirement origin", async () => {
    renderDialog(fakeApi({ listMockupScreens: async () => [] }));
    fireEvent.click(screen.getByRole("radio", { name: "Screen" }));
    expect(await screen.findByText("No mockups with screens in this module.")).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "Requirement" }));
    expect(await screen.findByLabelText("Requirement", { selector: "select" })).toBeDefined();
  });

  it("accepting writes, notifies the workspace and marks the file", async () => {
    const acceptFile = vi.fn(fakeApi().acceptFile);
    const { onFileAccepted } = renderDialog(fakeApi({ acceptFile }));
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    await screen.findByText(/Proposal cgen-1/);
    const acceptButtons = screen.getAllByText("Accept");
    fireEvent.click(acceptButtons[0]);
    await waitFor(() => expect(acceptFile).toHaveBeenCalledWith("cgen-1", 0));
    expect(onFileAccepted).toHaveBeenCalledWith("root-1", "src/a.ts");
    expect(await screen.findByText(/written to disk/)).toBeDefined();
  });

  it("discarding marks without writing", async () => {
    const discardFile = vi.fn(async () =>
      generationDto({ files: [fileDto(0), fileDto(1, { state: "discarded", decidedAt: "t2" })] }),
    );
    renderDialog(fakeApi({ discardFile }));
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    await screen.findByText(/Proposal cgen-1/);
    fireEvent.click(screen.getAllByText("Discard")[1]);
    await waitFor(() => expect(discardFile).toHaveBeenCalledWith("cgen-1", 1));
    expect(await screen.findByText(/src\/b\.ts" discarded/)).toBeDefined();
  });

  it("a stale proposal blocks accepting with the reason", async () => {
    const stale = generationDto({ stale: true, staleReason: "The requirement changed since generation." });
    renderDialog(fakeApi({ generate: async () => stale }));
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    await screen.findByText(/Stale/);
    const acceptButtons = screen.getAllByText("Accept");
    for (const button of acceptButtons) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("the diff compares current vs proposed in text when Monaco fails", async () => {
    renderDialog(fakeApi());
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    await screen.findByText(/Proposal cgen-1/);
    fireEvent.click(screen.getAllByText("View diff")[0]);
    expect(await screen.findByText("const a = 1;")).toBeDefined();
    expect(screen.getByText("const a = 2;")).toBeDefined();
  });

  it("lists previous ones and opens a saved one", async () => {
    const old = generationDto({ id: "cgen-0", explanation: "Previous." });
    renderDialog(fakeApi({ listGenerations: async () => [old] }));
    await screen.findByLabelText("Requirement", { selector: "select" });
    fireEvent.click(screen.getByText("View previous"));
    expect(await screen.findByText("cgen-0")).toBeDefined();
    fireEvent.click(screen.getByText("cgen-0"));
    expect(await screen.findByText("Previous.")).toBeDefined();
  });

  it("re-analyzing shows the diff against the opening", async () => {
    const baseline = analyzeTsFiles([
      { rootId: "root-1", rel: "s.ts", content: "export class A {}\n", hash: "h1" },
    ]);
    const current = analyzeTsFiles([
      {
        rootId: "root-1",
        rel: "s.ts",
        content: "export class A {}\napp.get(\"/users\", h);\n",
        hash: "h2",
      },
    ]);
    const { onReanalyze } = renderDialog(fakeApi(), { baseline, current });
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    await screen.findByText(/Proposal cgen-1/);
    expect(screen.queryByText(/unions/)).toBeNull();
    fireEvent.click(screen.getByText("Re-analyze the scope"));
    await waitFor(() => expect(onReanalyze).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/\+1\/−0 endpoints/)).toBeDefined();
  });

  it("network errors show without closing", async () => {
    renderDialog(
      fakeApi({
        generate: async () => {
          throw { kind: "meta_rate_limit", message: "Limit exceeded." };
        },
      }),
    );
    fireEvent.change(await screen.findByLabelText("Requirement", { selector: "select" }), { target: { value: "req-1" } });
    fireEvent.click(screen.getByText("Preview"));
    fireEvent.click(await screen.findByText("Generate proposal"));
    expect(await screen.findByText("Limit exceeded.")).toBeDefined();
    expect(screen.getByText("Generate proposal")).toBeDefined();
  });

  it("reports each generation and clears on discard", async () => {
    const onGeneration = vi.fn();
    renderDialog({ onGeneration });
    await generate();
    expect(onGeneration).toHaveBeenLastCalledWith(expect.objectContaining({ id: "gen-1" }));
    fireEvent.click(screen.getByRole("button", { name: /Close/ }));
    expect(onGeneration).toHaveBeenLastCalledWith(null);
  });

  it("sends the adjustment as a new generation", async () => {
    const api = {
      ...fakeApi(),
      generate: vi.fn(async (_input: CodeGenRequest) => generationDto({ id: "gen-1" })),
    };
    renderDialog({ api });
    await generate();
    fireEvent.change(screen.getByLabelText("Ask Muse to adjust"), { target: { value: "add email" } });
    fireEvent.click(screen.getByRole("button", { name: "Send adjustment" }));
    await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(2));
    expect(api.generate.mock.calls[1]![0].instruction).toBe("add email");
  });

  it("sends the proposal being adjusted and clears the request", async () => {
    const generate = vi.fn(async (_input: CodeGenRequest) => generationDto({ id: "gen-1" }));
    renderDialog(fakeApi({ generate }));
    await generate_();
    fireEvent.change(screen.getByLabelText("Ask Muse to adjust"), {
      target: { value: "add email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send adjustment" }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(2));
    expect(generate.mock.calls[1][0].previousGenerationId).toBe("gen-1");
    await waitFor(() =>
      expect((screen.getByLabelText("Ask Muse to adjust") as HTMLInputElement).value).toBe(""),
    );
  });

  it("keeps Send adjustment disabled when empty", async () => {
    renderDialog({});
    await generate();
    expect((screen.getByRole("button", { name: "Send adjustment" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
