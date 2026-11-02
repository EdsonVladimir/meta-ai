// @vitest-environment jsdom
// Project context dialog: map preview, doc checklist with sizes,
// totals against the limits, the Meta warning, enable and switch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { clearDiscoveryCache } from "../code/detectProjects";
import type { CodeEntryDto, CodeRootDto } from "../code/types";
import { MuseContextDialog } from "./MuseContextDialog";
import { clearMapSummaries, publishMapSection } from "./mapSummary";

beforeEach(() => {
  clearMapSummaries();
  clearDiscoveryCache();
});

afterEach(() => {
  cleanup();
  clearMapSummaries();
  clearDiscoveryCache();
});

const root: CodeRootDto = {
  id: "r",
  path: "/shop",
  name: "shop",
  missing: false,
  projectId: "p1",
  aiBlocked: false,
};

function file(name: string, rel: string, size: number | null = 100): CodeEntryDto {
  return { name, rel, kind: "file", size };
}

function dir(name: string, rel: string): CodeEntryDto {
  return { name, rel, kind: "dir", size: null };
}

function api() {
  const docs = Array.from({ length: 10 }, (_, i) => file(`g${i}.md`, `docs/g${i}.md`, 200));
  return {
    listDir: vi.fn(async (_rootId: string, rel: string) => {
      if (rel === "") {
        return {
          entries: [file("AGENTS.md", "AGENTS.md", 150), file("README.md", "README.md"), dir("docs", "docs")],
          truncated: false,
        };
      }
      if (rel === "docs") return { entries: docs, truncated: false };
      return { entries: [], truncated: false };
    }),
    readFile: vi.fn(async () => {
      throw { kind: "code_not_found", message: "missing" };
    }),
  };
}

function publishShopMap(): void {
  publishMapSection({
    key: "r::",
    rootId: "r",
    rootName: "shop",
    title: "shop",
    rel: "",
    kind: "implicit",
    filesAnalyzed: 3,
    partial: false,
    layers: [{ layer: "services", symbols: 2 }],
    routes: [{ path: "/sales", component: "SalesPage" }],
    classes: [{ name: "SalesService", members: 4 }],
  });
}

describe("MuseContextDialog", () => {
  it("shows the map behind a toggle and the doc checklist with sizes", async () => {
    publishShopMap();
    render(<MuseContextDialog roots={[root]} choice={null} api={api()} onSave={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Map: 1 section/)).toBeTruthy();
    expect(screen.queryByText(/Analyzed services/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show map" }));
    expect(screen.getByText(/Analyzed services \(1\): shop/)).toBeTruthy();
    const list = await screen.findByRole("list", { name: "Context docs" });
    const items = within(list).getAllByRole("checkbox");
    expect(items).toHaveLength(12);
    expect(list.textContent).toContain("AGENTS.md");
    expect(list.textContent).toContain("150 B");
    expect(list.textContent).toContain("200 B");
  });

  it("checks the first 8 by default and shows the totals and warning", async () => {
    render(<MuseContextDialog roots={[root]} choice={null} api={api()} onSave={() => {}} onClose={() => {}} />);
    const list = await screen.findByRole("list", { name: "Context docs" });
    await waitFor(() => {
      const checked = within(list).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
      expect(checked).toHaveLength(8);
    });
    expect(screen.getByText(/Docs 8 chosen · 8 of 8 sent/)).toBeTruthy();
    for (const box of within(list).getAllByRole("checkbox")) {
      if (!(box as HTMLInputElement).checked) fireEvent.click(box);
    }
    expect(screen.getByText(/Docs 12 chosen · 8 of 8 sent \(limit\)/)).toBeTruthy();
    expect(screen.getByText(/Map 0 of 6,000 chars/)).toBeTruthy();
    expect(screen.getByText("Chosen files go to Meta as they are. Nothing is sent until you send a message.")).toBeTruthy();
  });

  it("restores the stored checks and saves the choice", async () => {
    const onSave = vi.fn();
    render(
      <MuseContextDialog
        roots={[root]}
        choice={{ enabled: true, dismissed: false, docs: [{ rootId: "r", rel: "docs/g3.md" }] }}
        api={api()}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    const list = await screen.findByRole("list", { name: "Context docs" });
    await waitFor(() => {
      const checked = within(list)
        .getAllByRole("checkbox")
        .filter((box) => (box as HTMLInputElement).checked);
      expect(checked).toHaveLength(1);
    });
    const boxes = within(list).getAllByRole("checkbox");
    fireEvent.click(boxes[0]);
    fireEvent.click(screen.getByRole("button", { name: "Use this context" }));
    expect(onSave).toHaveBeenCalledWith({
      enabled: true,
      dismissed: false,
      docs: [
        { rootId: "r", rel: "AGENTS.md" },
        { rootId: "r", rel: "docs/g3.md" },
      ],
    });
  });

  it("turns off with the switch without closing", async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <MuseContextDialog
        roots={[root]}
        choice={{ enabled: true, dismissed: false, docs: [] }}
        api={api()}
        onSave={onSave}
        onClose={onClose}
      />,
    );
    await screen.findByRole("list", { name: "Context docs" });
    const flip = screen.getByRole("switch");
    expect(flip.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(flip);
    expect(onSave).toHaveBeenCalledWith({ enabled: false, dismissed: true, docs: expect.any(Array) });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  });

  it("skips blocked roots when scanning", async () => {
    const blocked = { ...root, id: "b", aiBlocked: true };
    const listing = api();
    render(
      <MuseContextDialog roots={[blocked]} choice={null} api={listing} onSave={() => {}} onClose={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText("No docs found in this project.")).toBeTruthy());
    expect(listing.listDir).not.toHaveBeenCalled();
  });
});
