// @vitest-environment jsdom
// Overview: roots, detected stacks, analysis state, scan controls.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OverviewView } from "./OverviewView";
import { clearAnalysisSummaries, publishAnalysisSummary } from "./analysisCache";
import type { ManifestDeps } from "./manifestScan";
import type { CodeRootDto } from "../code/types";

afterEach(() => {
  cleanup();
  clearAnalysisSummaries();
});

function root(overrides: Partial<CodeRootDto> & { id: string }): CodeRootDto {
  return {
    path: `/repo/${overrides.id}`,
    name: overrides.id,
    missing: false,
    projectId: "proy-1",
    ...overrides,
  };
}

const DEPS: ManifestDeps = {
  listDir: async (_root, rel) =>
    rel === ""
      ? {
          entries: [{ name: "package.json", rel: "package.json", kind: "file", size: 10 }],
          truncated: false,
        }
      : { entries: [], truncated: false },
  readFile: async () => ({ text: JSON.stringify({ dependencies: { "@angular/core": "1" } }) }),
};

describe("OverviewView", () => {
  it("shows roots with detected stacks and analysis state", async () => {
    publishAnalysisSummary({ rootId: "fe", scopeRel: "", scopeName: "frontend", files: 40, edges: 12, truncated: true, at: 1000 });
    const onOpenArchitecture = vi.fn();
    render(
      <OverviewView
        projectId="proy-1"
        projectName="Shop"
        roots={[root({ id: "fe", name: "frontend" }), root({ id: "x", projectId: "other" })]}
        onOpenArchitecture={onOpenArchitecture}
        onAddFolder={() => {}}
        scanDeps={DEPS}
      />,
    );
    expect(screen.getByRole("heading", { name: "Shop" })).toBeTruthy();
    expect(await screen.findByText(/Angular · TypeScript/)).toBeTruthy();
    expect(screen.getByText(/frontend · 40 files · 12 edges · partial/)).toBeTruthy();
    expect(screen.queryByText("x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open Architecture" }));
    expect(onOpenArchitecture).toHaveBeenCalledTimes(1);
  });

  it("guides without folders and reports missing roots", async () => {
    const { rerender } = render(
      <OverviewView
        projectId="proy-1"
        projectName="Shop"
        roots={[]}
        onOpenArchitecture={() => {}}
        onAddFolder={() => {}}
        scanDeps={DEPS}
      />,
    );
    expect(screen.getByText(/No folders associated yet/)).toBeTruthy();

    rerender(
      <OverviewView
        projectId="proy-1"
        projectName="Shop"
        roots={[root({ id: "gone", missing: true })]}
        onOpenArchitecture={() => {}}
        onAddFolder={() => {}}
        scanDeps={DEPS}
      />,
    );
    expect(await screen.findByText(/Missing — relocate/)).toBeTruthy();
  });

  it("cancels detection and allows re-running it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const gated: ManifestDeps = {
      listDir: async () => {
        await gate;
        return { entries: [], truncated: false };
      },
      readFile: async () => ({ text: "{}" }),
    };
    render(
      <OverviewView
        projectId="proy-1"
        projectName="Shop"
        roots={[root({ id: "fe" })]}
        onOpenArchitecture={() => {}}
        onAddFolder={() => {}}
        scanDeps={gated}
      />,
    );
    expect(screen.getByRole("button", { name: "Cancel detection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel detection" }));
    release();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Re-detect stacks" })).toBeTruthy(),
    );
  });
});
