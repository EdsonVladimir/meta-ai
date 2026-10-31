// @vitest-environment jsdom
// Muse dialog: what goes out is chosen, blocked folders send nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CodeRootDto } from "../code/types";
import { MusePanel, type MusePanelApi } from "./MusePanel";

afterEach(() => cleanup());

const root: CodeRootDto = {
  id: "r",
  path: "/shop",
  name: "shop",
  missing: false,
  projectId: null,
  aiBlocked: false,
};
const target = { rootId: "r", rel: "core", kind: "folder" as const };

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

  it("saves a requirement and hands it to the proposal flow", async () => {
    const fake = api();
    const onPropose = vi.fn();
    render(
      <MusePanel target={target} roots={[root]} onClose={() => {}} onPropose={onPropose} api={fake} />,
    );
    await screen.findByRole("status");
    write("Add a total");
    fireEvent.click(screen.getByRole("button", { name: "Propose change" }));
    await waitFor(() => expect(onPropose).toHaveBeenCalledTimes(1));
    expect(fake.createRequirement).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1", moduleId: "m1", content: "Add a total" }),
    );
    expect(onPropose.mock.calls[0][0]).toMatchObject({ requirementId: "req-1" });
    expect(fake.ask).not.toHaveBeenCalled();
  });

  it("turns a question into a change without rewriting it", async () => {
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
});
