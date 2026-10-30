// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach } from "vitest";
import { CodeBreadcrumbs, crumbsForRel } from "./CodeBreadcrumbs";

afterEach(() => cleanup());

describe("breadcrumbs", () => {
  it("splits root, folders and file", () => {
    expect(crumbsForRel("frontend", "src/app/main.ts")).toEqual({
      root: "frontend",
      dirs: [
        { label: "src", rel: "src" },
        { label: "app", rel: "src/app" },
      ],
      file: "main.ts",
    });
  });

  it("reveals folders in the tree without switching files", () => {
    const onRevealDir = vi.fn();
    render(
      <CodeBreadcrumbs
        rootId="root-1"
        rootName="frontend"
        rel="src/app/main.ts"
        onRevealDir={onRevealDir}
      />,
    );
    expect(screen.getByText("frontend")).toBeDefined();
    expect(screen.getByText("main.ts")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show src/app in the tree" }));
    expect(onRevealDir).toHaveBeenCalledWith("root-1", "src/app");
  });

  it("marks the segment matching the active project", () => {
    render(
      <CodeBreadcrumbs
        rootId="root-1"
        rootName="frontend"
        rel="src/app/main.ts"
        onRevealDir={() => {}}
        activeProjectRel="src/app"
      />,
    );
    const marked = screen.getByRole("button", {
      name: "Show src/app in the tree (active project)",
    });
    expect(marked.className).toMatch(/code-crumb-active/);
  });
});
