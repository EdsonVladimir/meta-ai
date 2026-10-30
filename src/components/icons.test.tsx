// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { afterEach } from "vitest";
import {
  RuthDesignIcon,
  RuthEyeIcon,
  RuthEyeOffIcon,
  RuthFileIcon,
  RuthFolderIcon,
  RuthMockupIcon,
  RuthModuleIcon,
  RuthOtherIcon,
  RuthProjectIcon,
  RuthRequirementIcon,
  RuthStatusIcon,
} from "./icons";

afterEach(() => cleanup());

describe("single icon set", () => {
  it("every artifact row has a decorative icon hidden from readers", () => {
    const { container } = render(
      <>
        <RuthProjectIcon />
        <RuthModuleIcon />
        <RuthRequirementIcon />
        <RuthDesignIcon />
        <RuthMockupIcon />
        <RuthOtherIcon />
        <RuthStatusIcon />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(7);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("the folder distinguishes open and closed", () => {
    const { container, rerender } = render(<RuthFolderIcon open={false} />);
    const closed = container.querySelector("svg")?.innerHTML ?? "";
    rerender(<RuthFolderIcon open />);
    const open = container.querySelector("svg")?.innerHTML ?? "";
    expect(closed).not.toBe(open);
  });

  it("the file shows its extension badge", () => {
    const { container } = render(<RuthFileIcon name="src/lib.rs" />);
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("kind-code")).toBe(true);
    expect(svg?.querySelector("text")?.textContent).toBe("RS");
  });

  it("the eye pair differs and stays decorative", () => {
    const { container } = render(
      <>
        <RuthEyeIcon />
        <RuthEyeOffIcon />
      </>,
    );
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
    expect(svgs[0].innerHTML).not.toBe(svgs[1].innerHTML);
  });

  it("the extensionless file invents no badge", () => {
    const { container } = render(<RuthFileIcon name="notas" />);
    const svg = container.querySelector("svg");
    expect(svg?.classList.contains("kind-text")).toBe(true);
    expect(svg?.querySelector("text")).toBeNull();
  });
});
