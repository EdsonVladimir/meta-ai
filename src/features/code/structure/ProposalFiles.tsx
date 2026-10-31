// Reviewable files of a code proposal: per-file current↔proposed
// diff, Accept (writes to disk with a fingerprint) and Discard.
// Shared by the proposal dialog and the Muse thread with identical
// behavior. It never generates and never writes without an explicit
// click.
import { useEffect, useRef, useState } from "react";
import { CodeConflictDiff } from "../CodeConflictDiff";
import { normalizeCodeError } from "../client";
import type {
  CodeAcceptDto,
  CodeFileDto,
  CodeGenerationDto,
  CodeProposalFileDto,
} from "../types";
import type { MonacoApi } from "../monacoLoader";
import type { CodeEditorPrefs } from "../editorPrefs";
import { languageForFile } from "../model";

export interface ProposalFilesApi {
  acceptFile: (generationId: string, pos: number) => Promise<CodeAcceptDto>;
  discardFile: (generationId: string, pos: number) => Promise<CodeGenerationDto>;
  readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
}

interface ProposalFilesProps {
  generation: CodeGenerationDto;
  rootNames: Record<string, string>;
  api: ProposalFilesApi;
  prefs: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
  /** Updated generation after each accept or discard. */
  onChange: (generation: CodeGenerationDto) => void;
  /** A file was written to disk (not on already-accepted repeats). */
  onAccepted: (rootId: string, rel: string) => void;
  /** Replaced cards: files listed without actions. */
  readOnly?: boolean;
}

export function ProposalFiles({
  generation,
  rootNames,
  api,
  prefs,
  loader,
  onChange,
  onAccepted,
  readOnly = false,
}: ProposalFilesProps) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [currentTexts, setCurrentTexts] = useState<Record<number, string>>({});
  const [busyPos, setBusyPos] = useState<number | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function toggleDiff(file: CodeProposalFileDto): Promise<void> {
    if (expanded === file.pos) {
      setExpanded(null);
      return;
    }
    setExpanded(file.pos);
    if (file.operation === "create" || currentTexts[file.pos] !== undefined) return;
    try {
      const read = await api.readFile(file.rootId, file.rel);
      if (!live.current) return;
      setCurrentTexts((prev) => ({ ...prev, [file.pos]: read.text }));
    } catch (raw) {
      if (!live.current) return;
      setCurrentTexts((prev) => ({ ...prev, [file.pos]: "" }));
      setFileNotice(`Could not read the current file: ${normalizeCodeError(raw).message}`);
    }
  }

  async function accept(file: CodeProposalFileDto): Promise<void> {
    setBusyPos(file.pos);
    setOpError(null);
    setFileNotice(null);
    try {
      const outcome = await api.acceptFile(generation.id, file.pos);
      if (!live.current) return;
      onChange(outcome.generation);
      if (outcome.alreadyAccepted) {
        setFileNotice(`"${file.rel}" was already accepted; not written again.`);
      } else {
        setFileNotice(
          `"${file.rel}" written to disk (fingerprint ${outcome.fingerprint ?? "?"}). Re-analyze to see the change.`,
        );
        onAccepted(file.rootId, file.rel);
      }
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setBusyPos(null);
    }
  }

  /**
   * One click decides what the button names: pending files in order. It
   * stops at the first failure, so nothing after it is written without
   * the person seeing why, and what it left pending can still be decided.
   */
  async function acceptAll(): Promise<void> {
    const total = pending.length;
    let written = 0;
    setOpError(null);
    setFileNotice(null);
    for (const file of pending) {
      setBusyPos(file.pos);
      try {
        const outcome = await api.acceptFile(generation.id, file.pos);
        if (!live.current) return;
        onChange(outcome.generation);
        if (!outcome.alreadyAccepted) onAccepted(file.rootId, file.rel);
        written += 1;
      } catch (raw) {
        if (!live.current) return;
        setBusyPos(null);
        setOpError(
          `Stopped at "${file.rel}": ${normalizeCodeError(raw).message} ${written} of ${total} accepted; the rest stay pending.`,
        );
        return;
      }
    }
    if (!live.current) return;
    setBusyPos(null);
    setFileNotice(`${written} files written to disk.`);
  }

  async function discard(file: CodeProposalFileDto): Promise<void> {
    setBusyPos(file.pos);
    setOpError(null);
    setFileNotice(null);
    try {
      const updated = await api.discardFile(generation.id, file.pos);
      if (!live.current) return;
      onChange(updated);
      setFileNotice(`"${file.rel}" discarded.`);
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setBusyPos(null);
    }
  }

  const pending = generation.files.filter((file) => file.state === "pending");

  return (
    <>
      {!readOnly && pending.length > 1 && (
        <div className="button-row">
          <button
            type="button"
            className="primary small"
            disabled={generation.stale || busyPos !== null}
            title={
              generation.stale
                ? "Blocked: the proposal is stale"
                : "Write every pending file to disk, in order. Stops at the first failure."
            }
            onClick={() => void acceptAll()}
          >
            {`Accept all (${pending.length})`}
          </button>
        </div>
      )}
      {opError !== null && (
        <p className="error" role="alert">
          {opError}
        </p>
      )}
      {fileNotice !== null && (
        <p className="hint" role="status">
          {fileNotice}
        </p>
      )}
      <ul className="code-proposal-files">
        {generation.files.map((file) => (
          <li key={file.pos} className="code-proposal-file">
            <div className="code-proposal-file-head">
              <code>
                {file.operation === "create" ? "+" : "~"} {rootNames[file.rootId] ?? file.rootId}/
                {file.rel}
              </code>{" "}
              <span className="hint">
                {file.operation === "create" ? "create" : "modify"} · {file.state}
                {file.decidedAt !== null ? ` · ${file.decidedAt}` : ""}
              </span>
            </div>
            {!readOnly && (
              <div className="button-row">
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => void toggleDiff(file)}
                >
                  {expanded === file.pos ? "Hide diff" : "View diff"}
                </button>
                <button
                  type="button"
                  className="primary small"
                  disabled={file.state !== "pending" || generation.stale || busyPos !== null}
                  title={
                    generation.stale
                      ? "Blocked: the proposal is stale"
                      : file.state !== "pending"
                        ? `Already ${file.state === "accepted" ? "accepted" : "discarded"}`
                        : file.operation === "create"
                          ? "Create the file on disk"
                          : "Replace the file on disk"
                  }
                  onClick={() => void accept(file)}
                >
                  {busyPos === file.pos ? "Accepting…" : "Accept"}
                </button>
                <button
                  type="button"
                  className="secondary small"
                  disabled={file.state !== "pending" || busyPos !== null}
                  onClick={() => void discard(file)}
                >
                  Discard
                </button>
              </div>
            )}
            {expanded === file.pos && !readOnly && (
              <div className="code-proposal-diff">
                {file.operation === "modify" && currentTexts[file.pos] === undefined ? (
                  <p className="hint">Reading the current file…</p>
                ) : (
                  <CodeConflictDiff
                    key={`${generation.id}:${file.pos}`}
                    diskText={currentTexts[file.pos] ?? ""}
                    draftText={file.content}
                    language={languageForFile(file.rel)}
                    prefs={prefs}
                    loader={loader}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
