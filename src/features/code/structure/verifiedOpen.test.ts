// verifiedOpen: analyzed ranges are exact only while the content hash
// still matches; anything else opens without jumping.
import { describe, expect, it } from "vitest";
import { fnv1aHex } from "../model";
import { verifyAnalyzedHash } from "./verifiedOpen";

describe("verifyAnalyzedHash", () => {
  it("matches identical content", async () => {
    const outcome = await verifyAnalyzedHash(
      async () => ({ text: "const a = 1;" }),
      "root-1",
      "a.ts",
      fnv1aHex("const a = 1;"),
    );
    expect(outcome).toBe("match");
  });

  it("reports changed content", async () => {
    const outcome = await verifyAnalyzedHash(
      async () => ({ text: "const a = 2;" }),
      "root-1",
      "a.ts",
      fnv1aHex("const a = 1;"),
    );
    expect(outcome).toBe("changed");
  });

  it("reports unreadable files and missing hashes", async () => {
    const unreadable = await verifyAnalyzedHash(
      async () => {
        throw new Error("gone");
      },
      "root-1",
      "a.ts",
      fnv1aHex("const a = 1;"),
    );
    expect(unreadable).toBe("unreadable");
    const noHash = await verifyAnalyzedHash(async () => ({ text: "x" }), "root-1", "a.ts", null);
    expect(noHash).toBe("unreadable");
    const emptyHash = await verifyAnalyzedHash(async () => ({ text: "x" }), "root-1", "a.ts", "");
    expect(emptyHash).toBe("unreadable");
  });
});
