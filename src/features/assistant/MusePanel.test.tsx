// @vitest-environment jsdom
// Muse dialog: what goes out is chosen, blocked folders send nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodeGenerationDto, CodeProposalFileDto, CodeRootDto } from "../code/types";
import type { RequirementDetail } from "../requirements/types";
import { useRequirementsUi } from "../requirements/uiStore";
import { MusePanel, type MusePanelApi } from "./MusePanel";

afterEach(() => {
  cleanup();
  useRequirementsUi.setState({ museGeneration: null, museAccepted: null });
});

const root: CodeRootDto = {
  id: "r",
  path: "/shop",
  name: "shop",
  missing: false,
  projectId: null,
  aiBlocked: false,
};
const target = { rootId: "r", rel: "core", kind: "folder" as const };

function fileDto(pos: number, overrides: Partial<CodeProposalFileDto> = {}): CodeProposalFileDto {
  return {
    pos,
    rootId: "r",
    rel: pos === 0 ? "core/f0.ts" : "core/f2.ts",
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
    assumptions: ["In-memory stock."],
    questions: ["On reserve or on confirm?"],
    scope: [{ rootId: "r", rel: "core/f0.ts", fingerprint: "9:aa" }],
    files: [fileDto(0), fileDto(1)],
    stale: false,
    staleReason: null,
    ...overrides,
  };
}

function api(count = 2): MusePanelApi {
  return {
    listDir: vi.fn(async () => ({
      entries: Array.from({ length: count }, (_, i) => ({
        name: `f${i}.ts`,
        rel: `core/f${i}.ts`,
        kind: "file" as const,
        size: 1,
      })),
      truncated: false,
    })),
    ask: vi.fn(async () => ({ answer: "It validates.", model: "m" })),
    generate: vi.fn(async () => generationDto()),
    acceptFile: vi.fn(async (_generationId: string, pos: number) => ({
      generation: generationDto({
        files: [
          fileDto(0, { state: pos === 0 ? "accepted" : "pending", decidedAt: "t1" }),
          fileDto(1, { state: pos === 1 ? "accepted" : "pending", decidedAt: "t1" }),
        ],
      }),
      alreadyAccepted: false,
      fingerprint: "14:bb",
      size: 14,
    })),
    discardFile: vi.fn(async () => generationDto()),
    readFile: vi.fn(async () => ({ text: "const a = 1;\n", fingerprint: "9:aa", size: 14 })),
    createRequirement: vi.fn(async () => ({ artifact: { id: "req-1" } })),
    listModules: vi.fn(async () => []),
    createProject: vi.fn(async () => ({ id: "p1", name: "P" })),
    renameProject: vi.fn(async () => undefined),
    setRootProject: vi.fn(async () => undefined),
    createModule: vi.fn(async () => ({ id: "m1", name: "M" })),
    renameModule: vi.fn(async () => undefined),
  } as unknown as MusePanelApi;
}

function write(message: string): void {
  fireEvent.change(screen.getByLabelText("Message to Muse"), { target: { value: message } });
}

function requirementDetail(currentVersionId: string, content: string): RequirementDetail {
  return {
    artifact: {
      id: "req-1",
      projectId: "p1",
      moduleId: "m1",
      kind: "requirement",
      title: null,
      archived: false,
    },
    versions: [
      {
        id: currentVersionId,
        number: 1,
        content,
        provenance: { kind: "person", by: "t" },
        sources: [],
      },
    ],
    approvals: [],
    currentVersionId,
  };
}

function withVersions(fake: MusePanelApi, currentVersionId: string, content: string): void {
  fake.getRequirement = vi.fn(async () => requirementDetail(currentVersionId, content));
  fake.saveVersion = vi.fn(async () => requirementDetail("req-1-v2", content));
}

describe("MusePanel", () => {
  it("needs no choosing: it says how much it reads and asks", async () => {
    const fake = api();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    expect((await screen.findByRole("status")).textContent).toContain("2 of 2");
    expect(screen.queryByRole("checkbox")).toBeNull();
    write("What does it do?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText("It validates.")).toBeTruthy();
    expect(fake.ask).toHaveBeenCalledWith(
      "What does it do?",
      [
        { rootId: "r", rel: "core/f0.ts" },
        { rootId: "r", rel: "core/f1.ts" },
      ],
      [],
    );
    expect(fake.createProject).not.toHaveBeenCalled();
    expect(fake.createRequirement).not.toHaveBeenCalled();
  });

  it("lets the person change the files, and tells Muse what stayed out", async () => {
    const fake = api();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Change files" }));
    fireEvent.click(screen.getByLabelText("core/f1.ts"));
    expect(screen.getByRole("status").textContent).toContain("1 of 2");
    write("Why?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("It validates.");
    expect(fake.ask).toHaveBeenCalledWith(
      "Why?\n\nAlso in this folder, not included: core/f1.ts",
      [{ rootId: "r", rel: "core/f0.ts" }],
      [],
    );
    // The thread and the history keep the person's words only.
    expect(screen.getByText("Why?")).toBeTruthy();
  });

  it("drops a late answer once the thread moved on", async () => {
    let answer: (reply: { answer: string; model: string }) => void = () => {};
    const fake = api();
    fake.ask = vi.fn(
      () =>
        new Promise<{ answer: string; model: string }>((resolve) => {
          answer = resolve;
        }),
    );
    const { rerender } = render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Why?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    rerender(
      <MusePanel
        target={{ rootId: "r", rel: "other", kind: "folder" }}
        roots={[root]}
        onClose={() => {}}
        onPropose={() => {}}
        api={fake}
      />,
    );
    await act(async () => answer({ answer: "Late.", model: "m" }));
    expect(screen.queryByText("Late.")).toBeNull();
  });

  it("saves a requirement, generates once and hands the proposal to the X-ray", async () => {
    const fake = api();
    const onPropose = vi.fn();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    expect(await screen.findByText("Adds the discount.")).toBeTruthy();
    expect(screen.getByText("In-memory stock.")).toBeTruthy();
    expect(screen.getByText("On reserve or on confirm?")).toBeTruthy();
    expect(screen.getByText(/~ shop\/core\/f0\.ts/)).toBeTruthy();
    expect(fake.createRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", moduleId: "m1", content: "Add a total" }),
    );
    expect(fake.generate).toHaveBeenCalledTimes(1);
    expect(fake.generate).toHaveBeenCalledWith({
      projectId: "p1",
      moduleId: "m1",
      source: { kind: "requirement", artifactId: "req-1" },
      scope: [
        { rootId: "r", rel: "core/f0.ts" },
        { rootId: "r", rel: "core/f1.ts" },
      ],
    });
    expect(onPropose).toHaveBeenCalledTimes(1);
    expect(onPropose.mock.calls[0][0]).toMatchObject({ id: "cgen-1" });
    expect(useRequirementsUi.getState().museGeneration?.id).toBe("cgen-1");
    expect(fake.ask).not.toHaveBeenCalled();
  });

  it("turns a question into a thread proposal without rewriting it", async () => {
    const fake = api();
    const onPropose = vi.fn();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a user form");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    fireEvent.click(await screen.findByRole("button", { name: "Propose this as a change" }));
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(fake.createRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ content: "Add a user form" }),
    );
    expect(fake.generate).toHaveBeenCalledWith(
      expect.objectContaining({ source: { kind: "requirement", artifactId: "req-1" } }),
    );
    expect(await screen.findByText("Adds the discount.")).toBeTruthy();
  });

  it("reads up to the limit and locks the rest", async () => {
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={api(10)} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Change files" }));
    const extra = screen.getByLabelText("core/f9.ts") as HTMLInputElement;
    expect(extra.checked).toBe(false);
    expect(extra.disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toContain("8 of 10");
  });

  it("sends nothing from a blocked folder", async () => {
    const fake = api();
    render(
      <MusePanel
        target={target}
        roots={[{ ...root, aiBlocked: true }]}
        onClose={() => {}}
        onPropose={() => {}}
        api={fake}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toContain("never be sent");
    expect(screen.queryByLabelText("Message to Muse")).toBeNull();
    expect(fake.ask).not.toHaveBeenCalled();
  });

  it("sends previous turns as history on the second question", async () => {
    const fake = api();
    vi.mocked(fake.ask).mockImplementation(async (question: string) => ({
      answer: `Answer to ${question}.`,
      model: "m",
    }));
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    const files = [
      { rootId: "r", rel: "core/f0.ts" },
      { rootId: "r", rel: "core/f1.ts" },
    ];
    write("First?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Answer to First?.");
    write("Second?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("Answer to Second?.");
    expect(fake.ask).toHaveBeenCalledTimes(2);
    expect(fake.ask).toHaveBeenNthCalledWith(1, "First?", files, []);
    expect(fake.ask).toHaveBeenNthCalledWith(2, "Second?", files, [
      { question: "First?", answer: "Answer to First?." },
    ]);
  });

  it("retries a failed question from the error row", async () => {
    const fake = api();
    vi.mocked(fake.ask).mockRejectedValueOnce({ kind: "meta_down", message: "Meta is down." });
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Why?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Why?")).toBeTruthy();
    expect(screen.getByText("Meta is down.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("It validates.");
    expect(fake.ask).toHaveBeenCalledTimes(2);
    expect(fake.ask).toHaveBeenNthCalledWith(
      2,
      "Why?",
      [
        { rootId: "r", rel: "core/f0.ts" },
        { rootId: "r", rel: "core/f1.ts" },
      ],
      [],
    );
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("clears the thread on demand and when the target changes", async () => {
    const fake = api();
    const { rerender } = render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Why?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("It validates.");
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(screen.queryByText("Why?")).toBeNull();
    expect(screen.queryByText("It validates.")).toBeNull();
    write("Again?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("It validates.");
    expect(fake.ask).toHaveBeenLastCalledWith(
      "Again?",
      [
        { rootId: "r", rel: "core/f0.ts" },
        { rootId: "r", rel: "core/f1.ts" },
      ],
      [],
    );
    rerender(
      <MusePanel
        target={{ rootId: "r", rel: "other", kind: "folder" }}
        roots={[root]}
        onClose={() => {}}
        onPropose={() => {}}
        api={fake}
      />,
    );
    await waitFor(() => expect(screen.queryByText("Again?")).toBeNull());
    expect(screen.queryByText("It validates.")).toBeNull();
  });

  it("sends with Ctrl+Enter and keeps plain Enter as a new line", async () => {
    const fake = api();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    const box = screen.getByLabelText("Message to Muse");
    fireEvent.change(box, { target: { value: "Why?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(fake.ask).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await screen.findByText("It validates.");
    expect(fake.ask).toHaveBeenCalledTimes(1);
  });

  it("shows progress while the proposal generates", async () => {
    const fake = api();
    let resolveGen!: (value: CodeGenerationDto) => void;
    vi.mocked(fake.generate).mockImplementation(
      () =>
        new Promise<CodeGenerationDto>((resolve) => {
          resolveGen = resolve;
        }),
    );
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    expect(await screen.findByText("Generating proposal…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      resolveGen(generationDto());
    });
    expect(await screen.findByText("Adds the discount.")).toBeTruthy();
    expect(screen.queryByText("Generating proposal…")).toBeNull();
    expect(fake.generate).toHaveBeenCalledTimes(1);
  });

  it("drops a late proposal once the thread moved on", async () => {
    const fake = api();
    let resolveGen!: (value: CodeGenerationDto) => void;
    vi.mocked(fake.generate).mockImplementation(
      () =>
        new Promise<CodeGenerationDto>((resolve) => {
          resolveGen = resolve;
        }),
    );
    const onPropose = vi.fn();
    const { rerender } = render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Generating proposal…");
    rerender(
      <MusePanel
        target={{ rootId: "r", rel: "other", kind: "folder" }}
        roots={[root]}
        onClose={() => {}}
        onPropose={onPropose}
        api={fake}
      />,
    );
    await act(async () => {
      resolveGen(generationDto());
    });
    expect(screen.queryByText("Adds the discount.")).toBeNull();
    expect(onPropose).not.toHaveBeenCalled();
    expect(useRequirementsUi.getState().museGeneration).toBeNull();
  });

  it("re-shows a thread proposal on the X-ray on demand", async () => {
    const fake = api();
    const onPropose = vi.fn();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    expect(onPropose).toHaveBeenCalledTimes(1);
    useRequirementsUi.getState().setMuseGeneration(null);
    fireEvent.click(screen.getByRole("button", { name: "Show on X-ray" }));
    expect(useRequirementsUi.getState().museGeneration?.id).toBe("cgen-1");
    expect(onPropose).toHaveBeenCalledTimes(2);
    expect(onPropose.mock.calls[1][0]).toMatchObject({ id: "cgen-1" });
  });

  async function proposeOnce(fake: MusePanelApi, message = "Add a total") {
    const view = render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write(message);
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByRole("button", { name: "Show on X-ray" });
    return view;
  }

  it("keeps the request in the thread and remembers the proposal", async () => {
    const fake = api();
    await proposeOnce(fake);
    expect(screen.getByText("Add a total")).toBeTruthy();
    write("Why that file?");
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByText("It validates.");
    const history = vi.mocked(fake.ask).mock.calls[0][2] ?? [];
    expect(history).toHaveLength(1);
    expect(history[0].question).toBe("Add a total");
    expect(history[0].answer).toContain("Proposed files: core/f0.ts");
  });

  it("shows on the card a decision taken on the X-ray", async () => {
    await proposeOnce(api());
    const current = useRequirementsUi.getState().museGeneration as CodeGenerationDto;
    expect(screen.getAllByRole("button", { name: "Accept" })[0]).toHaveProperty("disabled", false);
    act(() => {
      useRequirementsUi.getState().setMuseGeneration({
        ...current,
        files: current.files.map((file) => ({ ...file, state: "accepted" as const })),
      });
    });
    expect(screen.getAllByRole("button", { name: "Accept" })[0]).toHaveProperty("disabled", true);
  });

  it("keeps typed answers while hidden", async () => {
    const fake = api();
    const generation = generationDto({ questions: ["Public?"] });
    fake.generate = vi.fn(async () => generation);
    const { rerender } = await proposeOnce(fake);
    fireEvent.change(screen.getByLabelText("Public?"), { target: { value: "Yes" } });
    const props = { target, roots: [root], onClose: () => {}, onPropose: () => {}, api: fake };
    rerender(<MusePanel {...props} hidden />);
    rerender(<MusePanel {...props} />);
    expect((screen.getByLabelText("Public?") as HTMLInputElement).value).toBe("Yes");
  });

  it("holds new adjustments while a saved one waits for Retry", async () => {
    const fake = api();
    await proposeOnce(fake);
    const versionId = generationDto().requirementVersionId;
    Object.assign(fake, {
      getRequirement: vi.fn(async () => ({
        currentVersionId: versionId,
        versions: [{ id: versionId, content: "Base" }],
      })),
      saveVersion: vi.fn(async () => ({})),
      generate: vi.fn(async () => {
        throw { kind: "meta_timeout", message: "Timed out." };
      }),
    });
    write("Add a store");
    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    await screen.findByRole("button", { name: "Retry proposal" });
    write("Another change");
    expect(screen.getByRole("button", { name: "Adjust proposal" })).toHaveProperty("disabled", true);
  });

  it("keeps the thread while hidden and when the same folder is asked again", async () => {
    const fake = api();
    const { rerender } = await proposeOnce(fake);
    const props = { roots: [root], onClose: () => {}, onPropose: () => {}, api: fake };
    rerender(<MusePanel {...props} target={target} hidden />);
    rerender(<MusePanel {...props} target={{ ...target }} />);
    expect(screen.getByRole("button", { name: "Show on X-ray" })).toBeTruthy();
    expect(fake.listDir).toHaveBeenCalledTimes(1);
  });

  it("takes the proposal off the X-ray when the conversation is cleared", async () => {
    await proposeOnce(api());
    expect(useRequirementsUi.getState().museGeneration).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear conversation" }));
    expect(useRequirementsUi.getState().museGeneration).toBeNull();
  });

  it("accepting in the thread updates the turn and reports to the X-ray", async () => {
    const fake = api();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    fireEvent.click(screen.getAllByText("Accept")[0]);
    await waitFor(() => expect(fake.acceptFile).toHaveBeenCalledWith("cgen-1", 0));
    expect(await screen.findByText(/written to disk/)).toBeTruthy();
    expect(useRequirementsUi.getState().museAccepted).toMatchObject({
      rootId: "r",
      rel: "core/f0.ts",
      nonce: 1,
    });
    expect(useRequirementsUi.getState().museGeneration?.files[0].state).toBe("accepted");
    fireEvent.click(screen.getAllByText("Accept")[1]);
    await waitFor(() => expect(fake.acceptFile).toHaveBeenCalledWith("cgen-1", 1));
    expect(useRequirementsUi.getState().museAccepted?.nonce).toBe(2);
  });

  it("answers the newest card's questions as an adjustment", async () => {
    const fake = api();
    withVersions(fake, "req-1-v1", "Add a total");
    vi.mocked(fake.generate)
      .mockResolvedValueOnce(generationDto({ questions: ["First?", "Second?"] }))
      .mockResolvedValue(
        generationDto({ id: "cgen-2", explanation: "Adjusted.", questions: [] }),
      );
    const onPropose = vi.fn();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    fireEvent.change(screen.getByLabelText("Second?"), { target: { value: "On confirm." } });
    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await screen.findByText("Adjusted.");
    expect(fake.generate).toHaveBeenCalledTimes(2);
    expect(fake.generate).toHaveBeenNthCalledWith(2, {
      projectId: "p1",
      moduleId: "m1",
      source: { kind: "requirement", artifactId: "req-1" },
      scope: [{ rootId: "r", rel: "core/f0.ts" }],
      instruction: "Q: Second?\nA: On confirm.",
      previousGenerationId: "cgen-1",
    });
    expect(onPropose).toHaveBeenCalledTimes(1);
    expect(useRequirementsUi.getState().museGeneration?.id).toBe("cgen-2");
  });

  it("stops the adjustment when the requirement moved on", async () => {
    const fake = api();
    withVersions(fake, "req-1-v2", "Changed meanwhile");
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    expect(screen.queryByRole("button", { name: "Propose change" })).toBeNull();
    write("Use doubles.");
    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    await screen.findByText(/changed since this proposal/);
    expect(fake.saveVersion).not.toHaveBeenCalled();
    expect(fake.generate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Replaced by/)).toBeNull();
  });

  it("adjusts with get, save then generate in order", async () => {
    const fake = api();
    withVersions(fake, "req-1-v1", "Add a total");
    vi.mocked(fake.generate)
      .mockResolvedValueOnce(generationDto())
      .mockResolvedValue(
        generationDto({ id: "cgen-2", explanation: "Adjusted.", questions: [] }),
      );
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    write("Use doubles.");
    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    await screen.findByText("Adjusted.");
    expect(fake.getRequirement).toHaveBeenCalledWith("req-1");
    expect(fake.saveVersion).toHaveBeenCalledWith({
      projectId: "p1",
      artifactId: "req-1",
      expectedVersionId: "req-1-v1",
      content: "Add a total\n\nAdjustment: Use doubles.",
      author: "Muse dialog",
    });
    const order = [
      vi.mocked(fake.getRequirement).mock.invocationCallOrder[0],
      vi.mocked(fake.saveVersion).mock.invocationCallOrder[0],
      vi.mocked(fake.generate).mock.invocationCallOrder[1],
    ];
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("keeps older cards read-only after an adjustment", async () => {
    const fake = api();
    withVersions(fake, "req-1-v1", "Add a total");
    vi.mocked(fake.generate)
      .mockResolvedValueOnce(generationDto())
      .mockResolvedValue(
        generationDto({ id: "cgen-2", explanation: "Adjusted.", questions: [] }),
      );
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    write("Use doubles.");
    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    await screen.findByText("Adjusted.");
    expect(screen.getByText("Replaced by cgen-2")).toBeTruthy();
    expect(screen.getAllByText("Accept")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Show on X-ray" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "New proposal" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Send answers" })).toBeNull();
    expect(screen.getByText("On reserve or on confirm?")).toBeTruthy();
    expect(screen.queryByLabelText("On reserve or on confirm?")).toBeNull();
  });

  it("returns Propose change after New proposal", async () => {
    const fake = api();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    expect(screen.queryByRole("button", { name: "Propose change" })).toBeNull();
    expect(screen.getByRole("button", { name: "Adjust proposal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New proposal" }));
    expect(screen.getByRole("button", { name: "Propose change" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Adjust proposal" })).toBeNull();
    expect(useRequirementsUi.getState().museGeneration?.id).toBe("cgen-1");
  });

  it("retries a failed proposal without saving twice", async () => {
    const fake = api();
    vi.mocked(fake.generate)
      .mockRejectedValueOnce({ kind: "meta_down", message: "Meta is down." })
      .mockResolvedValue(generationDto());
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByRole("button", { name: "Retry proposal" });
    expect(screen.getByText("Meta is down.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry proposal" }));
    await screen.findByText("Adds the discount.");
    expect(fake.createRequirement).toHaveBeenCalledTimes(1);
    expect(fake.generate).toHaveBeenCalledTimes(2);
    expect(fake.generate).toHaveBeenNthCalledWith(2, {
      projectId: "p1",
      moduleId: "m1",
      source: { kind: "requirement", artifactId: "req-1" },
      scope: [
        { rootId: "r", rel: "core/f0.ts" },
        { rootId: "r", rel: "core/f1.ts" },
      ],
    });
    expect(screen.queryByRole("button", { name: "Retry proposal" })).toBeNull();
  });

  it("retries a failed adjustment without saving another version", async () => {
    const fake = api();
    withVersions(fake, "req-1-v1", "Add a total");
    let calls = 0;
    vi.mocked(fake.generate).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) throw { kind: "meta_down", message: "Meta is down." };
      return calls === 1
        ? generationDto()
        : generationDto({ id: "cgen-2", explanation: "Adjusted.", questions: [] });
    });
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={() => {}} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await screen.findByText("Adds the discount.");
    write("Use doubles.");
    fireEvent.click(screen.getByRole("button", { name: "Adjust proposal" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry proposal" }));
    await screen.findByText("Adjusted.");
    expect(fake.saveVersion).toHaveBeenCalledTimes(1);
    expect(fake.getRequirement).toHaveBeenCalledTimes(1);
    expect(fake.generate).toHaveBeenCalledTimes(3);
  });
});
