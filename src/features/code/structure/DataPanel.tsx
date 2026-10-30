// Data tab: in-scope TS interfaces and Rust structs/enums, with their
// members and code jumps. SYNTACTIC detection: not an ER, it asserts
// no tables, keys or business rules; the proposed ER still lives in
// Design.
import { useMemo, useState } from "react";
import type { StructureRange, StructureSymbol } from "./structureTypes";

const DATA_KINDS = ["interface", "struct", "enum"] as const;

const KIND_LABELS: Record<string, string> = {
  interface: "Interface",
  struct: "Struct",
  enum: "Enum",
};

interface DataPanelProps {
  symbols: StructureSymbol[];
  rootNames: Record<string, string>;
  hashOf: (rootId: string, rel: string) => string;
  onOpenSymbol: (rootId: string, rel: string, range: StructureRange, hash: string) => void;
}

export function DataPanel({ symbols, rootNames, hashOf, onOpenSymbol }: DataPanelProps) {
  const [query, setQuery] = useState("");
  const data = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return symbols
      .filter((symbol) => (DATA_KINDS as readonly string[]).includes(symbol.kind))
      .filter((symbol) => needle === "" || symbol.name.toLowerCase().includes(needle));
  }, [symbols, query]);

  return (
    <div className="data-panel">
      <p className="hint">
        Syntactic in-scope detection: TypeScript interfaces and Rust structs/enums. Not an
        entity-relationship model and asserts no persistence; a field here is not a column.
      </p>
      <div className="structure-filters">
        <label className="hint" htmlFor="data-search">
          Search
        </label>
        <input
          id="data-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type name…"
        />
        <span className="hint">
          {data.length} type{data.length === 1 ? "" : "s"}
        </span>
      </div>
      {data.length === 0 && (
        <p className="hint">
          No data types in scope. Add files with interfaces, structs or enums and
          analyze again.
        </p>
      )}
      <ul className="data-list">
        {data.map((symbol) => (
          <li key={symbol.id} className="data-card">
            <div className="data-head">
              <strong>{symbol.name}</strong>{" "}
              <span className="hint">
                {KIND_LABELS[symbol.kind]} · {symbol.language === "ts" ? "TypeScript" : "Rust"}
              </span>
            </div>
            <p className="hint">
              {rootNames[symbol.rootId] ?? symbol.rootId}/{symbol.rel} · lines{" "}
              {symbol.range.startLine}–{symbol.range.endLine}
            </p>
            {symbol.members.length > 0 && (
              <ul className="data-members">
                {symbol.members.map((member, index) => (
                  <li key={`${member.kind}:${member.name}:${index}`}>
                    <code>{member.name}</code>{" "}
                    <span className="hint">
                      {member.kind} · {member.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {symbol.membersTruncated && <p className="hint">Members truncated (cap).</p>}
            <button
              type="button"
              className="secondary small"
              onClick={() =>
                onOpenSymbol(symbol.rootId, symbol.rel, symbol.range, hashOf(symbol.rootId, symbol.rel))
              }
            >
              Open in code
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
