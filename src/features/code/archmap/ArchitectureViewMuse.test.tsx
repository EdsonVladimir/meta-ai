// @vitest-environment jsdom
// ArchitectureView with thread proposals: the store hands over the
// generation (overlay + inspector, no dialog) and reports accepts.
// Boards are stubbed to observe the proposal props; Tauri is mocked.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EMPTY_SELECTION, useRequirementsUi } from "../../requirements/uiStore";
import type {
  CodeAcceptDto,
  CodeGenerationDto,
  CodeProposalFileDto,
} from "../types";

const mocks = vi.hoisted(() => ({
  notifyFileChanged: vi.fn(),
  acceptResult: null as CodeAcceptDto | null,
  discardResult: null as CodeGenerationDto | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string) => {
    if (command === "code_accept_file") return mocks.acceptResult;
    if (command === "code_discard_file") return mocks.discardResult;
    return null;
  }),
}));

vi.mock("../useCodeWorkspace", () => ({
  useCodeWorkspace: () => ({
    desktop: true,
    roots: [],
    tabs: [],
    analyzeTs: async () => {
      throw new Error("not used");
    },
    scope: [],
    setScope: () => {},
    handleAddActiveFile: () => {},
    handleAddActiveFolder: () => {},
    openFileByRef: () => {},
    // A new function on every render, like the real provider.
    notifyFileChanged: (rootId: string, rel: string) => mocks.notifyFileChanged(rootId, rel),
    prefs: {},
    loader: null,
    selectedProjectId: "p1",
    selectedModuleId: "m1",
  }),
}));

vi.mock("../structure/StructureView", () => ({
  StructureView: () => <section aria-label="Manual scope stub" />,
  scopeKey: () => "",
}));

vi.mock("./ProjectMapView", () => ({
  ProjectMapView: (props: {
    proposalFiles?: CodeProposalFileDto[] | null;
    proposalGeneration?: CodeGenerationDto | null;
    reanalyzeRequest?: { files: Array<{ rootId: string; rel: string }>; nonce: number } | null;
    onAcceptProposalFile?: (pos: number) => void;
    onDiscardProposalFile?: (pos: number) => void;
    onOpenProposal?: () => void;
    onCloseProposal?: () => void;
  }) => (
    <section aria-label="Boards stub">
      <span data-testid="proposal-count">
        {props.proposalFiles === null || props.proposalFiles === undefined
          ? "none"
          : props.proposalFiles.length}
      </span>
      <span data-testid="proposal-id">{props.proposalGeneration?.id ?? "none"}</span>
      <span data-testid="reanalyze-nonce">{props.reanalyzeRequest?.nonce ?? "none"}</span>
      <button type="button" onClick={() => props.onAcceptProposalFile?.(0)}>
        stub accept
      </button>
      <button type="button" onClick={() => props.onDiscardProposalFile?.(1)}>
        stub discard
      </button>
      <button type="button" onClick={() => props.onOpenProposal?.()}>
        stub back to proposal
      </button>
      <button type="button" onClick={() => props.onCloseProposal?.()}>
        stub close proposal
      </button>
    </section>
  ),
}));

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  mocks.notifyFileChanged.mockClear();
  mocks.acceptResult = null;
  mocks.discardResult = null;
  useRequirementsUi.setState({
    selection: EMPTY_SELECTION,
    rightTab: "review",
    panels: { navigator: true, review: true, terminal: false, assistant: true },
    museGeneration: null,
    museAccepted: null,
  });
});

function fileDto(pos: number, overrides: Partial<CodeProposalFileDto> = {}): CodeProposalFileDto {
  return {
    pos,
    rootId: "r",
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
    projectId: "p1",
    moduleId: "m1",
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
    assumptions: [],
    questions: [],
    scope: [{ rootId: "r", rel: "src/a.ts", fingerprint: "9:aa" }],
    files: [fileDto(0), fileDto(1)],
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

async function renderView(): Promise<void> {
  useRequirementsUi.setState({
    selection: {
      projectId: "p1",
      moduleId: "m1",
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    },
  });
  const { ArchitectureView } = await import("./ArchitectureView");
  render(<ArchitectureView />);
}

describe("ArchitectureView with thread proposals", () => {
  it("shows a thread proposal from the store without any dialog", async () => {
    useRequirementsUi.getState().setMuseGeneration(generationDto());
    await renderView();
    expect(screen.getByTestId("proposal-count").textContent).toBe("2");
    expect(screen.getByTestId("proposal-id").textContent).toBe("cgen-1");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks and re-reads files accepted in the thread", async () => {
    await renderView();
    expect(screen.getByTestId("reanalyze-nonce").textContent).toBe("none");
    act(() => {
      useRequirementsUi.getState().setMuseAccepted({ rootId: "r", rel: "src/a.ts", nonce: 1 });
    });
    expect(mocks.notifyFileChanged).toHaveBeenCalledWith("r", "src/a.ts");
    expect(screen.getByTestId("reanalyze-nonce").textContent).toBe("1");
    act(() => {
      useRequirementsUi.getState().setMuseAccepted({ rootId: "r", rel: "src/a.ts", nonce: 2 });
    });
    expect(mocks.notifyFileChanged).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("reanalyze-nonce").textContent).toBe("2");
    // A later render changes nothing: one refresh per accepted file.
    act(() => useRequirementsUi.getState().setArchInspectorCollapsed(false));
    expect(mocks.notifyFileChanged).toHaveBeenCalledTimes(2);
  });

  it("writes inspector accepts back to the thread proposal", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    mocks.acceptResult = {
      generation: generationDto({ files: [fileDto(0, { state: "accepted", decidedAt: "t1" }), fileDto(1)] }),
      alreadyAccepted: false,
      fingerprint: "14:bb",
      size: 14,
    };
    useRequirementsUi.getState().setMuseGeneration(generationDto());
    await renderView();
    fireEvent.click(screen.getByText("stub accept"));
    await waitFor(() =>
      expect(useRequirementsUi.getState().museGeneration?.files[0].state).toBe("accepted"),
    );
    expect(mocks.notifyFileChanged).toHaveBeenCalledWith("r", "src/a.ts");
    expect(screen.getByTestId("reanalyze-nonce").textContent).toBe("1");
  });

  it("writes inspector discards back without re-reading", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    mocks.discardResult = generationDto({
      files: [fileDto(0), fileDto(1, { state: "discarded", decidedAt: "t2" })],
    });
    useRequirementsUi.getState().setMuseGeneration(generationDto());
    await renderView();
    fireEvent.click(screen.getByText("stub discard"));
    await waitFor(() =>
      expect(useRequirementsUi.getState().museGeneration?.files[1].state).toBe("discarded"),
    );
    expect(mocks.notifyFileChanged).not.toHaveBeenCalled();
  });

  it("returns to the thread from its proposal and clears it on close", async () => {
    useRequirementsUi.setState({
      rightTab: "review",
      panels: { navigator: true, review: true, terminal: false, assistant: false },
    });
    useRequirementsUi.getState().setMuseGeneration(generationDto());
    await renderView();
    fireEvent.click(screen.getByText("stub back to proposal"));
    expect(useRequirementsUi.getState().rightTab).toBe("assistant");
    expect(useRequirementsUi.getState().panels.assistant).toBe(true);
    fireEvent.click(screen.getByText("stub close proposal"));
    expect(useRequirementsUi.getState().museGeneration).toBeNull();
    expect(screen.getByTestId("proposal-count").textContent).toBe("none");
  });

  it("takes a cleared thread proposal off the board", async () => {
    useRequirementsUi.getState().setMuseGeneration(generationDto());
    await renderView();
    await waitFor(() => expect(screen.getByTestId("proposal-count").textContent).not.toBe("none"));
    act(() => useRequirementsUi.getState().setMuseGeneration(null));
    await waitFor(() => expect(screen.getByTestId("proposal-count").textContent).toBe("none"));
  });

  it("refreshes once per accepted file however often it renders", async () => {
    useRequirementsUi.setState({
      selection: {
        projectId: "p1",
        moduleId: "m1",
        requirementId: null,
        designId: null,
        mockupId: null,
        screenId: null,
      },
    });
    const { ArchitectureView } = await import("./ArchitectureView");
    const { rerender } = render(<ArchitectureView />);
    act(() => {
      useRequirementsUi.getState().setMuseAccepted({ rootId: "r", rel: "src/a.ts", nonce: 1 });
    });
    expect(mocks.notifyFileChanged).toHaveBeenCalledTimes(1);
    rerender(<ArchitectureView />);
    rerender(<ArchitectureView />);
    expect(mocks.notifyFileChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("reanalyze-nonce").textContent).toBe("1");
  });
});
