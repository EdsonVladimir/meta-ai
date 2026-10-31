// Muse dialog on a folder, file or component: a chat thread with a
// pinned composer. Ruth picks what Muse reads and says how much; the
// list stays one click away. Ask answers and changes nothing, sending
// the previous turns as history; Propose saves the message as a
// requirement and hands it to the proposal flow, so AI output stays a
// separate proposal. The thread lives in memory only.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  askCode,
  listCodeDir,
  normalizeCodeError,
  setRootProject,
  type AskTurnInput,
} from "../code/client";
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
import { MarkdownLite } from "./markdownLite";
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

interface Message {
  id: number;
  role: "user" | "muse";
  text: string;
}

interface FailedAsk {
  question: string;
  files: MuseFile[];
  history: AskTurnInput[];
  error: string;
}

type Busy = "ask" | "propose" | null;

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

/** Completed question/answer pairs, oldest first, for the next Ask. */
function historyOf(messages: Message[]): AskTurnInput[] {
  const turns: AskTurnInput[] = [];
  for (let index = 0; index + 1 < messages.length; index += 1) {
    const first = messages[index];
    const second = messages[index + 1];
    if (first.role === "user" && second.role === "muse") {
      turns.push({ question: first.text, answer: second.text });
    }
  }
  return turns;
}

export function MusePanel({ target, roots, onClose, onPropose, api = defaultApi }: MusePanelProps) {
  const root = roots.find((entry) => entry.id === target.rootId) ?? null;
  const [candidates, setCandidates] = useState<MuseFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  /** Null until the person changes the files: Ruth keeps choosing. */
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [failed, setFailed] = useState<FailedAsk | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;
  const idRef = useRef(0);
  /** A reply for a previous target or a cleared thread is dropped. */
  const threadRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stale = false;
    threadRef.current += 1;
    setCandidates(null);
    setNotice(null);
    setMessages([]);
    setFailed(null);
    collectMuseFiles(target, apiRef.current.listDir)
      .then((found) => {
        if (stale) return;
        setCandidates(found.files);
        setTruncated(found.truncated);
        setChosen(null);
        setShowFiles(false);
      })
      .catch((raw) => {
        if (!stale) setNotice(reason(raw));
      });
    return () => {
      stale = true;
    };
  }, [target]);

  useEffect(() => {
    const end = endRef.current;
    if (end !== null && typeof end.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end" });
    }
  }, [messages, busy, failed]);

  const blocked = root?.aiBlocked ?? false;
  const all = candidates ?? [];
  const files =
    chosen === null ? pickMuseFiles(all, text) : all.filter((file) => chosen.has(file.rel));
  const picked = new Set(files.map((file) => file.rel));
  const canSend =
    busy === null && !blocked && root !== null && text.trim() !== "" && files.length > 0;

  function toggle(rel: string): void {
    const next = new Set(picked);
    if (!next.delete(rel)) next.add(rel);
    setChosen(next);
  }

  function appendMessage(role: "user" | "muse", message: string): void {
    idRef.current += 1;
    const id = idRef.current;
    setMessages((prev) => [...prev, { id, role, text: message }]);
  }

  async function runAsk(
    question: string,
    askFiles: MuseFile[],
    history: AskTurnInput[],
    showQuestion: boolean,
  ): Promise<void> {
    if (showQuestion) appendMessage("user", question);
    const thread = threadRef.current;
    setBusy("ask");
    setFailed(null);
    setNotice(null);
    const others = all.filter((file) => !askFiles.includes(file)).map((file) => file.rel);
    const sent =
      others.length === 0
        ? question
        : `${question}\n\nAlso in this folder, not included: ${others.join(", ")}`;
    try {
      const reply = await api.ask(sent, askFiles, history);
      if (thread === threadRef.current) appendMessage("muse", reply.answer);
    } catch (raw) {
      if (thread === threadRef.current) {
        setFailed({ question, files: askFiles, history, error: reason(raw) });
      }
    } finally {
      setBusy(null);
    }
  }

  async function sendQuestion(raw: string): Promise<void> {
    if (root === null) return;
    const message = raw.trim();
    if (message === "" || files.length === 0) return;
    setText("");
    await runAsk(message, files, historyOf(messages), true);
  }

  function retry(): void {
    if (failed === null || busy !== null) return;
    void runAsk(failed.question, failed.files, failed.history, false);
  }

  async function sendProposal(raw: string): Promise<void> {
    if (root === null) return;
    const message = raw.trim();
    if (message === "") return;
    setBusy("propose");
    setNotice(null);
    try {
      const { projectId, moduleId } = await linkMuseTarget(target, root, api);
      const created = await api.createRequirement({
        projectId,
        moduleId,
        content: message,
        author: "Muse dialog",
      });
      onPropose({ projectId, moduleId, requirementId: created.artifact.id, files });
      setText("");
    } catch (raw) {
      setNotice(reason(raw));
    } finally {
      setBusy(null);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (canSend) void sendQuestion(text);
    }
  }

  function clearConversation(): void {
    threadRef.current += 1;
    setMessages([]);
    setFailed(null);
    setNotice(null);
  }

  /** The question a Muse message answers: its nearest user message above. */
  function questionOf(index: number): string {
    for (let at = index - 1; at >= 0; at -= 1) {
      if (messages[at].role === "user") return messages[at].text;
    }
    return "";
  }

  const label = target.rel === "" ? (root?.name ?? target.rootId) : target.rel;
  return (
    <section className="muse-panel" aria-label="Muse dialog">
      <div className="muse-target">
        <code title={label}>{label}</code>
        <span className="muse-actions">
          <button
            type="button"
            className="secondary small"
            aria-label="Clear conversation"
            title="Clear the conversation. It lives in memory only."
            disabled={busy !== null || (messages.length === 0 && failed === null)}
            onClick={clearConversation}
          >
            Clear
          </button>
          <button
            type="button"
            className="secondary small"
            aria-label="Close Muse dialog"
            onClick={onClose}
          >
            ×
          </button>
        </span>
      </div>
      {blocked ? (
        <p className="error" role="alert">
          This folder is marked to never be sent to Muse. Nothing leaves this machine.
        </p>
      ) : (
        <>
          <div className="muse-thread" role="log" aria-label="Conversation with Muse">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <div key={message.id} className="muse-message muse-message-user">
                  <p className="muse-question">{message.text}</p>
                </div>
              ) : (
                <div key={message.id} className="muse-message muse-message-muse">
                  <div className="muse-md">
                    <MarkdownLite text={message.text} />
                  </div>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={busy !== null}
                    onClick={() => void sendProposal(questionOf(index))}
                  >
                    Propose this as a change
                  </button>
                </div>
              ),
            )}
            {busy === "ask" && <div className="muse-message muse-working">Working…</div>}
            {failed !== null && (
              <div className="muse-error-row" role="alert">
                <span className="error">{failed.error}</span>
                <button
                  type="button"
                  className="secondary small"
                  disabled={busy !== null}
                  onClick={retry}
                >
                  Retry
                </button>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <div className="muse-composer">
            {notice !== null && (
              <p className="error" role="alert">
                {notice}
              </p>
            )}
            {candidates === null && notice === null && <p className="hint">Reading the folder…</p>}
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
              onKeyDown={onComposerKeyDown}
            />
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={!canSend}
                title="Muse explains from these files. Nothing changes. Ctrl+Enter sends."
                onClick={() => void sendQuestion(text)}
              >
                Ask
              </button>
              <button
                type="button"
                disabled={!canSend}
                title="Saved as a requirement. The code arrives as a proposal you review."
                onClick={() => void sendProposal(text)}
              >
                Propose change
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
