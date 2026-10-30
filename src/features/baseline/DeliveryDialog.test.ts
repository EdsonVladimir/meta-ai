// Honest-language guard for work deliveries: a draft delivery is never
// presented as “coherent” or “verified”; it shows pending items, optional
// reviews and stale sources. This test reads the panel source and fails
// when forbidden claims appear.
import { describe, expect, it } from "vitest";
import sourceRaw from "./DeliveryDialog.tsx?raw";

// Visible text only: comments may name the rule without breaking it.
const source = sourceRaw
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|\s)\/\/.*$/gm, " ")
  .toLowerCase();

describe("honest work-delivery language", () => {
  it("claims neither coherence nor verification", () => {
    for (const forbidden of ["coherent", "verified"]) {
      expect(source, `forbidden word: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("identifies the draft and its pending items", () => {
    for (const required of ["draft", "unreviewed", "stale"]) {
      expect(source, `required text: ${required}`).toContain(required);
    }
  });

  it("clarifies that hashes are not a digital signature", () => {
    expect(source).toContain("not a digital signature");
  });
});
