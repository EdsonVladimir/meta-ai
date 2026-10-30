// boardCss: the board CSS row constants mirror boardLayout.ts exactly.
// The layout pass sizes cards from these rows, so any drift between
// the stylesheet and the math clips content or skews edges.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ARCH_CARD_BORDER,
  ARCH_CARD_GAP,
  ARCH_CARD_PAD_Y,
  ARCH_COL_GAP,
  ARCH_COL_HEAD_H,
  ARCH_HEAD_ROW_H,
  ARCH_MEM_ROW_H,
  ARCH_META_ROW_H,
  ARCH_MORE_ROW_H,
  ARCH_SUB_ROW_H,
  ARCH_SYM_ROW_H,
} from "./boardLayout";

const CSS = readFileSync(new URL("../../../styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const match = pattern.exec(CSS);
  if (match === null) throw new Error(`missing CSS rule: ${selector}`);
  return match[1];
}

function px(block: string, property: string): number {
  const pattern = new RegExp(`${property}\\s*:\\s*(\\d+)px`);
  const match = pattern.exec(block);
  if (match === null) throw new Error(`missing ${property} in CSS rule`);
  return Number(match[1]);
}

describe("board CSS constants", () => {
  it("sizes everything border-box", () => {
    expect(rule("*")).toMatch(/box-sizing\s*:\s*border-box/);
  });

  it("matches column gaps and header heights", () => {
    expect(px(rule(".archboard-cols"), "gap")).toBe(ARCH_COL_GAP);
    expect(px(rule(".archboard-col"), "gap")).toBe(ARCH_CARD_GAP);
    expect(px(rule(".archboard-col-head"), "height")).toBe(ARCH_COL_HEAD_H);
  });

  it("matches card padding, borders and row heights", () => {
    const card = rule(".archboard-card");
    expect(px(card, "padding")).toBe(ARCH_CARD_PAD_Y);
    // 1px top + 1px bottom (the 3px accent edge is horizontal only).
    expect(px(card, "border") * 2).toBe(ARCH_CARD_BORDER);
    expect(px(rule(".archboard-card-head"), "height")).toBe(ARCH_HEAD_ROW_H);
    expect(px(rule(".archboard-card-meta"), "height")).toBe(ARCH_META_ROW_H);
    expect(px(rule(".archboard-symbol"), "height")).toBe(ARCH_SYM_ROW_H);
    expect(px(rule(".archboard-card-sub"), "height")).toBe(ARCH_SUB_ROW_H);
    // Member slot = 6px gap above + the 28px bordered row.
    const slot = rule(".archboard-member-slot");
    expect(px(slot, "height")).toBe(ARCH_MEM_ROW_H);
    expect(px(slot, "padding-top") + px(rule(".archboard-member"), "height")).toBe(ARCH_MEM_ROW_H);
    // Toggle = 6px gap above + the button text line.
    expect(px(rule(".archboard-more"), "height")).toBe(ARCH_MORE_ROW_H);
  });

  it("matches flow board rows", () => {
    // The collapsed-members row reuses the toggle height; signal
    // lines reuse the meta height. No new row heights.
    expect(px(rule(".flowboard-more"), "height")).toBe(ARCH_MORE_ROW_H);
    expect(px(rule(".flowboard-sig"), "height")).toBe(ARCH_META_ROW_H);
  });

  it("lets hidden panels actually hide", () => {
    // `display: flex` on these would otherwise defeat the attribute.
    expect(rule(".modal-backdrop[hidden]")).toMatch(/display\s*:\s*none/);
    expect(rule(".architecture-scope[hidden]")).toMatch(/display\s*:\s*none/);
  });
});

