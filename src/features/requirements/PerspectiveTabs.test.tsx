// @vitest-environment jsdom
// View tabs: Architecture first, design views gated on project+module,
// Architecture gated on the project alone (a module-less project
// still reaches its maps).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PerspectiveTabs } from "./PerspectiveTabs";

afterEach(() => cleanup());

describe("PerspectiveTabs", () => {
  it("marks the active view and reports selections", () => {
    const onSelect = vi.fn();
    render(<PerspectiveTabs centerView="architecture" ready projectReady onSelect={onSelect} />);
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    expect(tabs.getByRole("tab", { name: "Architecture" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(tabs.getByRole("tab", { name: "Design" }).getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tabs.getByRole("tab", { name: "Design" }));
    expect(onSelect).toHaveBeenCalledWith("design");
  });

  it("orders Architecture first and before Traceability, with no Overview", () => {
    render(<PerspectiveTabs centerView="architecture" ready projectReady onSelect={() => {}} />);
    const labels = within(screen.getByRole("tablist", { name: "Views" }))
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([
      "Architecture",
      "Requirements",
      "Design",
      "Impact",
      "Mockups",
      "Traceability",
    ]);
  });

  it("without a project every tab is disabled with a reason", () => {
    render(
      <PerspectiveTabs centerView="architecture" ready={false} projectReady={false} onSelect={() => {}} />,
    );
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    for (const name of ["Requirements", "Design", "Impact", "Mockups", "Traceability"]) {
      const tab = tabs.getByRole("tab", { name });
      expect(tab).toHaveProperty("disabled", true);
      expect(tab.getAttribute("title")).toMatch(/project and a module/);
    }
    const architecture = tabs.getByRole("tab", { name: "Architecture" });
    expect(architecture).toHaveProperty("disabled", true);
    expect(architecture.getAttribute("title")).toMatch(/Select a project/);
  });

  it("Architecture needs a project but no module", () => {
    const onSelect = vi.fn();
    render(
      <PerspectiveTabs centerView="architecture" ready={false} projectReady onSelect={onSelect} />,
    );
    const tabs = within(screen.getByRole("tablist", { name: "Views" }));
    const architecture = tabs.getByRole("tab", { name: "Architecture" });
    expect(architecture).toHaveProperty("disabled", false);
    expect(architecture.getAttribute("aria-selected")).toBe("true");
    expect(tabs.getByRole("tab", { name: "Design" })).toHaveProperty("disabled", true);
    fireEvent.click(architecture);
    expect(onSelect).toHaveBeenCalledWith("architecture");
  });
});
