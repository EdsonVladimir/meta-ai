import { describe, expect, it } from "vitest";
import { linkApis, normalizeApi } from "./apiLinks";
import type { ApiCall, ApiEndpoint } from "./structureTypes";

function endpoint(id: string, method: string, url: string): ApiEndpoint {
  return {
    id,
    method,
    url,
    rootId: "root-1",
    rel: "server.ts",
    range: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    evidence: "server.ts:1 (ruta)",
    note: null,
  };
}

function call(id: string, method: string, url: string): ApiCall {
  return {
    id,
    method,
    url,
    rootId: "root-1",
    rel: "client.ts",
    range: { startLine: 1, startCol: 1, endLine: 1, endCol: 2 },
    evidence: "client.ts:1 (fetch)",
    note: null,
  };
}

describe("normalizeApi", () => {
  it("normalizes method, query and trailing slash", () => {
    expect(normalizeApi("get", "/users/?a=1")).toMatchObject({
      method: "GET",
      path: "/users",
      key: "GET /users",
      external: false,
    });
    expect(normalizeApi("post", "/")).toMatchObject({ path: "/" });
  });

  it("unifies dynamic segments of Express, Actix and templates", () => {
    expect(normalizeApi("GET", "/users/:id").path).toBe("/users/{}");
    expect(normalizeApi("GET", "/users/{id}").path).toBe("/users/{}");
    expect(normalizeApi("GET", "/users/${...}").path).toBe("/users/{}");
    expect(normalizeApi("GET", "/f/:n.json").path).toBe("/f/{}.json");
  });

  it("detects absolute ones as external without a local key", () => {
    expect(normalizeApi("GET", "https://api.example.com/x").external).toBe(true);
    expect(normalizeApi("GET", "https://api.example.com/x").key).toBe("");
    expect(normalizeApi("GET", "//cdn.example.com/x").external).toBe(true);
    expect(normalizeApi("GET", "/local").external).toBe(false);
  });
});

describe("linkApis", () => {
  it("joins by normalized method+route even when the literal differs", () => {
    const linked = linkApis(
      [endpoint("e1", "GET", "/users/:id"), endpoint("e2", "POST", "/users")],
      [call("c1", "GET", "/users/${...}"), call("c2", "POST", "/users/")],
    );
    expect(linked.unions.map((u) => `${u.key} ${u.endpointId}→${u.callId}`)).toEqual([
      "GET /users/{} e1→c1",
      "POST /users e2→c2",
    ]);
    expect(linked.exposedUnused).toEqual([]);
    expect(linked.consumedUndefined).toEqual([]);
    expect(linked.external).toEqual([]);
    expect(linked.ambiguous).toEqual([]);
  });

  it("ALL joins with any method of its route", () => {
    const linked = linkApis(
      [endpoint("e1", "ALL", "/health")],
      [call("c1", "GET", "/health"), call("c2", "POST", "/health")],
    );
    expect(linked.unions).toHaveLength(2);
    expect(linked.exposedUnused).toEqual([]);
  });

  it("the method wins: same path with another verb does not join", () => {
    const linked = linkApis([endpoint("e1", "GET", "/users")], [call("c1", "POST", "/users")]);
    expect(linked.unions).toEqual([]);
    expect(linked.exposedUnused).toEqual(["e1"]);
    expect(linked.consumedUndefined).toEqual(["c1"]);
  });

  it("several candidate endpoints leave the key ambiguous without connecting", () => {
    const linked = linkApis(
      [endpoint("e1", "GET", "/users"), endpoint("e2", "GET", "/users")],
      [call("c1", "GET", "/users"), call("c2", "GET", "/users?x=1")],
    );
    expect(linked.unions).toEqual([]);
    expect(linked.ambiguous).toEqual([
      {
        key: "GET /users",
        method: "GET",
        path: "/users",
        endpointIds: ["e1", "e2"],
        callIds: ["c1", "c2"],
      },
    ]);
    // Ambiguous never counts as unused: it has untied candidates.
    expect(linked.exposedUnused).toEqual([]);
    expect(linked.consumedUndefined).toEqual([]);
  });

  it("separates external ones and preserves input order", () => {
    const linked = linkApis(
      [endpoint("e1", "GET", "/a"), endpoint("e2", "GET", "/b")],
      [
        call("c1", "GET", "https://api.example.com/a"),
        call("c2", "GET", "/b"),
        call("c3", "GET", "/c"),
      ],
    );
    expect(linked.external).toEqual(["c1"]);
    expect(linked.unions.map((u) => u.callId)).toEqual(["c2"]);
    expect(linked.consumedUndefined).toEqual(["c3"]);
    expect(linked.exposedUnused).toEqual(["e1"]);
  });

  it("empty invents nothing", () => {
    expect(linkApis([], [])).toEqual({
      unions: [],
      exposedUnused: [],
      consumedUndefined: [],
      external: [],
      ambiguous: [],
    });
  });
});
