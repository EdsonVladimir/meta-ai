// Inspector of one mapped file: full symbol list with member counts
// and decorators, incoming/outgoing edges, unresolved references,
// external and missing imports. Sections collapse; members read one
// per row. The inspector never opens code: files stay reachable from
// the explorer navigation.
//
// Symbol-level selection: clicking a symbol inspects its relations
// (kind, status, evidence) instead of navigating right away. Members
// have no own ranges in the analysis: they open nowhere, but one
// selected member shows its full detail (role, written modifiers,
// parameters and return as extracted; unknown when not written).
import { useState, type ReactNode } from "react";
import { ARCH_LAYER_BY_ID, ARCH_LAYERS, type ArchLayer } from "./archLayers";
import type { ArchMapEdge, ArchMapFile, ArchMapNode, ArchMapSymbol } from "./archModel";
import {
  MEMBER_ROLE_LABEL,
  languageName,
  memberLabel,
  memberModifiers,
  memberRole,
  splitSignature,
} from "./memberRoles";
import type { EffectiveLayer } from "./mapFilter";
import type { StructureRelation } from "../structure/structureTypes";

export interface SymbolRef {
  id: string;
  name: string;
  kind: string;
  rel: string;
  rootId: string;
}

interface ArchMapInspectorProps {
  file: ArchMapFile | null;
  edges: ArchMapEdge[];
  onSelectFile: (rootId: string, rel: string) => void;
  /** Symbol relations of this analysis (for the symbol detail). */
  relations?: StructureRelation[];
  /** Symbol id → owner file (for cross-symbol navigation). */
  symbolIndex?: Map<string, SymbolRef>;
  selectedSymbolId?: string | null;
  onSelectSymbol?: (id: string | null) => void;
  /** The board card of the selected symbol (its own layer verdict). */
  node?: ArchMapNode | null;
  /** Effective layer after manual overrides (null = no symbol card). */
  nodeLayer?: EffectiveLayer | null;
  onSetLayerOverride?: (id: string, layer: ArchLayer | null) => void;
  /**
   * The selection sits outside the module filter: show the notice
   * instead of stale data, with a way back to all modules.
   */
  outsideModule?: { moduleLabel: string; onShowAll: () => void } | null;
  /** "Label (kind)" groupings of the selected symbol, if any. */
  memberships?: string[] | null;
  /** The selected symbol is an external reference, shown on request. */
  referenceNote?: string | null;
  /** Selected member of the selected symbol (index), from the board or here. */
  selectedMember?: number | null;
  onSelectMember?: (index: number | null) => void;
}

function Section({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="archmap-section" aria-label={id}>
      <button
        type="button"
        className="archmap-section-head"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="archboard-chevron" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>{" "}
        {title}
        {count === null ? "" : ` (${count})`}
      </button>
      {open && <div className="archmap-section-body">{children}</div>}
    </section>
  );
}

export function ArchMapInspector({
  file,
  edges,
  onSelectFile,
  relations,
  symbolIndex,
  selectedSymbolId,
  onSelectSymbol,
  node,
  nodeLayer,
  onSetLayerOverride,
  outsideModule,
  memberships,
  referenceNote,
  selectedMember,
  onSelectMember,
}: ArchMapInspectorProps) {
  if (file === null) {
    return (
      <div className="archmap-inspector-empty">
        <p className="hint">Select a card to inspect its symbols and connections.</p>
      </div>
    );
  }
  if (outsideModule !== null && outsideModule !== undefined) {
    return (
      <div className="archmap-inspector-empty">
        <p className="hint" role="note">
          The selection sits outside the {outsideModule.moduleLabel} module filter, so the
          board hides it. Nothing was lost: lift the filter to see it again.
        </p>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={outsideModule.onShowAll}>
            Show all modules
          </button>
        </div>
      </div>
    );
  }
  const selectable = onSelectSymbol !== undefined;
  const selectedSymbol =
    selectedSymbolId === undefined || selectedSymbolId === null
      ? null
      : (file.symbols.find((symbol) => symbol.id === selectedSymbolId) ?? null);
  const incoming = edges.filter((e) => e.rootId === file.rootId && e.toRel === file.rel);
  const outgoing = edges.filter((e) => e.rootId === file.rootId && e.fromRel === file.rel);
  return (
    <div className="archmap-inspector">
      <h3 title={file.rel}>{file.rel.split("/").pop()}</h3>
      <p className="hint" title={file.rel}>
        {file.rel}
      </p>
      <p className="hint">
        {languageName(file.rel)} file · Layer: <strong>{ARCH_LAYER_BY_ID[file.layer].label}</strong> ·{" "}
        {file.layerReason}
      </p>
      <Section id="symbols" title="Symbols" count={file.symbols.length}>
        {file.symbols.length === 0 ? (
          <p className="hint">No classes, interfaces or functions detected.</p>
        ) : (
          <ul className="archmap-list">
            {file.symbols.map((symbol) => (
              <li key={symbol.id}>
                {selectable ? (
                  <button
                    type="button"
                    className="archmap-link"
                    title={`Inspect ${symbol.name}`}
                    aria-pressed={selectedSymbol?.id === symbol.id}
                    onClick={() =>
                      onSelectSymbol(selectedSymbol?.id === symbol.id ? null : symbol.id)
                    }
                  >
                    <code>
                      {symbol.kind} {symbol.name}
                    </code>
                  </button>
                ) : (
                  <code>
                    {symbol.kind} {symbol.name}
                  </code>
                )}{" "}
                <span className="hint">
                  {symbol.members.length > 0 ? `${symbol.members.length} members` : "no members"}
                </span>
                {symbol.decorators.length > 0 && (
                  <span className="hint"> @{symbol.decorators.join(" @")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {selectable && selectedSymbol !== null && (
        <SymbolDetail
          key={selectedSymbol.id}
          file={file}
          symbol={selectedSymbol}
          relations={relations ?? []}
          symbolIndex={symbolIndex}
          onSelectSymbol={onSelectSymbol}
          onSelectFile={onSelectFile}
          node={node ?? null}
          nodeLayer={nodeLayer ?? null}
          onSetLayerOverride={onSetLayerOverride}
          memberships={memberships ?? null}
          referenceNote={referenceNote ?? null}
          selectedMember={selectedMember ?? null}
          onSelectMember={onSelectMember}
        />
      )}
      <Section id="used-by" title="Used by" count={incoming.length}>
        {incoming.length === 0 ? (
          <p className="hint">Nothing in the scope points here.</p>
        ) : (
          <ul className="archmap-list">
            {incoming.map((edge) => (
              <li key={edge.id}>
                <EdgeButton edge={edge} other={edge.fromRel} onSelectFile={onSelectFile} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="uses" title="Uses" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <p className="hint">No resolved dependencies in the scope.</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((edge) => (
              <li key={edge.id}>
                <EdgeButton edge={edge} other={edge.toRel} onSelectFile={onSelectFile} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      {file.unresolved.length > 0 && (
        <Section
          id="unresolved"
          title={`Unresolved (${file.unresolved.length}${file.unresolvedTruncated ? "+" : ""})`}
          count={null}
        >
          <UnresolvedList file={file} />
        </Section>
      )}
      {file.externals.length > 0 && (
        <Section id="external-imports" title="External imports" count={file.externals.length}>
          <p className="hint">{file.externals.join(", ")}</p>
        </Section>
      )}
      {file.missing.length > 0 && (
        <Section id="out-of-scope" title="Out of scope" count={file.missing.length}>
          <p className="hint">{file.missing.join(", ")}</p>
        </Section>
      )}
    </div>
  );
}

function UnresolvedList({ file }: { file: ArchMapFile }) {
  return (
    <>
      <p className="hint">
        References the analysis could not resolve. Open the file from the explorer to review
        them.
      </p>
      <ul className="archmap-list">
        {file.unresolved.map((ref, i) => (
          <li key={`${ref.kind}:${ref.toName}:${i}`}>
            <code>{ref.toName}</code>{" "}
            <span className="hint">
              {ref.kind} · {ref.status}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface SymbolDetailProps {
  file: ArchMapFile;
  symbol: ArchMapSymbol;
  relations: StructureRelation[];
  symbolIndex: Map<string, SymbolRef> | undefined;
  onSelectSymbol: (id: string | null) => void;
  onSelectFile: (rootId: string, rel: string) => void;
  node: ArchMapNode | null;
  nodeLayer: EffectiveLayer | null;
  onSetLayerOverride: ((id: string, layer: ArchLayer | null) => void) | undefined;
  memberships: string[] | null;
  referenceNote: string | null;
  selectedMember: number | null;
  onSelectMember: ((index: number | null) => void) | undefined;
}

function SymbolDetail({
  file,
  symbol,
  relations,
  symbolIndex,
  onSelectSymbol,
  onSelectFile,
  node,
  nodeLayer,
  onSetLayerOverride,
  memberships,
  referenceNote,
  selectedMember,
  onSelectMember,
}: SymbolDetailProps) {
  const member =
    selectedMember === null ? null : (symbol.members[selectedMember] ?? null);
  const outgoing = relations.filter((rel) => rel.from === symbol.id);
  const incoming = relations.filter((rel) => rel.to === symbol.id);
  return (
    <section className="archmap-symbol-detail" aria-label={`Symbol ${symbol.name}`}>
      <h4>
        <code>
          {symbol.kind} {symbol.name}
        </code>
      </h4>
      {referenceNote !== null && (
        <p className="hint" role="note">
          Reference card — {referenceNote}.
        </p>
      )}
      <p className="hint">
        Lines {symbol.range.startLine}–{symbol.range.endLine}
        {symbol.decorators.length > 0 ? ` · @${symbol.decorators.join(" @")}` : ""}
      </p>
      {memberships !== null && memberships.length > 0 && (
        <p className="hint">Member of: {memberships.join("; ")}.</p>
      )}
      <div className="button-row">
        <button type="button" className="secondary small" onClick={() => onSelectSymbol(null)}>
          Back to file
        </button>
      </div>
      {member !== null && selectedMember !== null && (
        <Section id="symbol-member" title="Selected member" count={null}>
          <MemberDetail
            key={selectedMember}
            symbol={symbol}
            member={member}
            onClose={onSelectMember === undefined ? undefined : () => onSelectMember(null)}
          />
        </Section>
      )}
      {node !== null && nodeLayer !== null && (
        <Section id="symbol-layer" title="Layer" count={null}>
          <p className="hint">
            Automatic: <strong>{ARCH_LAYER_BY_ID[node.layer].label}</strong> · {node.layerReason}
          </p>
          {nodeLayer.overridden && (
            <p className="hint" role="note">
              Manual override: <strong>{ARCH_LAYER_BY_ID[nodeLayer.layer].label}</strong>.
            </p>
          )}
          {onSetLayerOverride !== undefined && (
            <label className="archmap-layer">
              Reclassify
              <select
                aria-label="Symbol layer"
                value={nodeLayer.overridden ? nodeLayer.layer : "auto"}
                onChange={(event) => {
                  const value = event.target.value;
                  onSetLayerOverride(
                    node.id,
                    value === "auto" ? null : (value as ArchLayer),
                  );
                }}
              >
                <option value="auto">Automatic ({ARCH_LAYER_BY_ID[node.layer].label})</option>
                {ARCH_LAYERS.map((def) => (
                  <option key={def.id} value={def.id}>
                    {def.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Section>
      )}
      {symbol.members.length > 0 && (
        <Section id="members" title="Members" count={symbol.members.length}>
          <ul className="archmap-list">
            {symbol.members.map((entry, index) => {
              const label = `${MEMBER_ROLE_LABEL[memberRole(entry, symbol)]}: ${memberLabel(entry)}`;
              return (
                <li key={`${entry.kind}:${entry.name}:${index}`} title={label}>
                  {onSelectMember === undefined ? (
                    <code>{memberLabel(entry)}</code>
                  ) : (
                    <button
                      type="button"
                      className="archmap-link"
                      aria-label={`Inspect ${label}`}
                      aria-pressed={selectedMember === index}
                      onClick={() => onSelectMember(selectedMember === index ? null : index)}
                    >
                      <code>{memberLabel(entry)}</code>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {symbol.membersTruncated && (
            <p className="hint" role="note">
              Member list capped by the analyzer; the class declares more.
            </p>
          )}
          <p className="hint">Members have no own ranges in the analysis.</p>
        </Section>
      )}
      {symbol.unresolved.length > 0 && (
        <Section
          id="symbol-unresolved"
          title={`Unresolved (${symbol.unresolved.length}${symbol.unresolvedTruncated ? "+" : ""})`}
          count={null}
        >
          <ul className="archmap-list">
            {symbol.unresolved.map((ref, i) => (
              <li key={`${ref.kind}:${ref.toName}:${i}`}>
                <code>{ref.toName}</code>{" "}
                <span className="hint">
                  {ref.kind} · {ref.status}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section id="symbol-uses" title="Uses" count={outgoing.length}>
        {outgoing.length === 0 ? (
          <p className="hint">No detected relations from this symbol.</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((rel) => (
              <li key={rel.id}>
                <RelationRow
                  rel={rel}
                  otherId={rel.to}
                  otherName={rel.toName}
                  file={file}
                  symbolIndex={symbolIndex}
                  onSelectSymbol={onSelectSymbol}
                  onSelectFile={onSelectFile}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="symbol-used-by" title="Used by" count={incoming.length}>
        {incoming.length === 0 ? (
          <p className="hint">Nothing detected points at this symbol.</p>
        ) : (
          <ul className="archmap-list">
            {incoming.map((rel) => {
              const from = symbolIndex?.get(rel.from);
              return (
                <li key={rel.id}>
                  <RelationRow
                    rel={rel}
                    otherId={rel.from}
                    otherName={from?.name ?? rel.from}
                    file={file}
                    symbolIndex={symbolIndex}
                    onSelectSymbol={onSelectSymbol}
                    onSelectFile={onSelectFile}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </section>
  );
}

function MemberDetail({
  symbol,
  member,
  onClose,
}: {
  symbol: ArchMapSymbol;
  member: ArchMapSymbol["members"][number];
  onClose: (() => void) | undefined;
}) {
  const role = memberRole(member, symbol);
  const hook = symbol.lifecycle?.find((entry) => entry.name === member.name) ?? null;
  const modifiers = memberModifiers(member);
  const call = member.kind === "method";
  const parts = splitSignature(member.detail);
  return (
    <section className="archmap-member-detail" aria-label={`Member ${member.name}`}>
      <h4>
        <code>{member.name}</code>
      </h4>
      <dl className="archmap-facts">
        <dt>Role</dt>
        <dd>{MEMBER_ROLE_LABEL[role]}</dd>
        {hook !== null && (
          <>
            <dt>Hook</dt>
            <dd>
              {hook.framework} lifecycle · {hook.evidence}
            </dd>
          </>
        )}
        <dt>Visibility</dt>
        <dd>{member.visibility ?? "Not written (no modifier in the code)"}</dd>
        <dt>Modifiers</dt>
        <dd>{modifiers.length === 0 ? "None written" : modifiers.join(", ")}</dd>
        {call ? (
          <>
            <dt>Parameters</dt>
            <dd>
              <code>{parts.params === null || parts.params === "" ? "none" : parts.params}</code>
            </dd>
            <dt>Returns</dt>
            <dd>
              {parts.returns === null ? "Unknown (not annotated)" : <code>{parts.returns}</code>}
            </dd>
          </>
        ) : (
          <>
            <dt>{member.kind === "variant" ? "Declaration" : "Type / value"}</dt>
            <dd>
              {member.detail === "" ? "Unknown (not annotated)" : <code>{member.detail}</code>}
            </dd>
          </>
        )}
        <dt>Signature</dt>
        <dd>
          <code className="archmap-signature">{memberLabel(member)}</code>
        </dd>
      </dl>
      <p className="hint">
        As extracted: long parts are shortened with “…” by the analyzer. Members have no own
        ranges in the analysis.
      </p>
      {onClose !== undefined && (
        <div className="button-row">
          <button type="button" className="secondary small" onClick={onClose}>
            Back to members
          </button>
        </div>
      )}
    </section>
  );
}

function RelationRow({
  rel,
  otherId,
  otherName,
  file,
  symbolIndex,
  onSelectSymbol,
  onSelectFile,
}: {
  rel: StructureRelation;
  otherId: string | null;
  otherName: string;
  file: ArchMapFile;
  symbolIndex: Map<string, SymbolRef> | undefined;
  onSelectSymbol: (id: string | null) => void;
  onSelectFile: (rootId: string, rel: string) => void;
}) {
  const target = otherId === null ? undefined : symbolIndex?.get(otherId);
  const sameFile = target !== undefined && target.rootId === file.rootId && target.rel === file.rel;
  return (
    <>
      <span className="hint">
        {rel.kind} · {rel.status} ·{" "}
      </span>
      {target !== undefined ? (
        <button
          type="button"
          className="archmap-link"
          title={sameFile ? `Inspect ${target.name}` : `Open ${target.rel} and inspect ${target.name}`}
          onClick={() => {
            if (sameFile) onSelectSymbol(target.id);
            else {
              onSelectFile(target.rootId, target.rel);
              onSelectSymbol(target.id);
            }
          }}
        >
          <code>
            {target.kind} {target.name}
          </code>
        </button>
      ) : (
        <code>{otherName}</code>
      )}{" "}
      <span className="hint" title={rel.evidence}>
        {rel.evidence}
      </span>
    </>
  );
}

function EdgeButton({
  edge,
  other,
  onSelectFile,
}: {
  edge: ArchMapEdge;
  other: string;
  onSelectFile: (rootId: string, rel: string) => void;
}) {
  const kinds = edge.kinds.map((k) => (k.count > 1 ? `${k.kind}×${k.count}` : k.kind)).join(", ");
  return (
    <>
      <button
        type="button"
        className="archmap-link"
        title={edge.evidence}
        onClick={() => onSelectFile(edge.rootId, other)}
      >
        <code>{other.split("/").pop()}</code>
      </button>{" "}
      <span className="hint">{kinds}</span>
    </>
  );
}
