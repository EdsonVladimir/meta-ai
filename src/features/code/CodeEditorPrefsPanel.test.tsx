// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_CODE_EDITOR_PREFS } from "./editorPrefs";
import { CodeEditorPrefsPanel } from "./CodeEditorPrefsPanel";

afterEach(() => cleanup());

describe("presentation panel", () => {
  it("emits changes and resets values", () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <CodeEditorPrefsPanel prefs={DEFAULT_CODE_EDITOR_PREFS} onChange={onChange} onReset={onReset} />,
    );
    fireEvent.click(screen.getByText("Presentation"));
    fireEvent.click(screen.getByLabelText("Minimap"));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CODE_EDITOR_PREFS, minimap: true });
    fireEvent.click(screen.getByText("Reset"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
