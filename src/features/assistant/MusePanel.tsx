// Muse dialog on a folder, file or component. Everything that leaves the
// machine is listed first. Ask answers from the checked files and
// changes nothing; Propose saves the request as a requirement and hands
// it to the proposal flow, so AI output stays a separate proposal.
import { useEffect, useRef, useState } from "react";
import { askCode, listCodeDir, normalizeCodeError, setRootProject } from "../code/client";
import type { CodeRootDto } from "../code/types";
import {
  createModule,
  createProject,
  createRequirement,
  listModules,
  renameModule,
  renameProject,
} from "../requirements/client";
import type { MuseTarget } from "../requirements/uiStore";
import {
  collectMuseFiles,
  linkMuseTarget,
  MUSE_MAX_FILES,
  type MuseFile,
  type MuseLinkDeps,
} from "./museFlow";

export interface MusePanelApi extends MuseLinkDeps {
  listDir: (rootId: string, rel: string) => ReturnType<typeof listCodeDir>;
  ask: typeof askCode;
  createRequirement: (input: {
    projectId: string;
    moduleId: string;
    content: string;
    author: string;
  }) => Promise<{ artifact: { id: string } }>;
}

const defaultApi: MusePanelApi = {
  listDir: listCodeDir,
  ask: askCode,
  createRequirement,
  listModules,
  createProject,
  renameProject: (projectId, expectedName, name) =>
    renameProject({ projectId, expectedName, name }),
  setRootProject,
  createModule,
  renameModule: (projectId, moduleId, expectedName, name) =>
    renameModule({ projectId, moduleId, expectedName, name }),
};

interface Turn {
  question: string;
  answer: string;
}

interface MusePanelProps {
  target: MuseTarget;
  roots: CodeRootDto[];
  onClose: () => void;
  /** Requirement saved: the workspace opens the proposal. */
  onPropose: (request: {
    projectId: string;
    moduleId: string;
    requirementId: string;
    files: MuseFile[];
  }) => void;
  api?: MusePanelApi;
}

function reason(raw: unknown): string {
  return normalizeCodeError(raw).message;
}

export function MusePanel({ target, roots, onClose, onPropose, api = defaultApi }: MusePanelProps) {
  const root = roots.find((entry) => entry.id === target.rootId) ?? null;
  const [candidates, setCandidates] = useState<MuseFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"ask" | "propose">("ask");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    let stale = false;
    setCandidates(null);
    setError(null);
    setTurns([]);
    collectMuseFiles(target, apiRef.current.listDir)
      .then((found) => {
        if (stale) return;
        setCandidates(found.files);
        setTruncated(found.truncated);
        setChecked(new Set(found.files.slice(0, MUSE_MAX_FILES).map((file) => file.rel)));
      })
      .catch((raw) => {
        if (!stale) setError(reason(raw));
      });
    return () => {
      stale = true;
    };
  }, [target]);

  const blocked = root?.aiBlocked ?? false;
  const files = (candidates ?? []).filter((file) => checked.has(file.rel));
  const canSend = !busy && !blocked && root !== null && text.trim() !== "" && files.length > 0;

  function toggle(rel: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(rel)) next.add(rel);
      return next;
    });
  }

  async function send(): Promise<void> {
    if (root === null) return;
    const message = text.trim();
    setBusy(true);
    setError(null);
    try {
      if (mode === "ask") {
        const reply = await api.ask(message, files);
        setTurns((prev) => [...prev, { question: message, answer: reply.answer }]);
      } else {
        const { projectId, moduleId } = await linkMuseTarget(target, root, api);
        const created = await api.createRequirement({
          projectId,
          moduleId,
          content: message,
          author: "Muse dialog",
        });
        onPropose({ projectId, moduleId, requirementId: created.artifact.id, files });
      }
      setText("");
    } catch (raw) {
      setError(reason(raw));
    } finally {
      setBusy(false);
    }
  }

  const label = target.rel === "" ? (root?.name ?? target.rootId) : target.rel;
  return (
    <section className="muse-panel" aria-label="Muse dialog">
      <div className="muse-target">
        <code title={label}>{label}</code>
        <button
          type="button"
          className="secondary small"
          aria-label="Close Muse dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {blocked ? (
        <p className="error" role="alert">
          This folder is marked to never be sent to Muse. Nothing leaves this machine.
        </p>
      ) : (
        <>
          {candidates === null && error === null && <p className="hint">Reading the folder…</p>}
          {candidates !== null && candidates.length === 0 && (
            <p className="hint">No source files here.</p>
          )}
          {candidates !== null && candidates.length > 0 && (
            <>
              <p className="hint" role="status">
                {`Muse will read ${files.length} of ${candidates.length}${truncated ? "+" : ""} files (up to ${MUSE_MAX_FILES}).`}
              </p>
              <ul className="muse-files" aria-label="Files sent to Muse">
                {candidates.map((file) => (
                  <li key={file.rel}>
                    <label title={file.rel}>
                      <input
                        type="checkbox"
                        checked={checked.has(file.rel)}
                        disabled={!checked.has(file.rel) && files.length >= MUSE_MAX_FILES}
                        onChange={() => toggle(file.rel)}
                      />
                      {file.rel}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="muse-modes" role="radiogroup" aria-label="What Muse does">
            <label title="Muse explains from these files. Nothing changes.">
              <input
                type="radio"
                checked={mode === "ask"}
                onChange={() => setMode("ask")}
              />
              Ask
            </label>
            <label title="Saved as a requirement. The change arrives as a proposal you review.">
              <input
                type="radio"
                checked={mode === "propose"}
                onChange={() => setMode("propose")}
              />
              Propose change
            </label>
          </div>
          <textarea
            aria-label="Message to Muse"
            value={text}
            placeholder={
              mode === "ask" ? "What do you want to know?" : "What should change, and why?"
            }
            onChange={(event) => setText(event.target.value)}
          />
          <div className="button-row">
            <button type="button" disabled={!canSend} onClick={() => void send()}>
              {busy ? "Working…" : mode === "ask" ? "Ask Muse" : "Save and propose"}
            </button>
          </div>
        </>
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {turns.map((turn, index) => (
        <div key={index} className="muse-turn">
          <p className="hint">{turn.question}</p>
          <p className="muse-answer">{turn.answer}</p>
        </div>
      ))}
    </section>
  );
}
