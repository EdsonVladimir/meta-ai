// Template scanner: uses and calls, tolerant of broken markup.
import { expect, it } from "vitest";
import { scanTemplate } from "./ngTemplate";

const uses = (html: string) =>
  scanTemplate("a.html", html).uses.map((u) => [u.kind, u.name, u.line]);
const calls = (html: string) =>
  scanTemplate("a.html", html).calls.map((c) => [c.path.join("."), c.event, c.line]);

it("lists custom elements with their lines", () => {
  expect(uses(`<div>\n  <app-hijo></app-hijo>\n  <p-table></p-table>\n</div>`)).toEqual([
    ["element", "app-hijo", 2],
    ["element", "p-table", 3],
  ]);
});

it("skips plain HTML elements", () => {
  expect(uses(`<section><button>Ok</button></section>`)).toEqual([]);
});

it("lists attributes with their bound forms normalized", () => {
  const names = uses(`<input appFoco [appMask]="x" (click)="y()" *appSi="z" class="a" />`).map(
    (u) => u[1],
  );
  expect(names).toEqual(expect.arrayContaining(["appFoco", "appMask", "appSi"]));
  expect(names).not.toContain("click");
  expect(names).not.toContain("class");
});

it("lists pipes inside interpolations and bindings", () => {
  const out = uses(`<p [title]="a | fecha">{{ b | moneda:'BOB' }}</p>`);
  expect(out).toEqual(expect.arrayContaining([["pipe", "fecha", 1], ["pipe", "moneda", 1]]));
});

it("ignores comments and quoted text", () => {
  expect(uses(`<!-- <app-viejo></app-viejo> -->\n<p title="<app-falso>">x</p>`)).toEqual([]);
});

it("does not confuse the logical or with a pipe", () => {
  expect(uses(`<p>{{ a || b }}</p>`)).toEqual([]);
});

it("reads new control flow blocks and tolerates broken markup", () => {
  expect(uses(`@if (ok) {\n<app-a></app-a>\n}\n<div <app-b`)).toEqual([["element", "app-a", 2]]);
});

it("reads calls from every kind of expression, marking events", () => {
  const html = `<p>{{ store.count() }}</p>
<button (click)="guardar($event)" [disabled]="busy()">Ok</button>
@if (store.loading()) { <i></i> }
@for (r of store.items(); track r.id) { <li>{{ r.total() }}</li> }
<a *ngIf="visible()"></a>`;
  expect(calls(html)).toEqual([
    ["store.count", false, 1],
    ["guardar", true, 2],
    ["busy", false, 2],
    ["store.loading", false, 3],
    ["store.items", false, 4],
    ["r.total", false, 4],
    ["visible", false, 5],
  ]);
});

it("keeps three segment writes and refuses longer paths", () => {
  expect(calls(`<a (click)="store.items.set([]); a.b.c.d(); open.set(true)"></a>`)).toEqual([
    ["store.items.set", true, 1],
    ["open.set", true, 1],
  ]);
});

it("reads no call from strings, comments or raw text", () => {
  expect(
    calls(`<p [title]="'no()'">x()</p><!-- {{ y() }} --><style>a { b: z(); }</style><i (click)="alert('a()')"></i>`),
  ).toEqual([["alert", true, 1]]);
});

it("offsets lines for inline templates", () => {
  expect(uses(`\n<app-a></app-a>`).at(0)?.[2]).toBe(2);
  expect(scanTemplate("a.ts", `\n<app-a></app-a>`, 10).uses[0].line).toBe(11);
});
