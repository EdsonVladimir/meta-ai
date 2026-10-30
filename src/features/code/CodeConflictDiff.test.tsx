// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CodeConflictDiff } from "./CodeConflictDiff";
import { DEFAULT_CODE_EDITOR_PREFS } from "./editorPrefs";
import { createMonacoFake } from "./monacoFake";

afterEach(() => cleanup());

describe("conflict diff", () => {
  it("uses the read-only Monaco diff and respects the layout", async () => {
    const fake = createMonacoFake();
    const { rerender } = render(
      <CodeConflictDiff
        diskText="a"
        draftText="b"
        language="plaintext"
        prefs={DEFAULT_CODE_EDITOR_PREFS}
        loader={fake.loader}
      />,
    );
    await waitFor(() => expect(fake.calls).toContain("diff-model"));
    expect(fake.calls.find((call) => call.startsWith("diff:"))).toContain(
      '"renderSideBySide":true',
    );
    expect(fake.calls.find((call) => call.startsWith("diff:"))).toContain('"readOnly":true');
    rerender(
      <CodeConflictDiff
        diskText="a"
        draftText="b"
        language="plaintext"
        prefs={{ ...DEFAULT_CODE_EDITOR_PREFS, diffLayout: "inline" }}
        loader={fake.loader}
      />,
    );
    await waitFor(() =>
      expect(fake.calls.some((call) => call.startsWith("diff-update:"))).toBe(true),
    );
    expect(screen.getByRole("img", { name: /Comparison/ })).toBeDefined();
  });

  it("keeps the text comparison when Monaco fails", async () => {
    render(
      <CodeConflictDiff
        diskText="external"
        draftText="mine"
        language="plaintext"
        prefs={DEFAULT_CODE_EDITOR_PREFS}
        loader={() => Promise.reject(new Error("no monaco"))}
      />,
    );
    expect(await screen.findByText("external")).toBeDefined();
    expect(screen.getByText("mine")).toBeDefined();
  });
});
