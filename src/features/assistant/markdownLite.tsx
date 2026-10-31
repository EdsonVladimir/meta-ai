// Lite markdown for Muse answers. React nodes only, never raw HTML,
// so model output cannot inject markup or scripts. Supported:
// headings, **bold**, `inline code`, fenced code blocks, ordered and
// unordered lists, paragraphs. Anything else stays plain text.
import type { ReactNode } from "react";

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "code"; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: string[] }
  | { kind: "para"; lines: string[] };

const HEADING = /^(#{1,6})\s+(\S.*)$/;
const UNORDERED_ITEM = /^[-*+]\s+(\S.*)$/;
const ORDERED_ITEM = /^(\d{1,9})[.)]\s+(\S.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; start: number; items: string[] } | null = null;
  let code: string[] | null = null;
  function flush(): void {
    if (para.length > 0) {
      blocks.push({ kind: "para", lines: para });
      para = [];
    }
    if (list !== null) {
      blocks.push({ kind: "list", ordered: list.ordered, start: list.start, items: list.items });
      list = null;
    }
  }
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (code === null) {
        flush();
        code = [];
      } else {
        blocks.push({ kind: "code", text: code.join("\n") });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (trimmed === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    const unordered = UNORDERED_ITEM.exec(trimmed);
    if (unordered !== null) {
      if (para.length > 0) flush();
      if (list === null || list.ordered) {
        flush();
        list = { ordered: false, start: 1, items: [] };
      }
      list.items.push(unordered[1]);
      continue;
    }
    const ordered = ORDERED_ITEM.exec(trimmed);
    if (ordered !== null) {
      if (para.length > 0) flush();
      if (list === null || !list.ordered) {
        flush();
        list = { ordered: true, start: Number(ordered[1]), items: [] };
      }
      list.items.push(ordered[2]);
      continue;
    }
    if (list !== null) flush();
    para.push(trimmed);
  }
  if (code !== null) blocks.push({ kind: "code", text: code.join("\n") });
  flush();
  return blocks;
}

/** Inline spans on one line: **bold** and `code`. Unclosed or empty markers stay literal. */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  while (rest !== "") {
    const codeAt = rest.indexOf("`");
    const boldAt = rest.indexOf("**");
    const kind = codeAt !== -1 && (boldAt === -1 || codeAt < boldAt) ? "code" : "bold";
    const at = kind === "code" ? codeAt : boldAt;
    if (at === -1) {
      nodes.push(rest);
      break;
    }
    const marker = kind === "code" ? "`" : "**";
    const from = at + marker.length;
    const end = rest.indexOf(marker, from);
    if (end === -1 || end === from) {
      nodes.push(rest.slice(0, from));
      rest = rest.slice(from);
      continue;
    }
    if (at > 0) nodes.push(rest.slice(0, at));
    const content = rest.slice(from, end);
    const key = nodes.length;
    nodes.push(
      kind === "code" ? <code key={key}>{content}</code> : <strong key={key}>{content}</strong>,
    );
    rest = rest.slice(end + marker.length);
  }
  return nodes;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderInline(block.text)}</Tag>;
    }
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, index) => <li key={index}>{renderInline(item)}</li>);
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "para":
      return (
        <p key={key}>
          {block.lines.map((line, index) =>
            index === 0 ? (
              <span key={index}>{renderInline(line)}</span>
            ) : (
              <span key={index}>
                <br />
                {renderInline(line)}
              </span>
            ),
          )}
        </p>
      );
  }
}

export function MarkdownLite({ text }: { text: string }): ReactNode {
  return <>{parseBlocks(text).map((block, index) => renderBlock(block, index))}</>;
}
