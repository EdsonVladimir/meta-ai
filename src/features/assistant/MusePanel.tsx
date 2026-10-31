// Muse dialog on a folder, file or component: a chat thread with a
// pinned composer. Ruth picks what Muse reads and says how much; the
// list stays one click away. Ask answers and changes nothing, sending
// the previous turns as history; Propose saves the message as a
// requirement, generates the proposal in the thread and hands it to
// the X-ray, so AI output stays a separate proposal. The thread lives
// in memory only.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  acceptCodeFile,
  askCode,
  discardCodeFile,
  generateCode,
  listCodeDir,
  normalizeCodeError,
  readCodeFile,
  setRootProject,
  type AskTurnInput,
  type CodeGenRequest,
} from "../code/client";
import type {
  CodeAcceptDto,
  CodeFileDto,
  CodeGenerationDto,
  CodeRootDto,
} from "../code/types";
import { DEFAULT_CODE_EDITOR_PREFS, type CodeEditorPrefs } from "../code/editorPrefs";
import { loadMonaco, type MonacoApi } from "../code/monacoLoader";
import { ProposalFiles } from "../code/structure/ProposalFiles";
import {
  createModule,
  createProject,
  createRequirement,
  listModules,
  renameModule,
  renameProject,
} from "../requirements/client";
import { useRequirementsUi, type MuseTarget } from "../requirements/uiStore";
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
  generate: (input: CodeGenRequest) => Promise<CodeGenerationDto>;
  acceptFile: (generationId: string, pos: number) => Promise<CodeAcceptDto>;
  discardFile: (generationId: string, pos: number) => Promise<CodeGenerationDto>;
  readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
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
  generate: generateCode,
  acceptFile: acceptCodeFile,
  discardFile: discardCodeFile,
  readFile: readCodeFile,
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

interface UserMessage {
  id: number;
  role: "user";
  text: string;
}

interface MuseMessage {
  id: number;
  role: "muse";
  text: string;
}

interface ProposalMessage {
  id: number;
  role: "proposal";
  generation: CodeGenerationDto;
}

type Message = UserMessage | MuseMessage | ProposalMessage;

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
  /** Stays mounted while another tab shows: the thread must survive. */
  hidden?: boolean;
  /** Proposal generated: the workspace shows it on the X-ray, no dialog. */
  onPropose: (generation: CodeGenerationDto) => void;
  api?: MusePanelApi;
  prefs?: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
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
    if (first.role !== "user") continue;
    if (second.role === "muse") turns.push({ question: first.text, answer: second.text });
    if (second.role === "proposal") {
      const rels = second.generation.files.map((file) => file.rel).join(", ");
      turns.push({
        question: first.text,
        answer: `${second.generation.explanation}\nProposed files: ${rels}`,
      });
    }
  }
  return turns;
}

export function MusePanel({
  target,
  roots,
  onClose,
  hidden = false,
  onPropose,
  api = defaultApi,
  prefs = DEFAULT_CODE_EDITOR_PREFS,
  loader = loadMonaco,
}: MusePanelProps) {
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
    // By value: asking again about the same folder keeps the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.rootId, target.rel, target.kind]);

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
  const rootNames = Object.fromEntries(roots.map((entry) => [entry.id, entry.name]));
  /** A decision taken on the X-ray reaches the card through the store. */
  const museGeneration = useRequirementsUi((s) => s.museGeneration);
  const latest = (generation: CodeGenerationDto): CodeGenerationDto =>
    museGeneration?.id === generation.id ? museGeneration : generation;
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
    const entry: Message =
      role === "user" ? { id, role, text: message } : { id, role, text: message };
    setMessages((prev) => [...prev, entry]);
  }

  function appendProposal(generation: CodeGenerationDto): void {
    idRef.current += 1;
    const id = idRef.current;
    setMessages((prev) => [...prev, { id, role: "proposal", generation }]);
  }

  /** An accept or discard in the thread: the turn and the X-ray stay in sync. */
  function updateProposal(id: number, generation: CodeGenerationDto): void {
    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === id && entry.role === "proposal" ? { ...entry, generation } : entry,
      ),
    );
    useRequirementsUi.getState().setMuseGeneration(generation);
  }

  /** A file written from the thread: the X-ray re-reads it. */
  function proposalAccepted(rootId: string, rel: string): void {
    const ui = useRequirementsUi.getState();
    ui.setMuseAccepted({ rootId, rel, nonce: (ui.museAccepted?.nonce ?? 0) + 1 });
  }

  function showOnXray(generation: CodeGenerationDto): void {
    useRequirementsUi.getState().setMuseGeneration(generation);
    onPropose(generation);
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
    const thread = threadRef.current;
    appendMessage("user", message);
    setText("");
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
      const generation = await api.generate({
        projectId,
        moduleId,
        source: { kind: "requirement", artifactId: created.artifact.id },
        scope: files,
      });
      if (thread !== threadRef.current) return;
      appendProposal(generation);
      showOnXray(generation);
    } catch (raw) {
      if (thread === threadRef.current) setNotice(reason(raw));
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
    useRequirementsUi.getState().setMuseGeneration(null);
    setMessages([]);
    setFailed(null);
    setNotice(null);
  }

  /** The question a Muse message answers: its nearest user message above. */
  function questionOf(index: number): string {
    for (let at = index - 1; at >= 0; at -= 1) {
      const entry = messages[at];
      if (entry.role === "user") return entry.text;
    }
    return "";
  }

  const label = target.rel === "" ? (root?.name ?? target.rootId) : target.rel;
  return (
    <section className="muse-panel" aria-label="Muse dialog" hidden={hidden}>
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
              ) : message.role === "muse" ? (
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
              ) : (
                <div key={message.id} className="muse-message muse-message-proposal">
                  <div className="muse-md">
                    <MarkdownLite text={message.generation.explanation} />
                    {message.generation.assumptions.length > 0 && (
                      <>
                        <h4>Assumptions</h4>
                        <ul>
                          {message.generation.assumptions.map((note, noteIndex) => (
                            <li key={noteIndex}>{note}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {message.generation.questions.length > 0 && (
                      <>
                        <h4>Questions</h4>
                        <ul>
                          {message.generation.questions.map((note, noteIndex) => (
                            <li key={noteIndex}>{note}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                  <ProposalFiles
                    key={message.generation.id}
                    generation={latest(message.generation)}
                    rootNames={rootNames}
                    api={api}
                    prefs={prefs}
                    loader={loader}
                    onChange={(generation) => updateProposal(message.id, generation)}
                    onAccepted={proposalAccepted}
                  />
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary small"
                      disabled={busy !== null}
                      onClick={() => showOnXray(latest(message.generation))}
                    >
                      Show on X-ray
                    </button>
                  </div>
                </div>
              ),
            )}
            {busy === "ask" && <div className="muse-message muse-working">Working…</div>}
            {busy === "propose" && (
              <div className="muse-message muse-working">Generating proposal…</div>
            )}
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
