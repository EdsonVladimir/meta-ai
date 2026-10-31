// @vitest-environment jsdom
// Lite markdown for Muse answers: known syntax renders, the rest
// stays plain text, and markup in the text never becomes elements.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarkdownLite } from "./markdownLite";

afterEach(() => cleanup());

describe("MarkdownLite", () => {
  it("keeps the paragraph right before a list", () => {
    render(<MarkdownLite text={"What I found:\n- one\n- two\n\nSteps:\n1. first"} />);
    expect(screen.getByText("What I found:")).toBeTruthy();
    expect(screen.getByText("Steps:")).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders headings, bold and inline code", () => {
    render(<MarkdownLite text={"# Title\n\nIt **validates** with `cargo test`."} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Title");
    expect(screen.getByText("validates").tagName).toBe("STRONG");
    expect(screen.getByText("cargo test").tagName).toBe("CODE");
  });

  it("renders fenced code blocks verbatim", () => {
    const { container } = render(
      <MarkdownLite text={"```ts\nconst x = **not bold**;\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("const x = **not bold**;");
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders ordered and unordered lists", () => {
    const { container } = render(
      <MarkdownLite text={"- first\n- second\n\n1. one\n2. two"} />,
    );
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  });

  it("splits paragraphs on blank lines and breaks on single lines", () => {
    const { container } = render(<MarkdownLite text={"one\ntwo\n\nthree"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("leaves unknown syntax as plain text", () => {
    const { container } = render(
      <MarkdownLite text={"> quoted\n\n[a](http://x) and *single* and #nospace"} />,
    );
    expect(container.querySelector("blockquote")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(screen.getByText(/quoted/).textContent).toContain("> quoted");
    expect(screen.getByText(/single/).textContent).toContain("*single*");
  });

  it("renders embedded markup as text, never as elements", () => {
    const { container } = render(
      <MarkdownLite text={'<script>alert("x")</script>\n\n<b>hi</b> and **open and `open'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<script>alert("x")</script>');
    expect(container.textContent).toContain("<b>hi</b>");
    expect(container.textContent).toContain("**open and `open");
  });

  it("renders nothing for blank text", () => {
    const { container } = render(<MarkdownLite text={"  \n "} />);
    expect(container.textContent).toBe("");
  });
});
