import { describe, expect, it } from "vitest";
import { addMentioned, applyMention, matchMentions, mentionAt } from "./fileMention";

describe("mentionAt", () => {
  it("finds the token under the cursor", () => {
    expect(mentionAt("look at @user", 13)).toEqual({ start: 8, query: "user" });
    expect(mentionAt("@", 1)).toEqual({ start: 0, query: "" });
  });

  it("ignores addresses and finished tokens", () => {
    expect(mentionAt("mail a@b.io", 11)).toBeNull();
    expect(mentionAt("@user done", 10)).toBeNull();
    expect(mentionAt("no token", 8)).toBeNull();
  });
});

describe("matchMentions", () => {
  it("puts file names before paths and caps the list", () => {
    expect(matchMentions(["src/users/a.ts", "src/user.model.ts", "src/b.ts"], "user")).toEqual([
      "src/user.model.ts",
      "src/users/a.ts",
    ]);
    const many = Array.from({ length: 12 }, (_, n) => `f${n}.ts`);
    expect(matchMentions(many, "")).toHaveLength(8);
  });
});

describe("applyMention", () => {
  it("swaps the token for the file name", () => {
    const text = "use @us now";
    expect(applyMention(text, { start: 4, query: "us" }, 7, "src/users.ts")).toEqual({
      text: "use @users.ts  now",
      cursor: 14,
    });
  });
});

describe("addMentioned", () => {
  it("adds a file and keeps a repeated one", () => {
    expect(addMentioned(["a"], "b", false, 8)).toEqual(["a", "b"]);
    expect(addMentioned(["a"], "a", false, 8)).toEqual(["a"]);
  });

  it("makes room in an automatic pick only", () => {
    expect(addMentioned(["a", "b"], "c", true, 2)).toEqual(["a", "c"]);
    expect(addMentioned(["a", "b"], "c", false, 2)).toBeNull();
  });
});
