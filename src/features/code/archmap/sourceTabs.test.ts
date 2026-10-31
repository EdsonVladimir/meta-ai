// Tabs behind a card: source, template and styles, honest about gaps.
import { describe, expect, it } from "vitest";
import type { CodeProposalFileDto } from "../types";
import type { ComponentFacts } from "../structure/structureTypes";
import { sourceTabsOf, type SourceSymbol } from "./sourceTabs";

function component(overrides: Partial<ComponentFacts> = {}): ComponentFacts {
  return {
    kind: "component",
    selector: "app-a",
    standalone: true,
    imports: [],
    templateRel: null,
    styleRels: [],
    ...overrides,
  };
}

function symbol(overrides: Partial<SourceSymbol> = {}): SourceSymbol {
  return { name: "A", rootId: "r", rel: "src/a.component.ts", ...overrides };
}

const labels = (input: SourceSymbol) => sourceTabsOf(input).map((tab) => tab.label);

describe("sourceTabsOf", () => {
  it("gives a service only its source, at its line", () => {
    const tabs = sourceTabsOf(symbol({ range: { startLine: 12 } }));
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ label: "TS", rel: "src/a.component.ts", line: 12 });
  });

  it("lists template and styles of a component", () => {
    expect(
      labels(
        symbol({
          component: component({ templateRel: "src/a.html", styleRels: ["src/a.scss"] }),
        }),
      ),
    ).toEqual(["TS", "HTML", "SCSS", "Preview"]);
  });

  it("opens an inline template in the source file at its line", () => {
    const tabs = sourceTabsOf(symbol({ component: component({ templateLine: 9 }) }));
    expect(tabs[1]).toMatchObject({ label: "HTML", rel: "src/a.component.ts", line: 9 });
  });

  it("offers a preview only for components with a template", () => {
    expect(labels(symbol({ component: component({ templateLine: 3 }) }))).toContain("Preview");
    expect(
      labels(symbol({ component: component({ kind: "directive", templateLine: 3 }) })),
    ).not.toContain("Preview");
  });

  it("offers no HTML without any template", () => {
    expect(labels(symbol({ component: component() }))).toEqual(["TS"]);
  });

  it("numbers styles sharing a label", () => {
    expect(
      labels(symbol({ component: component({ styleRels: ["a.css", "b.css", "c.scss"] }) })),
    ).toEqual(["TS", "CSS 1", "CSS 2", "SCSS"]);
  });

  it("marks what was not found", () => {
    const tabs = sourceTabsOf(
      symbol({
        component: component({ templateRel: "gone.html", missingAssets: ["gone.html"] }),
      }),
    );
    expect(tabs[1].missing).toBe(true);
    expect(tabs[0].missing).toBe(false);
  });

  it("shows pending proposal content, even for a file not on disk", () => {
    const file = {
      rootId: "r",
      rel: "gone.html",
      state: "pending",
      content: "<p></p>",
    } as CodeProposalFileDto;
    const tabs = sourceTabsOf(
      symbol({
        component: component({ templateRel: "gone.html", missingAssets: ["gone.html"] }),
      }),
      [file],
    );
    expect(tabs[1]).toMatchObject({ proposed: "<p></p>", missing: false });
    const accepted = sourceTabsOf(
      symbol({ component: component({ templateRel: "gone.html" }) }),
      [{ ...file, state: "accepted" }],
    );
    expect(accepted[1].proposed).toBeNull();
  });
});
