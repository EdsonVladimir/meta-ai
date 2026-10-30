// @vitest-environment jsdom
// "Replicate structure as modules" dialog: folder preview, editable
// base, new/existing target, atomic confirmation and summarized
// result. Injected API, no backend.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReplicateDialog, type ReplicateApi } from "./ReplicateDialog";
import type {
  CodeRootDto,
  ReplicatePreviewDto,
  ReplicateResultDto,
} from "./types";
import type { ProjectDto } from "../requirements/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROOT: CodeRootDto = {
  id: "root-1",
  path: "/tmp/fe",
  name: "frontend",
  missing: false,
  projectId: null,
};

function preview(overrides: Partial<ReplicatePreviewDto> = {}): ReplicatePreviewDto {
  return {
    rootId: ROOT.id,
    base: "src/app",
    suggested: true,
    reason: "src/app exists with subdirectories.",
    entries: [
      { name: "sales", rel: "sales", linkedModule: null },
      { name: "shared", rel: "shared", linkedModule: null },
      { name: "old", rel: "old", linkedModule: "Old" },
    ],
    excluded: [".hidden", "build"],
    truncated: false,
    overCap: false,
    ...overrides,
  };
}

const PROJECTS: ProjectDto[] = [
  { id: "p1", name: "Store" },
  { id: "p2", name: "Blog" },
];

function result(overrides: Partial<ReplicateResultDto> = {}): ReplicateResultDto {
  return {
    projectId: "p-new",
    projectName: "frontend",
    projectCreated: true,
    modules: [
      { moduleId: "m1", name: "sales", rel: "sales" },
      { moduleId: "m2", name: "shared", rel: "shared" },
    ],
    alreadyLinked: ["old"],
    root: { ...ROOT, projectId: "p-new" },
    ...overrides,
  };
}

function renderDialog(api: Partial<ReplicateApi> & { preview: ReplicateApi["preview"] }) {
  const full: ReplicateApi = {
    listProjects: () => Promise.resolve(PROJECTS),
    execute: () => Promise.resolve(result()),
    ...api,
  };
  const onClose = vi.fn();
  const onDone = vi.fn();
  render(<ReplicateDialog root={ROOT} api={full} onClose={onClose} onDone={onDone} />);
  return { full, onClose, onDone };
}

describe("ReplicateDialog", () => {
  it("previews checked free folders and the linked one with a badge", async () => {
    renderDialog({ preview: () => Promise.resolve(preview()) });
    expect(await screen.findByText(/Suggested:/)).toBeTruthy();
    // Las libres arrancan marcadas; la vinculada, no.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
    expect(screen.getByText("Old")).toBeTruthy();
    expect(screen.getByText(/Excluded by policy/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
  });

  it("allows changing the base and reloading the preview", async () => {
    const seen: Array<string | undefined> = [];
    renderDialog({
      preview: (_root, base) => {
        seen.push(base);
        return Promise.resolve(preview({ base: base ?? "src/app", suggested: base === undefined }));
      },
    });
    expect(await screen.findByText(/Suggested:/)).toBeTruthy();
    const input = screen.getByLabelText("Base") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "src" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    expect(await screen.findByText(/Chosen:/)).toBeTruthy();
    expect(seen).toEqual([undefined, "src"]);
  });

  it("without src suggests the root and \"Use the root\" reloads with an empty base", async () => {
    const seen: Array<string | undefined> = [];
    renderDialog({
      preview: (_root, base) => {
        seen.push(base);
        return Promise.resolve(
          preview({
            base: base ?? "",
            suggested: base === undefined,
            reason: "No src: each child folder of the root is a service or package.",
            entries: [
              { name: "me-of-api-gateway", rel: "me-of-api-gateway", linkedModule: null },
              { name: "me-of-be-person", rel: "me-of-be-person", linkedModule: null },
            ],
            excluded: [],
          }),
        );
      },
    });
    expect(await screen.findByText(/Suggested \(root\):/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the root" }));
    expect(await screen.findByText(/Chosen \(root\):/)).toBeTruthy();
    expect(seen).toEqual([undefined, ""]);
  });

  it("without child folders informs and blocks confirmation", async () => {
    renderDialog({ preview: () => Promise.resolve(preview({ entries: [] })) });
    expect(await screen.findByText(/nothing to replicate/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Replicate 0 modules/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("read error with a retry that creates nothing", async () => {
    const execute = vi.fn();
    let fails = true;
    renderDialog({
      execute,
      preview: () =>
        fails
          ? Promise.reject(new Error("disk full"))
          : Promise.resolve(preview()),
    });
    expect(await screen.findByText(/Could not read the structure/)).toBeTruthy();
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/Suggested:/)).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("confirms to a new project and summarizes modules and linked ones", async () => {
    const execute = vi.fn((_input: unknown) => Promise.resolve(result()));
    const { onClose, onDone } = renderDialog({
      preview: () => Promise.resolve(preview()),
      execute: execute as ReplicateApi["execute"],
    });
    expect(await screen.findByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe("frontend");
    fireEvent.change(name, { target: { value: "New store" } });
    fireEvent.click(screen.getByRole("button", { name: /Replicate 2 modules/ }));
    expect(await screen.findByText("Replica created")).toBeTruthy();
    expect(screen.getByText(/Already linked: old/)).toBeTruthy();
    expect(execute).toHaveBeenCalledTimes(1);
    const sent = execute.mock.calls[0][0] as {
      rootId: string;
      base: string;
      rels: string[];
      target: { kind: string; name: string };
    };
    expect(sent).toEqual({
      rootId: "root-1",
      base: "src/app",
      rels: ["sales", "shared"],
      target: { kind: "new", name: "New store" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open in Requirements" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("confirms to an existing project picked in the selector", async () => {
    const execute = vi.fn((_input: unknown) =>
      Promise.resolve(result({ projectId: "p1", projectName: "Store", projectCreated: false })),
    );
    renderDialog({
      preview: () => Promise.resolve(preview()),
      execute: execute as ReplicateApi["execute"],
    });
    expect(await screen.findByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Existing project"));
    // Without picking a project one cannot confirm.
    expect(
      (screen.getByRole("button", { name: /Replicate 2 modules/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Project"), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: /Replicate 2 modules/ }));
    expect(await screen.findByText("Replica created")).toBeTruthy();
    const sent = execute.mock.calls[0][0] as { target: { kind: string; projectId: string } };
    expect(sent.target).toEqual({ kind: "existing", projectId: "p1" });
  });

  it("an execute error keeps the dialog without a result", async () => {
    const execute = vi.fn(() => Promise.reject(new Error("root taken by another project")));
    renderDialog({
      preview: () => Promise.resolve(preview()),
      execute: execute as ReplicateApi["execute"],
    });
    expect(await screen.findByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Replicate 2 modules/ }));
    expect(await screen.findByText(/Could not replicate/)).toBeTruthy();
    expect(screen.queryByText("Replica created")).toBeNull();
    // The dialog stays open and allows retrying or cancelling.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("more than 50 checked blocks with an honest warning", async () => {
    const entries = Array.from({ length: 51 }, (_, i) => ({
      name: `m${i}`,
      rel: `m${i}`,
      linkedModule: null as string | null,
    }));
    // Checked by default: being free, all 51 start checked.
    renderDialog({
      preview: () => Promise.resolve(preview({ entries, overCap: true })),
    });
    expect(await screen.findByText(/uncheck down to 50/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Replicate 51 modules/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    // Al desmarcar una, se habilita.
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]);
    expect(
      (screen.getByRole("button", { name: /Replicate 50 modules/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("cancel closes without running", async () => {
    const execute = vi.fn();
    const { onClose } = renderDialog({
      preview: () => Promise.resolve(preview()),
      execute,
    });
    expect(await screen.findByRole("button", { name: /Replicate 2 modules/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
