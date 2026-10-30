import { describe, expect, it } from "vitest";
import { withDesign, withMockup, withModule, withProject, withRequirement, withScreen } from "./navigation";
import type { Selection } from "./uiStore";

const FULL: Selection = { projectId: "p", moduleId: "m", requirementId: "r", designId: "d", mockupId: "k", screenId: "s" };

describe("contextual navigation", () => {
  it("switching projects clears everything else", () => {
    expect(withProject(FULL, "q")).toEqual({
      projectId: "q",
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
    expect(withProject(FULL, "p")).toBe(FULL);
  });

  it("switching modules clears artifacts but keeps the project", () => {
    expect(withModule(FULL, "p", "n")).toEqual({
      projectId: "p",
      moduleId: "n",
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    });
    expect(withModule(FULL, "p", "m")).toBe(FULL);
  });

  it("picking a requirement in the same module keeps the design", () => {
    expect(withRequirement(FULL, "p", "m", "r2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r2",
      designId: "d",
      mockupId: "k",
      screenId: "s",
    });
  });

  it("picking a requirement from another module clears the incompatible design and mockup", () => {
    expect(withRequirement(FULL, "p", "n", "r2")).toEqual({
      projectId: "p",
      moduleId: "n",
      requirementId: "r2",
      designId: null,
      mockupId: null,
      screenId: null,
    });
  });

  it("picking a design in the same module keeps the requirement", () => {
    expect(withDesign(FULL, "p", "m", "d2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d2",
      mockupId: "k",
      screenId: "s",
    });
  });

  it("picking a design from another module clears the incompatible requirement", () => {
    expect(withDesign(FULL, "q", "n", "d2")).toEqual({
      projectId: "q",
      moduleId: "n",
      requirementId: null,
      designId: "d2",
      mockupId: null,
      screenId: null,
    });
  });

  it("picking a mockup in the same module keeps requirement and design", () => {
    expect(withMockup(FULL, "p", "m", "k2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d",
      mockupId: "k2",
      screenId: null,
    });
  });

  it("picking a mockup from another module clears what is incompatible", () => {
    expect(withMockup(FULL, "q", "n", "k2")).toEqual({
      projectId: "q",
      moduleId: "n",
      requirementId: null,
      designId: null,
      mockupId: "k2",
      screenId: null,
    });
  });

  it("walking requirement → design → mockup keeps the module context", () => {
    // Impact reads its origin from this same selection: switching views
    // never touches requirement, design or mockup while the module stays.
    const start: Selection = {
      projectId: "p",
      moduleId: "m",
      requirementId: null,
      designId: null,
      mockupId: null,
      screenId: null,
    };
    const chain = withMockup(
      withDesign(withRequirement(start, "p", "m", "r"), "p", "m", "d"),
      "p",
      "m",
      "k",
    );
    expect(chain).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d",
      mockupId: "k",
      screenId: null,
    });
  });

  it("picking a screen pins the mockup and screen of the same module", () => {
    expect(withScreen(FULL, "p", "m", "k", "s2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d",
      mockupId: "k",
      screenId: "s2",
    });
    expect(withScreen(FULL, "q", "n", "k", "s2").requirementId).toBeNull();
  });

  it("repeating the same mockup keeps its screen; another one clears it", () => {
    expect(withMockup(FULL, "p", "m", "k").screenId).toBe("s");
    expect(withMockup(FULL, "p", "m", "k2").screenId).toBeNull();
  });
});
