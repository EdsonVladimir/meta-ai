// Flow inspector: detail of the selected flow row. For a member it
// shows parameter types, the return type, outgoing edges and their
// evidence; for a bare node, the symbol and its chain members.
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { readCodeFile } from "../client";
import { CodeConflictDiff } from "../CodeConflictDiff";
import { DEFAULT_CODE_EDITOR_PREFS, type CodeEditorPrefs } from "../editorPrefs";
import { languageForFile } from "../model";
import type { MonacoApi } from "../monacoLoader";
import type { CodeProposalFileDto } from "../types";
import { memberSignalLines } from "./flowLayout";
import type { FlowEdge, FlowGraph, FlowPending } from "./flowModel";

export interface FlowInspectorProps {
  graph: FlowGraph;
  selected: { nodeId: string; member: string | null } | null;
  /** Proposed file backing the selection (absent = no decision here). */
  proposal?: {
    generationId: string;
    file: CodeProposalFileDto;
    staleReason: string | null;
  } | null;
  onAccept?: () => void;
  onDiscard?: () => void;
  /** Why the last accept or discard failed. */
  decisionError?: string | null;
  /** Opens real code at a member line (absent = no button). */
  onOpenCode?: (rootId: string, rel: string, line: number) => void;
  prefs?: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
}

/** Evidence keeps its file:line origin; the trailing note is dropped. */
function fileLine(evidence: string): string {
  return evidence.replace(/ \([^()]*\)$/, "");
}

function edgeTarget(graph: FlowGraph, edge: FlowEdge): string {
  const node = graph.nodes.find((entry) => entry.id === edge.toNode);
  if (node !== undefined) {
    const member = edge.toMember ?? edge.label;
    return member === undefined ? node.symbol.name : `${node.symbol.name}.${member}`;
  }
  const http = graph.httpNodes.find((entry) => entry.id === edge.toNode);
  if (http !== undefined) return `${http.verb} ${http.url ?? "(unknown url)"}`;
  return edge.toNode;
}

const PENDING_LABEL: Record<FlowPending["kind"], string> = {
  unresolved: "Unresolved",
  ambiguous: "Ambiguous",
  "no-destination": "No destination",
  cycle: "Cycle",
};

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="archmap-section">
      <h5 className="flow-inspector-title">{title}</h5>
      <div className="archmap-section-body">{children}</div>
    </div>
  );
}

function PendingList({ items }: { items: FlowPending[] }) {
  return (
    <ul className="archmap-list">
      {items.map((item, index) => (
        <li key={`${item.kind}:${item.label}:${index}`} title={item.evidence}>
          <strong>{PENDING_LABEL[item.kind]}:</strong> <code>{item.label}</code>
        </li>
      ))}
    </ul>
  );
}

type InspectorProposal = NonNullable<FlowInspectorProps["proposal"]>;

function ProposalDiffModal({
  proposal,
  prefs,
  loader,
  onClose,
}: {
  proposal: InspectorProposal;
  prefs: CodeEditorPrefs | undefined;
  loader: (() => Promise<MonacoApi>) | undefined;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (proposal.file.operation === "create") {
      setCurrent("");
      return;
    }
    let cancelled = false;
    readCodeFile(proposal.file.rootId, proposal.file.rel).then(
      (read) => {
        if (!cancelled && live.current) setCurrent(read.text);
      },
      () => {
        if (!cancelled && live.current) {
          setCurrent("");
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [proposal.file]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Proposed code"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Proposed code</h3>
          <button type="button" className="secondary small" onClick={onClose}>
            Close
          </button>
        </div>
        {current === null ? (
          <p className="hint">Reading the current file…</p>
        ) : (
          <>
            {failed && (
              <p className="hint">Could not read the current file; comparing against nothing.</p>
            )}
            <CodeConflictDiff
              key={`${proposal.generationId}:${proposal.file.pos}`}
              diskText={current}
              draftText={proposal.file.content}
              language={languageForFile(proposal.file.rel)}
              prefs={prefs ?? DEFAULT_CODE_EDITOR_PREFS}
              loader={loader}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ProposalActions({
  proposal,
  onAccept,
  onDiscard,
  onViewCode,
}: {
  proposal: InspectorProposal;
  onAccept: (() => void) | undefined;
  onDiscard: (() => void) | undefined;
  onViewCode: () => void;
}) {
  const stale = proposal.staleReason !== null;
  return (
    <Block title="Proposal">
      <p className="hint">
        {proposal.file.rel} · proposal {proposal.generationId}
      </p>
      {stale && (
        <p className="hint">
          Stale: {proposal.staleReason} Acceptance is blocked.
        </p>
      )}
      <div className="button-row">
        <button type="button" className="secondary small" onClick={onViewCode}>
          View code
        </button>
        <button
          type="button"
          className="secondary small"
          disabled={stale}
          title={stale ? `Stale: ${proposal.staleReason}` : undefined}
          onClick={() => onAccept?.()}
        >
          Accept
        </button>
        <button type="button" className="secondary small" onClick={() => onDiscard?.()}>
          Discard
        </button>
      </div>
    </Block>
  );
}

export function FlowInspector({
  graph,
  selected,
  proposal = null,
  onAccept,
  onDiscard,
  decisionError = null,
  onOpenCode,
  prefs,
  loader,
}: FlowInspectorProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  useEffect(() => {
    setDiffOpen(false);
  }, [proposal]);
  const node =
    selected === null ? undefined : graph.nodes.find((entry) => entry.id === selected.nodeId);
  const proposalBlock = (
    <>
      {decisionError !== null && (
        <p className="error" role="alert">
          {decisionError}
        </p>
      )}
      {proposal !== null && (
        <ProposalActions
          proposal={proposal}
          onAccept={onAccept}
          onDiscard={onDiscard}
          onViewCode={() => setDiffOpen(true)}
        />
      )}
    </>
  );
  const diffModal =
    diffOpen && proposal !== null ? (
      <ProposalDiffModal
        proposal={proposal}
        prefs={prefs}
        loader={loader}
        onClose={() => setDiffOpen(false)}
      />
    ) : null;
  if (node === undefined || selected === null) {
    return (
      <div className="archmap-inspector">
        {proposalBlock}
        <p className="hint">Select a chain row to inspect it.</p>
        {graph.pending.length > 0 && (
          <Block title="Pending">
            <PendingList items={graph.pending} />
          </Block>
        )}
        {diffModal}
      </div>
    );
  }
  const { symbol } = node;
  if (selected.member === null) {
    return (
      <section className="archmap-inspector" aria-label={`Flow detail of ${symbol.name}`}>
        <h4>{symbol.name}</h4>
        <p className="hint">
          {symbol.kind} · {symbol.rel}
        </p>
        {proposalBlock}
        <Block title="Members">
          {node.members.length === 0 ? (
            <p className="hint">None</p>
          ) : (
            <ul className="archmap-list">
              {node.members.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          )}
        </Block>
        {diffModal}
      </section>
    );
  }
  const member = symbol.members.find((entry) => entry.name === selected.member);
  const params = member?.paramTypes ?? [];
  const outgoing = graph.edges.filter(
    (edge) => edge.fromNode === node.id && edge.fromMember === selected.member,
  );
  const signals = memberSignalLines(node, selected.member);
  const pending = graph.pending.filter(
    (item) => item.fromNode === node.id && item.fromMember === selected.member,
  );
  const memberLine = member?.range?.startLine;
  return (
    <section
      className="archmap-inspector"
      aria-label={`Flow detail of ${symbol.name}.${selected.member}`}
    >
      <h4>
        {symbol.name}.{selected.member}
      </h4>
      {onOpenCode !== undefined && memberLine !== undefined && node.change === undefined && (
        <div className="button-row">
          <button
            type="button"
            className="secondary small"
            onClick={() => onOpenCode(symbol.rootId, symbol.rel, memberLine)}
          >
            Open in code
          </button>
        </div>
      )}
      {proposalBlock}
      <Block title="Inputs">
        {params.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {params.map((type, index) => (
              <li key={`${type}:${index}`}>
                <code>{type}</code>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Output">
        <p className="hint">{member?.returnType ?? "Unknown (not annotated)"}</p>
      </Block>
      <Block title="Relations">
        {outgoing.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((edge) => (
              <li key={edge.id} title={edge.evidence}>
                <code>
                  {edge.kind} → {edgeTarget(graph, edge)}
                </code>
              </li>
            ))}
          </ul>
        )}
      </Block>
      {signals.length > 0 && (
        <Block title="State">
          <ul className="archmap-list">
            {signals.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Block>
      )}
      {pending.length > 0 && (
        <Block title="Pending">
          <PendingList items={pending} />
        </Block>
      )}
      <Block title="Evidence">
        {outgoing.length === 0 ? (
          <p className="hint">None</p>
        ) : (
          <ul className="archmap-list">
            {outgoing.map((edge) => (
              <li key={edge.id} title={edge.evidence}>
                <code>{fileLine(edge.evidence)}</code>
              </li>
            ))}
          </ul>
        )}
      </Block>
      {diffModal}
    </section>
  );
}
