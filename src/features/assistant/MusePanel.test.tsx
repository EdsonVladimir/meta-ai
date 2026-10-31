// @vitest-environment jsdom
// Muse dialog: what goes out is chosen, blocked folders send nothing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(fake.ask).toHaveBeenCalledWith("What does it do?", [
      { rootId: "r", rel: "core/f0.ts" },
      { rootId: "r", rel: "core/f1.ts" },
    ]);
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
    );
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
});
