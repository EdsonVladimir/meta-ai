// Preview loading: proposals over disk, children by selector, honest notes.
import { describe, expect, it, vi } from "vitest";
import { analyzeTsFiles } from "../structure/tsAnalyze";
import type { CodeProposalFileDto } from "../types";
import { loadPreview } from "./previewLoader";

function analyze(content: string) {
  return analyzeTsFiles([{ rootId: "r", rel: "src/a.component.ts", hash: "h", content }]).symbols;
}

const read = (files: Record<string, string>) =>
  vi.fn(async (_root: string, rel: string) => {
    if (files[rel] === undefined) throw new Error("missing");
    return { text: files[rel] };
  });

describe("loadPreview", () => {
  it("applies inline styles", async () => {
    const symbols = analyze(
      "@Component({ selector: 'a', template: '<h1>Hi</h1>', styles: [`h1 { color: teal; }`] }) export class A {}",
    );
    const out = await loadPreview({ symbol: symbols[0], symbols, readFile: read({}), proposalFiles: null });
    expect(out.document).toContain("color: teal");
  });

  it("draws an inline template without touching the disk", async () => {
    const symbols = analyze("@Component({ selector: 'a', template: '<h1>Hi</h1>' }) export class A {}");
    const readFile = read({});
    const out = await loadPreview({ symbol: symbols[0], symbols, readFile, proposalFiles: null });
    expect(out.document).toContain("<h1>Hi</h1>");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("reads template and CSS, and expands children by selector", async () => {
    const symbols = analyze(`@Component({ selector: 'app-a', templateUrl: './a.html', styleUrl: './a.css' }) export class A {}
@Component({ selector: 'app-b', template: '<input name="x" />' }) export class B {}`);
    const out = await loadPreview({
      symbol: symbols[0],
      symbols,
      readFile: read({ "src/a.html": "<app-b />", "src/a.css": "p{color:red}" }),
      proposalFiles: null,
    });
    expect(out.document).toContain("p{color:red}");
    expect(out.fields.map((field) => field.name)).toEqual(["x"]);
  });

  it("prefers pending proposal content over disk", async () => {
    const symbols = analyze("@Component({ selector: 'a', templateUrl: './a.html' }) export class A {}");
    const proposal = {
      rootId: "r",
      rel: "src/a.html",
      state: "pending",
      content: "<h2>New</h2>",
    } as CodeProposalFileDto;
    const out = await loadPreview({
      symbol: symbols[0],
      symbols,
      readFile: read({ "src/a.html": "<h2>Old</h2>" }),
      proposalFiles: [proposal],
    });
    expect(out.document).toContain("New");
    expect(out.document).not.toContain("Old");
  });

  it("notes what it cannot draw and still shows the rest", async () => {
    const symbols = analyze(
      "@Component({ selector: 'a', template: '<p>x</p>', styleUrls: ['./a.scss', './gone.css'] }) export class A {}",
    );
    const out = await loadPreview({ symbol: symbols[0], symbols, readFile: read({}), proposalFiles: null });
    expect(out.document).toContain("<p>x</p>");
    expect(out.notes.join(" ")).toContain("SCSS");
    expect(out.notes.join(" ")).toContain("gone.css");
  });

  it("fails plainly when the component's own template is unreadable", async () => {
    const symbols = analyze("@Component({ selector: 'a', templateUrl: './a.html' }) export class A {}");
    await expect(
      loadPreview({ symbol: symbols[0], symbols, readFile: read({}), proposalFiles: null }),
    ).rejects.toThrow("Could not read the template of A");
  });

  it("leaves a shared selector as a box instead of guessing", async () => {
    const symbols = analyze(`@Component({ selector: 'a', template: '<app-dup />' }) export class A {}
@Component({ selector: 'app-dup', template: '<b>one</b>' }) export class B {}
@Component({ selector: 'app-dup', template: '<b>two</b>' }) export class C {}`);
    const out = await loadPreview({ symbol: symbols[0], symbols, readFile: read({}), proposalFiles: null });
    expect(out.document).toContain('<span class="ruth-tag">app-dup</span>');
    expect(out.document).not.toContain("<b>");
  });
});
