import { describe, expect, it } from "vitest";
import {
  blockerTitle,
  defaultZipName,
  formatBytes,
  isStaleBaselineResponse,
  kindLabel,
  prepareKey,
} from "./coordination";

describe("response freshness", () => {
  it("discards responses from another query", () => {
    expect(isStaleBaselineResponse("a", "b")).toBe(true);
    expect(isStaleBaselineResponse("a", "a")).toBe(false);
  });

  it("the key includes project, module and sorted selection", () => {
    const one = prepareKey("p", "m", ["b", "a"]);
    const two = prepareKey("p", "m", ["a", "b"]);
    expect(one).toBe(two);
    expect(prepareKey("p", "m", ["a"])).not.toBe(one);
    expect(prepareKey("p", "other", ["a", "b"])).not.toBe(one);
  });
});

describe("ZIP naming", () => {
  it("derives a safe name from the name and ID", () => {
    expect(defaultZipName("Sales delivery", "base-1")).toBe("sales-delivery-base-1.zip");
  });

  it("neutralizes separators and special characters", () => {
    const name = defaultZipName("../../etc/evil ñandú", "base-../1");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
    expect(name).toMatch(/^[a-z0-9-]+\.zip$/);
  });

  it("falls back to defaults when nothing remains", () => {
    expect(defaultZipName("!!!", "???")).toBe("delivery-baseline.zip");
  });
});

describe("sizes", () => {
  it("formats bytes, KB and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("invents no values for invalid inputs", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("labels", () => {
  it("names known kinds and blockers", () => {
    expect(kindLabel("requirement")).toBe("requirement");
    expect(kindLabel("flow")).toBe("flow");
    expect(kindLabel("data_model")).toBe("ER model");
    expect(kindLabel("weird")).toBe("weird");
    expect(blockerTitle("draft")).toBe("Unapproved");
    expect(blockerTitle("stale_sources")).toBe("Stale sources");
    expect(blockerTitle("other")).toBe("other");
  });
});
