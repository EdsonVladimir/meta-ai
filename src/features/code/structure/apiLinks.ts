// Front↔back API joins: normalization and crossing in one place.
// Extractors keep the original literal; the method+route key derives
// here. Documented rules:
// - Uppercase method; `ALL` (the `app.all` shape) joins with any
//   method of its own route.
// - Dynamic segments (`:id`, `{id}`, `${...}`) → `{}` in place;
//   the query (`?...`) and the trailing slash (except root) are ignored.
// - A call joins with ONE single candidate endpoint; with several, the
//   group stays ambiguous and NOTHING connects.
// - Absolute calls (`http…`) separate as external: they never pretend
//   to point at the local backend.
//
// Pure and deterministic: same input order, same result.
import type { ApiCall, ApiEndpoint } from "./structureTypes";

export interface NormalizedApi {
  method: string;
  path: string;
  key: string;
  external: boolean;
}

export function isExternalUrl(url: string): boolean {
  return /^(https?:)?\/\/[^/]/i.test(url.trim());
}

/** Join key for a method and a URL literal. */
export function normalizeApi(method: string, url: string): NormalizedApi {
  const normalizedMethod = method.trim().toUpperCase();
  const trimmed = url.trim();
  if (isExternalUrl(trimmed)) {
    return { method: normalizedMethod, path: trimmed, key: "", external: true };
  }
  let path = trimmed
    .replace(/\$\{[^}]*\}/g, "{}")
    .replace(/\{[^}]*\}/g, "{}")
    .replace(/:[A-Za-z0-9_]+/g, "{}");
  const query = path.indexOf("?");
  if (query >= 0) path = path.slice(0, query);
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return {
    method: normalizedMethod,
    path,
    key: `${normalizedMethod} ${path}`,
    external: false,
  };
}

export interface ApiUnion {
  id: string;
  method: string;
  path: string;
  key: string;
  endpointId: string;
  callId: string;
}

export interface ApiAmbiguity {
  key: string;
  method: string;
  path: string;
  endpointIds: string[];
  callIds: string[];
}

export interface ApiLinkResult {
  unions: ApiUnion[];
  /** Endpoints without any candidate call. */
  exposedUnused: string[];
  /** Local calls without a candidate endpoint. */
  consumedUndefined: string[];
  /** Absolute calls (external to the local backend). */
  external: string[];
  /** Keys with more than one candidate endpoint: unconnected. */
  ambiguous: ApiAmbiguity[];
}

/**
 * Crosses endpoints with calls. Each call is evaluated against the
 * endpoints of its own normalized route (same method or ALL).
 */
export function linkApis(endpoints: ApiEndpoint[], calls: ApiCall[]): ApiLinkResult {
  const byPath = new Map<string, { point: ApiEndpoint; method: string }[]>();
  for (const point of endpoints) {
    const normal = normalizeApi(point.method, point.url);
    const list = byPath.get(normal.path) ?? [];
    list.push({ point, method: normal.method });
    byPath.set(normal.path, list);
  }
  const unions: ApiUnion[] = [];
  const consumedUndefined: string[] = [];
  const external: string[] = [];
  const ambiguousByKey = new Map<string, ApiAmbiguity>();
  const usedEndpoints = new Set<string>();
  const ambiguousEndpoints = new Set<string>();

  for (const call of calls) {
    const normal = normalizeApi(call.method, call.url);
    if (normal.external) {
      external.push(call.id);
      continue;
    }
    const candidates = (byPath.get(normal.path) ?? []).filter(
      (candidate) => candidate.method === normal.method || candidate.method === "ALL",
    );
    if (candidates.length === 1) {
      const endpoint = candidates[0].point;
      usedEndpoints.add(endpoint.id);
      unions.push({
        id: `api:${endpoint.id}::${call.id}`,
        method: normal.method,
        path: normal.path,
        key: normal.key,
        endpointId: endpoint.id,
        callId: call.id,
      });
    } else if (candidates.length === 0) {
      consumedUndefined.push(call.id);
    } else {
      let group = ambiguousByKey.get(normal.key);
      if (group === undefined) {
        group = {
          key: normal.key,
          method: normal.method,
          path: normal.path,
          endpointIds: candidates.map((candidate) => candidate.point.id),
          callIds: [],
        };
        ambiguousByKey.set(normal.key, group);
        for (const candidate of candidates) ambiguousEndpoints.add(candidate.point.id);
      }
      group.callIds.push(call.id);
    }
  }

  const exposedUnused = endpoints
    .filter((point) => !usedEndpoints.has(point.id) && !ambiguousEndpoints.has(point.id))
    .map((point) => point.id);
  return {
    unions,
    exposedUnused,
    consumedUndefined,
    external,
    ambiguous: [...ambiguousByKey.values()],
  };
}
