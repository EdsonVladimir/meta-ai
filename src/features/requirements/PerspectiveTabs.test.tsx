// @vitest-environment jsdom
// View tabs: Overview first, design views gated on project+module,
// project-only views gated on the project alone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PerspectiveTabs } from "./PerspectiveTabs";

afterEach(() => cleanup());

describe("PerspectiveTabs", () => {
  it("marks the active view and reports selections", () => {
    const onSelect = vi.fn();
    render(<PerspectiveTabs centerView="overview" ready projectReady onSelect={onSelect} />);
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    expect(tabs.getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tabs.getByRole("tab", { name: "Design" }));
    expect(onSelect).toHaveBeenCalledWith("design");
  });

  it("orders Overview first and Architecture before Traceability", () => {
    render(<PerspectiveTabs centerView="overview" ready projectReady onSelect={() => {}} />);
    const labels = within(screen.getByRole("tablist", { name: "Views" }))
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([
      "Overview",
      "Requirements",
      "Design",
      "Impact",
      "Mockups",
      "Architecture",
      "Traceability",
    ]);
  });

  it("without a project every tab is disabled with a reason", () => {
    render(
      <PerspectiveTabs centerView="overview" ready={false} projectReady={false} onSelect={() => {}} />,
    );
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    for (const name of ["Requirements", "Design", "Impact", "Mockups", "Traceability"]) {
      const tab = tabs.getByRole("tab", { name });
      expect(tab).toHaveProperty("disabled", true);
      expect(tab.getAttribute("title")).toMatch(/project and a module/);
    }
    for (const name of ["Overview", "Architecture"]) {
      const tab = tabs.getByRole("tab", { name });
      expect(tab).toHaveProperty("disabled", true);
      expect(tab.getAttribute("title")).toMatch(/Select a project/);
    }
  });

  it("project-only views need no module", () => {
    const onSelect = vi.fn();
    render(
      <PerspectiveTabs centerView="architecture" ready={false} projectReady onSelect={onSelect} />,
    );
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    expect(tabs.getByRole("tab", { name: "Overview" })).toHaveProperty("disabled", false);
    const architecture = tabs.getByRole("tab", { name: "Architecture" });
    expect(architecture).toHaveProperty("disabled", false);
    expect(architecture.getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByRole("tab", { name: "Design" })).toHaveProperty("disabled", true);
    fireEvent.click(architecture);
    expect(onSelect).toHaveBeenCalledWith("architecture");
  });
});
