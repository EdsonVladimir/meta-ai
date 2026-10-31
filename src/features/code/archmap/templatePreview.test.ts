// Template preview: structure and own styles, no logic, nothing unsafe.
import { describe, expect, it } from "vitest";
import { buildPreview, fieldSummary } from "./templatePreview";

const none = () => null;
const body = (html: string, child: Parameters<typeof buildPreview>[0]["child"] = none) =>
  buildPreview({ html, css: "", child }).document.split("<body>")[1];

describe("buildPreview", () => {
  it("turns interpolations into labels, pipes included", () => {
    expect(body("<p>{{ store.count() }} of {{ total | number }}</p>")).toContain(
      '<span class="ruth-value">count</span> of <span class="ruth-value">total</span>',
    );
  });

  it("shows control blocks once, without their syntax", () => {
    const out = body(
      "@if (a(b)) {<p>one</p>} @else {<p>two</p>}\n@for (r of rows(); track r.id) {<li>{{ r.x }}</li>}",
    );
    expect(out).toContain("<p>one</p>");
    expect(out).toContain("<p>two</p>");
    expect(out).toContain("<li>");
    expect(out).not.toMatch(/@if|@else|@for|track|}/);
  });

  it("keeps an email @ in plain text", () => {
    expect(body("<p>a@b.com</p>")).toContain("a@b.com");
  });

  it("drops bindings, handlers and anything scriptable", () => {
    const out = body(
      `<a href="javascript:x()" onclick="x()" (click)="y()" [title]="t" class="k">go</a>
<script>alert(1)</script><iframe src="http://x"></iframe><style>p{}</style>
<img src="http://x/a.png" onerror="x()" alt="logo">`,
    );
    expect(out).toContain('<a class="k">go</a>');
    expect(out).toContain('<img alt="logo">');
    expect(out).not.toMatch(/javascript|onclick|alert|iframe|onerror|http:/);
  });

  it("escapes attribute values", () => {
    expect(body(`<p title='"><script>x</script>'>a</p>`)).not.toContain("<script>");
  });

  it("expands known children and boxes unknown tags, self-closed or not", () => {
    const child = (tag: string) =>
      tag === "app-a" ? { html: "<b>inner</b>", css: "b{color:red}" } : null;
    const out = buildPreview({
      html: "<app-a /><p-table><i>x</i></p-table>",
      css: "",
      child,
    }).document;
    expect(out).toContain('<div class="ruth-child"><b>inner</b></div>');
    expect(out).toContain('<div class="ruth-box"><span class="ruth-tag">p-table</span><i>x</i></div>');
    expect(out).toContain("b{color:red}");
  });

  it("stops at the depth limit, even for a component that includes itself", () => {
    const out = body("<app-a />", () => ({ html: "<app-a />", css: "" }));
    expect(out).toContain('<span class="ruth-tag">app-a</span>');
  });

  it("keeps styles safe and blocks the network", () => {
    const { document } = buildPreview({
      html: "<p>a</p>",
      css: `@import "http://x/a.css"; :host { color: red } </style><script>x</script>`,
      child: none,
    });
    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain("@import");
    expect(document).toContain(".ruth-child { color: red }");
    expect(document.split("</style>")).toHaveLength(3);
  });

  it("lists the form's fields with what a requirement would check", () => {
    const { fields, document } = buildPreview({
      html: `<input [(ngModel)]="form.nombres" required />
<input type="email" formControlName="correo" [disabled]="isEdit" />
<select name="genero"></select><textarea id="nota"></textarea>`,
      css: "",
      child: none,
    });
    expect(fields.map(fieldSummary)).toEqual([
      "nombres (text, required)",
      "correo (email, disabled by a condition)",
      "genero (select)",
      "nota (textarea)",
    ]);
    expect(document).toContain('placeholder="nombres"');
  });

  it("collects fields of children and survives broken markup", () => {
    const { fields } = buildPreview({
      html: "<app-a /><div <input",
      css: "",
      child: () => ({ html: '<input name="x" />', css: "" }),
    });
    expect(fields.map((field) => field.name)).toEqual(["x"]);
  });
});
