// Active-file status bar: cursor, selection, lines, encoding and
// highlight language. Read-only, except the picker.
import type { ReactNode } from "react";
import type { EditorCursor } from "./CodeEditor";

export function cursorStatusText(cursor: EditorCursor | null): string {
  if (cursor === null) return "Ln –, Col –";
  const selection =
    cursor.selectedChars > 0 ? ` (${cursor.selectedChars} selected)` : "";
  return `Ln ${cursor.line}, Col ${cursor.column}${selection}`;
}

export function linesStatusText(cursor: EditorCursor | null): string {
  if (cursor === null || cursor.lineCount === null) return "– lines";
  return `${cursor.lineCount} lines`;
}

interface CodeStatusBarProps {
  cursor: EditorCursor | null;
  languageControl: ReactNode;
}

export function CodeStatusBar({ cursor, languageControl }: CodeStatusBarProps) {
  return (
    <footer className="code-statusbar" aria-label="File status">
      <span className="code-status-cursor" title="Cursor position">
        {cursorStatusText(cursor)}
      </span>
      <span className="code-status-lines" title="Open model lines">
        {linesStatusText(cursor)}
      </span>
      <span className="code-status-encoding" title="Reading only supports UTF-8">
        UTF-8
      </span>
      <span className="code-status-language">{languageControl}</span>
    </footer>
  );
}
