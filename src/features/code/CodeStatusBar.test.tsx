// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CodeStatusBar, cursorStatusText, linesStatusText } from "./CodeStatusBar";

afterEach(() => cleanup());

describe("status bar", () => {
  it("formats cursor, selection and lines", () => {
    expect(cursorStatusText(null)).toBe("Ln –, Col –");
    expect(linesStatusText(null)).toBe("– lines");
    expect(
      cursorStatusText({
        line: 2,
        column: 4,
        selectedChars: 3,
        selectionLabel: "2:1–2:4",
        lineCount: 10,
      }),
    ).toBe("Ln 2, Col 4 (3 selected)");
  });

  it("shows encoding and language control", () => {
    render(
      <CodeStatusBar
        cursor={{ line: 1, column: 1, selectedChars: 0, selectionLabel: null, lineCount: 1 }}
        languageControl={<span>Language</span>}
      />,
    );
    expect(screen.getByText("UTF-8")).toBeDefined();
    expect(screen.getByText("Language")).toBeDefined();
  });
});
