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
    onRetryRecents: vi.fn(),
  };
  render(
    <WelcomeScreen
      recents={[]}
      recentsLoading={false}
      recentsError={null}
      busy={false}
      busyRecentId={null}
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
});
