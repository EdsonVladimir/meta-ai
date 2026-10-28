import { describe, expect, it } from "vitest";
import { withDesign, withMockup, withModule, withProject, withRequirement } from "./navigation";
import type { Selection } from "./uiStore";

const FULL: Selection = { projectId: "p", moduleId: "m", requirementId: "r", designId: "d", mockupId: "k" };

describe("navegación contextual", () => {
  it("cambiar de proyecto limpia todo lo demás", () => {
    expect(withProject(FULL, "q")).toEqual({
      projectId: "q",
      moduleId: null,
      requirementId: null,
      designId: null,
      mockupId: null,
    });
    expect(withProject(FULL, "p")).toBe(FULL);
  });

  it("cambiar de módulo limpia artefactos pero conserva proyecto", () => {
    expect(withModule(FULL, "p", "n")).toEqual({
      projectId: "p",
      moduleId: "n",
      requirementId: null,
      designId: null,
      mockupId: null,
    });
    expect(withModule(FULL, "p", "m")).toBe(FULL);
  });

  it("elegir requisito en el mismo módulo conserva el diseño", () => {
    expect(withRequirement(FULL, "p", "m", "r2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r2",
      designId: "d",
      mockupId: "k",
    });
  });

  it("elegir requisito de otro módulo limpia el diseño y mockup incompatibles", () => {
    expect(withRequirement(FULL, "p", "n", "r2")).toEqual({
      projectId: "p",
      moduleId: "n",
      requirementId: "r2",
      designId: null,
      mockupId: null,
    });
  });

  it("elegir diseño en el mismo módulo conserva el requisito", () => {
    expect(withDesign(FULL, "p", "m", "d2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d2",
      mockupId: "k",
    });
  });

  it("elegir diseño de otro módulo limpia el requisito incompatible", () => {
    expect(withDesign(FULL, "q", "n", "d2")).toEqual({
      projectId: "q",
      moduleId: "n",
      requirementId: null,
      designId: "d2",
      mockupId: null,
    });
  });

  it("elegir mockup en el mismo módulo conserva requisito y diseño", () => {
    expect(withMockup(FULL, "p", "m", "k2")).toEqual({
      projectId: "p",
      moduleId: "m",
      requirementId: "r",
      designId: "d",
      mockupId: "k2",
    });
  });

  it("elegir mockup de otro módulo limpia lo incompatible", () => {
    expect(withMockup(FULL, "q", "n", "k2")).toEqual({
      projectId: "q",
      moduleId: "n",
      requirementId: null,
      designId: null,
      mockupId: "k2",
    });
  });

  it("recorrer requisito → diseño → mockup conserva el contexto del módulo", () => {
    // Impacto lee el origen de esta misma selección: cambiar de vista no
    // toca requisito, diseño ni mockup mientras el módulo no cambie.
    const start: Selection = {
      projectId: "p",
      moduleId: "m",
      requirementId: null,
      designId: null,
      mockupId: null,
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
    });
  });
});
