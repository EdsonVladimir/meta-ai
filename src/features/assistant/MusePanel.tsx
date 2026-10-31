// Muse dialog on a folder, file or component. Ruth picks what Muse reads
// and says how much; the list stays one click away. Ask answers and
// changes nothing; Propose saves the message as a requirement and hands
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
  pickMuseFiles,
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
  /** Null until the person changes the files: Ruth keeps choosing. */
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [showFiles, setShowFiles] = useState(false);
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
        setChosen(null);
        setShowFiles(false);
      })
      .catch((raw) => {
        if (!stale) setError(reason(raw));
      });
    return () => {
      stale = true;
    };
  }, [target]);

  const blocked = root?.aiBlocked ?? false;
  const all = candidates ?? [];
  const files =
    chosen === null ? pickMuseFiles(all, text) : all.filter((file) => chosen.has(file.rel));
  const picked = new Set(files.map((file) => file.rel));
  const canSend = !busy && !blocked && root !== null && text.trim() !== "" && files.length > 0;

  function toggle(rel: string): void {
    const next = new Set(picked);
    if (!next.delete(rel)) next.add(rel);
    setChosen(next);
  }

  async function send(mode: "ask" | "propose", raw: string): Promise<void> {
    if (root === null) return;
    const message = raw.trim();
    setBusy(true);
    setError(null);
    try {
      if (mode === "ask") {
        const others = all.filter((file) => !picked.has(file.rel)).map((file) => file.rel);
        const question =
          others.length === 0
            ? message
            : `${message}\n\nAlso in this folder, not included: ${others.join(", ")}`;
        const reply = await api.ask(question, files);
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
            <div className="muse-reads">
              <span className="hint" role="status">
                {`Muse reads ${files.length} of ${candidates.length}${truncated ? "+" : ""} files here.`}
              </span>
              <button
                type="button"
                className="secondary small"
                aria-expanded={showFiles}
                onClick={() => setShowFiles((prev) => !prev)}
              >
                {showFiles ? "Hide files" : "Change files"}
              </button>
            </div>
          )}
          {showFiles && (
            <ul className="muse-files" aria-label="Files sent to Muse">
              {all.map((file) => (
                <li key={file.rel}>
                  <label title={file.rel}>
                    <input
                      type="checkbox"
                      checked={picked.has(file.rel)}
                      disabled={!picked.has(file.rel) && files.length >= MUSE_MAX_FILES}
                      onChange={() => toggle(file.rel)}
                    />
                    {file.rel}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <textarea
            aria-label="Message to Muse"
            value={text}
            placeholder="Ask about this code, or describe what should change."
            onChange={(event) => setText(event.target.value)}
          />
          <div className="button-row">
            <button
              type="button"
              className="secondary"
              disabled={!canSend}
              title="Muse explains from these files. Nothing changes."
              onClick={() => void send("ask", text)}
            >
              {busy ? "Working…" : "Ask"}
            </button>
            <button
              type="button"
              disabled={!canSend}
              title="Saved as a requirement. The code arrives as a proposal you review."
              onClick={() => void send("propose", text)}
            >
              Propose change
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
          <button
            type="button"
            className="secondary small"
            disabled={busy || blocked}
            onClick={() => void send("propose", turn.question)}
          >
            Propose this as a change
          </button>
        </div>
      ))}
    </section>
  );
}
