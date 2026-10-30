// APIs tab: front↔back joins by normalized method+route, exposed
// without detected use, consumed without a definition, and external.
// Everything comes from `linkApis` (pure); here it is only presented
// and navigated to code with fingerprint verification.
import { useMemo, useState } from "react";
import { linkApis } from "./apiLinks";
import type {
  ApiCall,
  ApiEndpoint,
  StructureRange,
} from "./structureTypes";

interface ApiPanelProps {
  endpoints: ApiEndpoint[];
  calls: ApiCall[];
  rootNames: Record<string, string>;
  hashOf: (rootId: string, rel: string) => string;
  onOpenPoint: (rootId: string, rel: string, range: StructureRange, hash: string) => void;
}

function whereOf(rootNames: Record<string, string>, rootId: string, rel: string): string {
  return `${rootNames[rootId] ?? rootId}/${rel}`;
}

export function ApiPanel({ endpoints, calls, rootNames, hashOf, onOpenPoint }: ApiPanelProps) {
  const [query, setQuery] = useState("");
  const linked = useMemo(() => linkApis(endpoints, calls), [endpoints, calls]);
  const byEndpointId = useMemo(() => new Map(endpoints.map((point) => [point.id, point])), [endpoints]);
  const byCallId = useMemo(() => new Map(calls.map((point) => [point.id, point])), [calls]);

  const needle = query.trim().toLowerCase();
  const matchKey = (key: string, url: string): boolean =>
    needle === "" || key.toLowerCase().includes(needle) || url.toLowerCase().includes(needle);
  const unions = linked.unions.filter((union) => {
    const endpoint = byEndpointId.get(union.endpointId);
    const call = byCallId.get(union.callId);
    return matchKey(union.key, `${endpoint?.url ?? ""} ${call?.url ?? ""}`);
  });
  const unused = linked.exposedUnused
    .map((id) => byEndpointId.get(id))
    .filter((point): point is ApiEndpoint => point !== undefined)
    .filter((point) => matchKey("", point.url));
  const undefinedCalls = linked.consumedUndefined
    .map((id) => byCallId.get(id))
    .filter((point): point is ApiCall => point !== undefined)
    .filter((point) => matchKey("", point.url));
  const external = linked.external
    .map((id) => byCallId.get(id))
    .filter((point): point is ApiCall => point !== undefined)
    .filter((point) => matchKey("", point.url));

  function open(point: ApiEndpoint | ApiCall): void {
    onOpenPoint(point.rootId, point.rel, point.range, hashOf(point.rootId, point.rel));
  }

  function pointLine(point: ApiEndpoint | ApiCall): string {
    return `${whereOf(rootNames, point.rootId, point.rel)}:${point.range.startLine}`;
  }

  return (
    <div className="api-panel">
      <p className="hint">
        Joins by normalized method+route (dynamic segments count the same whether from
        Express, Actix or templates); a call only joins with a single endpoint. Ambiguous
        groups do not connect.
      </p>
      <div className="structure-filters">
        <label className="hint" htmlFor="api-search">
          Search
        </label>
        <input
          id="api-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Route or method…"
        />
        <span className="hint" role="status">
          {linked.unions.length} joined ·{" "}
          {linked.exposedUnused.length} exposed without use ·{" "}
          {linked.consumedUndefined.length} consumed without a definition ·{" "}
          {linked.external.length} external · {linked.ambiguous.length} ambiguous
        </span>
      </div>
      {endpoints.length === 0 && calls.length === 0 && (
        <p className="hint">
          No APIs in scope. Add files with routes (Express/Hono, Actix, Axum) or calls
          (`fetch`, `axios`, `reqwest`) and analyze again.
        </p>
      )}
      {unions.length > 0 && (
        <section aria-label="Joins">
          <h3>Joined ({unions.length})</h3>
          <ul className="api-list">
            {unions.map((union) => {
              const endpoint = byEndpointId.get(union.endpointId);
              const call = byCallId.get(union.callId);
              if (endpoint === undefined || call === undefined) return null;
              return (
                <li key={union.id} className="api-row">
                  <code className="api-key">{union.key}</code>
                  <div>
                    <span className="api-side">exposes</span>{" "}
                    <button
                      type="button"
                      className="struct-link"
                      title={`${endpoint.url} · ${endpoint.evidence}`}
                      onClick={() => open(endpoint)}
                    >
                      {pointLine(endpoint)}
                    </button>{" "}
                    <span className="hint">({endpoint.url})</span>
                    {endpoint.note !== null && <span className="hint"> ⚠ {endpoint.note}</span>}
                  </div>
                  <div>
                    <span className="api-side">consumes</span>{" "}
                    <button
                      type="button"
                      className="struct-link"
                      title={`${call.url} · ${call.evidence}`}
                      onClick={() => open(call)}
                    >
                      {pointLine(call)}
                    </button>{" "}
                    <span className="hint">({call.url})</span>
                    {call.note !== null && <span className="hint"> ⚠ {call.note}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {unused.length > 0 && (
        <section aria-label="Exposed without use">
          <h3>Exposed without detected use ({unused.length})</h3>
          <ul className="api-list">
            {unused.map((point) => (
              <li key={point.id}>
                <code>
                  {point.method} {point.url}
                </code>{" "}
                <button
                  type="button"
                  className="struct-link"
                  title={point.evidence}
                  onClick={() => open(point)}
                >
                  {pointLine(point)}
                </button>
                {point.note !== null && <span className="hint"> ⚠ {point.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {undefinedCalls.length > 0 && (
        <section aria-label="Consumed without a definition">
          <h3>Consumed without a definition ({undefinedCalls.length})</h3>
          <ul className="api-list">
            {undefinedCalls.map((point) => (
              <li key={point.id}>
                <code>
                  {point.method} {point.url}
                </code>{" "}
                <button
                  type="button"
                  className="struct-link"
                  title={point.evidence}
                  onClick={() => open(point)}
                >
                  {pointLine(point)}
                </button>
                {point.note !== null && <span className="hint"> ⚠ {point.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {external.length > 0 && (
        <section aria-label="External">
          <h3>External ({external.length})</h3>
          <ul className="api-list">
            {external.map((point) => (
              <li key={point.id}>
                <code>
                  {point.method} {point.url}
                </code>{" "}
                <button
                  type="button"
                  className="struct-link"
                  title={point.evidence}
                  onClick={() => open(point)}
                >
                  {pointLine(point)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {linked.ambiguous.length > 0 && (
        <section aria-label="Ambiguous">
          <h3>Ambiguous ({linked.ambiguous.length})</h3>
          <ul className="api-list">
            {linked.ambiguous.map((group) => (
              <li key={group.key}>
                <code className="api-key">{group.key}</code>{" "}
                <span className="hint">
                  {group.endpointIds.length} candidate endpoints, {group.callIds.length} call
                  {group.callIds.length === 1 ? "" : "s"}: unconnected until the scope disambiguates.
                </span>
                <ul>
                  {group.endpointIds.map((id) => {
                    const point = byEndpointId.get(id);
                    if (point === undefined) return null;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className="struct-link"
                          title={`${point.url} · ${point.evidence}`}
                          onClick={() => open(point)}
                        >
                          {pointLine(point)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
