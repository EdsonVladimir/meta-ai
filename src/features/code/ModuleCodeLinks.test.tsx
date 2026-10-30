// @vitest-environment jsdom
// Manual module↔code links: list, create from the active tab, open,
// unlink with confirmation and respect for archived ones. The backend
// is an injected double; the active tab lives in the store.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ModuleCodeLinks, type ModuleLinksApi } from "./ModuleCodeLinks";
import { useRequirementsUi } from "../requirements/uiStore";
import type { CodeLinkDto } from "./types";

afterEach(() => {
  cleanup();
  useRequirementsUi.getState().setCodeActiveFile(null);
  vi.restoreAllMocks();
});

beforeEach(() => {
  useRequirementsUi
    .getState()
    .setCodeActiveFile({ rootId: "root-1", rootName: "frontend", rel: "src/app.ts" });
});

function link(overrides: Partial<CodeLinkDto> = {}): CodeLinkDto {
  return {
    id: "link-1",
    scope: "module",
    ownerId: "mod-1",
    rootId: "root-1",
    rootName: "frontend",
    rootMissing: false,
    rel: "src/app.ts",
    symbol: null,
    kind: "manual",
    createdAt: "2026-01-01",
    ...overrides,
  };
}

function api(overrides: Partial<ModuleLinksApi> = {}): ModuleLinksApi {
  return {
    listModuleLinks: vi.fn(async () => []),
    addModuleLink: vi.fn(async (_m, _r, _p) => link({})),
    removeCodeLink: vi.fn(async (id) => id),
    ...overrides,
  };
}

describe("ModuleCodeLinks", () => {
  it("lists the links with their scope and the missing folder", async () => {
    const backend = api({
      listModuleLinks: vi.fn(async () => [
        link({ id: "link-1", rel: "src/app.ts" }),
        link({ id: "link-2", rel: "old", rootMissing: true, rootName: null }),
      ]),
    });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName="Ventas" archived={false} api={backend} />);
    expect(await within(await screen.findByRole("list")).findByText(/src\/app\.ts/)).toBeDefined();
    expect(within(await screen.findByRole("list")).getByText(/\/old/)).toBeDefined();
    expect(screen.getByText(/missing folder/)).toBeDefined();
    expect(backend.listModuleLinks).toHaveBeenCalledWith("mod-1");
  });

  it("links the active tab and shows it without reloading", async () => {
    const backend = api({ listModuleLinks: vi.fn(async () => []) });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />);
    expect(await screen.findByText(/No links/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Link frontend\/src\/app\.ts/ }));
    await waitFor(() =>
      expect(backend.addModuleLink).toHaveBeenCalledWith("mod-1", "root-1", "src/app.ts"),
    );
    expect(await within(await screen.findByRole("list")).findByText(/src\/app\.ts/)).toBeDefined();
  });

  it("a duplicate shows as an error and does not duplicate the row", async () => {
    const backend = api({
      listModuleLinks: vi.fn(async () => []),
      addModuleLink: vi.fn(async () => {
        throw { kind: "code_link_duplicate", message: "That link already exists" };
      }),
    });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />);
    expect(await screen.findByText(/No links/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Link frontend/ }));
    expect(await screen.findByText("That link already exists")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("archived browses only: link and unlink disabled", async () => {
    const backend = api({ listModuleLinks: vi.fn(async () => [link({})]) });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived api={backend} />);
    expect(await within(await screen.findByRole("list")).findByText(/src\/app\.ts/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Link frontend/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: "Unlink" })).toHaveProperty("disabled", true);
  });

  it("without an active tab the button explains what to do", async () => {
    useRequirementsUi.getState().setCodeActiveFile(null);
    const backend = api({ listModuleLinks: vi.fn(async () => []) });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />);
    expect(await screen.findByText(/No links/)).toBeDefined();
    const button = screen.getByRole("button", { name: "Link active tab" });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toMatch(/Open a file/);
  });

  it("unlinking asks for confirmation and removes the row", async () => {
    const backend = api({ listModuleLinks: vi.fn(async () => [link({})]) });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />);
    expect(await within(await screen.findByRole("list")).findByText(/src\/app\.ts/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Unlink" }));
    expect(backend.removeCodeLink).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(backend.removeCodeLink).toHaveBeenCalledWith("link-1"));
    await waitFor(() => expect(screen.queryByText(/No links/)).not.toBeNull());
  });

  it("opening publishes a code request without touching the link", async () => {
    const backend = api({ listModuleLinks: vi.fn(async () => [link({})]) });
    render(<ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />);
    expect(await within(await screen.findByRole("list")).findByText(/src\/app\.ts/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const request = useRequirementsUi.getState().codeOpenRequest;
    expect(request).toMatchObject({ rootId: "root-1", rel: "src/app.ts" });
    expect(backend.removeCodeLink).not.toHaveBeenCalled();
  });

  it("a late response does not overwrite the current module links", async () => {
    let resolveFirst!: (value: CodeLinkDto[]) => void;
    const first = new Promise<CodeLinkDto[]>((resolve) => {
      resolveFirst = resolve;
    });
    const backend = api({
      listModuleLinks: vi.fn(async (moduleId: string) =>
        moduleId === "mod-1" ? first : [link({ id: "link-2", ownerId: "mod-2", rel: "other.ts" })],
      ),
    });
    const view = render(
      <ModuleCodeLinks moduleId="mod-1" moduleName={null} archived={false} api={backend} />,
    );
    view.rerender(
      <ModuleCodeLinks moduleId="mod-2" moduleName={null} archived={false} api={backend} />,
    );
    expect(await screen.findByText(/other\.ts/)).toBeDefined();
    resolveFirst([link({ id: "link-1", ownerId: "mod-1", rel: "old.ts" })]);
    await waitFor(() => expect(backend.listModuleLinks).toHaveBeenCalledTimes(2));
    // Gives the late promise a breath and confirms it painted nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/old\.ts/)).toBeNull();
    expect(screen.getByText(/other\.ts/)).toBeDefined();
  });
});
