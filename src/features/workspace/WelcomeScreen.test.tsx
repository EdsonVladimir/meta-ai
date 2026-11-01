// @vitest-environment jsdom
// Welcome screen: entries, recents states, honest errors.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WelcomeScreen } from "./WelcomeScreen";
import type { RecentWorkspaceDto } from "./types";

afterEach(() => cleanup());

function recent(overrides: Partial<RecentWorkspaceDto> = {}): RecentWorkspaceDto {
  return {
    id: "ws-1",
    label: "Shop",
    projectId: "proy-1",
    rootPaths: ["/repo/shop"],
    missingPaths: [],
    lastOpened: "2026-10-29T10:00:00Z",
    createdAt: "2026-10-28T10:00:00Z",
    ...overrides,
  };
}

function renderWelcome(overrides: Partial<Parameters<typeof WelcomeScreen>[0]> = {}) {
  const handlers = {
    onOpenProject: vi.fn(),
    onOpenRecent: vi.fn(),
    onRemoveRecent: vi.fn(),
    onNewProject: vi.fn(),
    onOpenProjectById: vi.fn(),
    onRetryRecents: vi.fn(),
    onRetryProjects: vi.fn(),
  };
  render(
    <WelcomeScreen
      recents={[]}
      recentsLoading={false}
      recentsError={null}
      projects={[]}
      projectsLoading={false}
      projectsError={null}
      busy={false}
      busyRecentId={null}
      busyProjectId={null}
      error={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("WelcomeScreen", () => {
  it("offers open and new project entries", () => {
    const handlers = renderWelcome();
    fireEvent.click(screen.getByRole("button", { name: "Open project" }));
    expect(handlers.onOpenProject).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(handlers.onNewProject).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/No saved workspaces yet/)).toBeTruthy();
  });

  it("disables entries while busy and shows errors", () => {
    renderWelcome({ busy: true, error: "Cannot reach the database." });
    expect(screen.getByRole("button", { name: "Open project" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Cannot reach the database.")).toBeTruthy();
  });

  it("lists recents with missing badges and forget actions", () => {
    const handlers = renderWelcome({
      recents: [
        recent(),
        recent({ id: "ws-2", label: "Gone", rootPaths: ["/repo/gone"], missingPaths: ["/repo/gone"] }),
      ],
    });
    expect(screen.getByText("1 missing")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Forget Gone/ }));
    expect(handlers.onRemoveRecent).toHaveBeenCalledWith("ws-2");
  });

  it("retries recents after a load error", () => {
    const handlers = renderWelcome({ recentsError: "Database locked." });
    expect(screen.getByText("Database locked.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(handlers.onRetryRecents).toHaveBeenCalledTimes(1);
  });

  it("lists every stored project even with no recents entry", () => {
    const handlers = renderWelcome({
      projects: [
        { id: "proy-1", name: "Shop" },
        { id: "proy-2", name: "Blog" },
      ],
    });
    expect(screen.getByText("All projects")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Shop/ }));
    expect(handlers.onOpenProjectById).toHaveBeenCalledWith("proy-1");
    expect(handlers.onOpenRecent).not.toHaveBeenCalled();
  });

  it("disables the project list while one opens", () => {
    renderWelcome({
      projects: [{ id: "proy-1", name: "Shop" }],
      busyProjectId: "proy-1",
    });
    expect(screen.getByRole("button", { name: /Shop/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("Opening…")).toBeTruthy();
  });

  it("retries the project list after a load error", () => {
    const handlers = renderWelcome({ projectsError: "Database locked." });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(handlers.onRetryProjects).toHaveBeenCalledTimes(1);
  });
});
