// Muse dialog on a folder, file or component: a chat thread with a
// pinned composer. Ruth picks what Muse reads and says how much; the
// list stays one click away. Ask answers and changes nothing, sending
// the previous turns as history; Propose saves the message as a
// requirement, generates the proposal in the thread and hands it to
// the X-ray, so AI output stays a separate proposal. The newest card
// answers its questions and adjusts; older cards stay read-only. The
// thread lives in memory only.
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
  getRequirement,
  listModules,
  renameModule,
  renameProject,
  saveVersion,
} from "../requirements/client";
import type { RequirementDetail } from "../requirements/types";
import { currentVersion } from "../requirements/types";
import { useRequirementsUi, type MuseTarget } from "../requirements/uiStore";
import { MarkdownLite } from "./markdownLite";
import {
  collectMuseFiles,
  composeAnswers,
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
  getRequirement: typeof getRequirement;
  saveVersion: typeof saveVersion;
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
  getRequirement,
  saveVersion,
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

/** A proposal that never arrived: retry resumes after the last save. */
interface FailedProposal {
  kind: "propose" | "adjust";
  text: string;
  /** The card being adjusted; null while proposing fresh. */
  generation: CodeGenerationDto | null;
  /** Saved requirement/version to reuse; null replays from the top. */
  resume: {
    projectId: string;
    moduleId: string;
    requirementId: string;
    scope: MuseFile[];
    previousGenerationId: string | null;
  } | null;
  error: string;
}

type Busy = "ask" | "propose" | null;

interface MusePanelProps {
  target: MuseTarget;
  roots: CodeRootDto[];
  onClose: () => void;
  /** Proposal generated: the workspace shows it on the X-ray, no dialog. */
  onPropose: (generation: CodeGenerationDto) => void;
  api?: MusePanelApi;
  prefs?: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
  hidden?: boolean;
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
    if (second.role === "muse") {
      turns.push({ question: first.text, answer: second.text });
    } else if (second.role === "proposal") {
      const rels = second.generation.files.map((file) => file.rel).join(", ");
      turns.push({
        question: first.text,
        answer: `Proposed files: ${rels}. ${second.generation.explanation}`,
      });
    }
  }
  return turns;
}

/** The last proposal turn: the only live card. */
function newestProposal(entries: Message[]): ProposalMessage | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.role === "proposal") return entry;
  }
  return null;
}

function ProposalAnswers({
  questions,
  disabled,
  onSend,
}: {
  questions: string[];
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const text = composeAnswers(questions, answers);
  return (
    <>
      <h4>Questions</h4>
      <ul className="muse-answers">
        {questions.map((question, index) => (
          <li key={index}>
            <label className="muse-answer-row">
              <span className="muse-answer-q">{question}</span>
              <input
                type="text"
                value={answers[index] ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setAnswers((prev) => ({ ...prev, [index]: event.target.value }))
                }
              />
            </label>
          </li>
        ))}
      </ul>
      <div className="button-row">
        <button
          type="button"
          className="secondary small"
          disabled={disabled || text === ""}
          onClick={() => onSend(text)}
        >
          Send answers
        </button>
      </div>
    </>
  );
}

export function MusePanel({
  target,
  roots,
  onClose,
  onPropose,
  api = defaultApi,
  prefs = DEFAULT_CODE_EDITOR_PREFS,
  loader = loadMonaco,
  hidden = false,
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
  const [failedProposal, setFailedProposal] = useState<FailedProposal | null>(null);
  /** True while a proposal exists: the composer adjusts instead of proposing. */
  const [adjustMode, setAdjustMode] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  const idRef = useRef(0);
  /** A reply for a previous target or a cleared thread is dropped. */
  const threadRef = useRef(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const museGeneration = useRequirementsUi((s) => s.museGeneration);

  useEffect(() => {
    let stale = false;
    threadRef.current += 1;
    setCandidates(null);
    setNotice(null);
    setMessages([]);
    setFailed(null);
    setFailedProposal(null);
    setAdjustMode(false);
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
    // Asking again about the same folder keeps the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.rootId, target.rel, target.kind]);

  useEffect(() => {
    const end = endRef.current;
    if (end !== null && typeof end.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end" });
    }
  }, [messages, busy, failed, failedProposal]);

  const blocked = root?.aiBlocked ?? false;
  const all = candidates ?? [];
  const files =
    chosen === null ? pickMuseFiles(all, text) : all.filter((file) => chosen.has(file.rel));
  const picked = new Set(files.map((file) => file.rel));
  const rootNames = Object.fromEntries(roots.map((entry) => [entry.id, entry.name]));
  // What leaves the machine, in plain view: it must not need a hover.
  const leftOut = all.length - files.length;
  const outgoing = [
    `Sending goes to Meta: ${files.length === 1 ? "this file" : `these ${files.length} files`}`,
    ...(leftOut > 0 ? [`the names of the other ${leftOut}`] : []),
    ...(messages.length > 0 ? ["your recent messages here"] : []),
  ].join(", ").concat(".");
  const newest = newestProposal(messages);
  const showAdjust = adjustMode && newest !== null;
  const canSend =
    busy === null && !blocked && root !== null && text.trim() !== "" && files.length > 0;
  // A saved version waits for its Retry: another adjustment would find
  // the proposal out of date and lose that Retry.
  const pendingRetry = failedProposal?.resume != null;
  const canAdjust =
    busy === null &&
    !pendingRetry &&
    !blocked &&
    root !== null &&
    text.trim() !== "" &&
    newest !== null;

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

  function appendProposal(generation: CodeGenerationDto): void {
    idRef.current += 1;
    const id = idRef.current;
    setMessages((prev) => [...prev, { id, role: "proposal", generation }]);
    setAdjustMode(true);
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

  /** What the card shows: the X-ray copy when it carries this generation. */
  function latest(generation: CodeGenerationDto): CodeGenerationDto {
    return museGeneration?.id === generation.id ? museGeneration : generation;
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

  async function runProposeFlow(input: {
    message: string;
    showUser: boolean;
    resume: FailedProposal["resume"];
  }): Promise<void> {
    if (root === null) return;
    if (input.showUser) appendMessage("user", input.message);
    const thread = threadRef.current;
    setBusy("propose");
    setFailedProposal(null);
    setNotice(null);
    let saved = input.resume;
    try {
      if (saved === null) {
        const { projectId, moduleId } = await linkMuseTarget(target, root, api);
        const created = await api.createRequirement({
          projectId,
          moduleId,
          content: input.message,
          author: "Muse dialog",
        });
        saved = {
          projectId,
          moduleId,
          requirementId: created.artifact.id,
          scope: files,
          previousGenerationId: null,
        };
      }
      const generation = await api.generate({
        projectId: saved.projectId,
        moduleId: saved.moduleId,
        source: { kind: "requirement", artifactId: saved.requirementId },
        scope: saved.scope,
      });
      if (thread !== threadRef.current) return;
      appendProposal(generation);
      showOnXray(generation);
    } catch (raw) {
      if (thread !== threadRef.current) return;
      setFailedProposal({
        kind: "propose",
        text: input.message,
        generation: null,
        resume: saved,
        error: reason(raw),
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendProposal(raw: string): Promise<void> {
    if (root === null) return;
    const message = raw.trim();
    if (message === "") return;
    setText("");
    await runProposeFlow({ message, showUser: true, resume: null });
  }

  async function runAdjustFlow(input: {
    generation: CodeGenerationDto;
    text: string;
    showUser: boolean;
    resume: FailedProposal["resume"];
  }): Promise<void> {
    if (root === null) return;
    if (input.showUser) appendMessage("user", input.text);
    const thread = threadRef.current;
    setBusy("propose");
    setFailedProposal(null);
    setNotice(null);
    let saved = input.resume;
    try {
      if (saved === null) {
        const detail: RequirementDetail = await api.getRequirement(
          input.generation.requirementArtifactId,
        );
        const current = currentVersion(detail);
        if (current === undefined || detail.currentVersionId !== input.generation.requirementVersionId) {
          if (thread === threadRef.current) {
            setNotice(
              `The requirement changed since this proposal (current ${detail.currentVersionId}, proposal used ${input.generation.requirementVersionId}). Start a new proposal to adjust the latest.`,
            );
          }
          return;
        }
        await api.saveVersion({
          projectId: input.generation.projectId,
          artifactId: input.generation.requirementArtifactId,
          expectedVersionId: detail.currentVersionId,
          content: `${current.content}\n\nAdjustment: ${input.text}`,
          author: "Muse dialog",
        });
        saved = {
          projectId: input.generation.projectId,
          moduleId: input.generation.moduleId,
          requirementId: input.generation.requirementArtifactId,
          scope: input.generation.scope.map((entry) => ({
            rootId: entry.rootId,
            rel: entry.rel,
          })),
          previousGenerationId: input.generation.id,
        };
      }
      const generation = await api.generate({
        projectId: saved.projectId,
        moduleId: saved.moduleId,
        source: { kind: "requirement", artifactId: saved.requirementId },
        scope: saved.scope,
        instruction: input.text,
        previousGenerationId: saved.previousGenerationId ?? undefined,
      });
      if (thread !== threadRef.current) return;
      appendProposal(generation);
      useRequirementsUi.getState().setMuseGeneration(generation);
    } catch (raw) {
      if (thread !== threadRef.current) return;
      setFailedProposal({
        kind: "adjust",
        text: input.text,
        generation: input.generation,
        resume: saved,
        error: reason(raw),
      });
    } finally {
      setBusy(null);
    }
  }

  async function sendAdjustment(raw: string): Promise<void> {
    if (root === null) return;
    const text = raw.trim();
    if (newest === null || text === "") return;
    setText("");
    await runAdjustFlow({ generation: latest(newest.generation), text, showUser: true, resume: null });
  }

  function retryProposal(): void {
    const failed = failedProposal;
    if (failed === null || busy !== null) return;
    if (failed.kind === "propose") {
      void runProposeFlow({ message: failed.text, showUser: false, resume: failed.resume });
    } else if (failed.generation !== null) {
      void runAdjustFlow({
        generation: failed.generation,
        text: failed.text,
        showUser: false,
        resume: failed.resume,
      });
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
    setFailedProposal(null);
    setAdjustMode(false);
    setNotice(null);
    useRequirementsUi.getState().setMuseGeneration(null);
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
              ) : message.id === newest?.id ? (
                <div key={message.id} className="muse-message muse-message-proposal">
                  <div className="muse-md">
                    <MarkdownLite text={latest(message.generation).explanation} />
                    {latest(message.generation).assumptions.length > 0 && (
                      <>
                        <h4>Assumptions</h4>
                        <ul>
                          {latest(message.generation).assumptions.map((note, noteIndex) => (
                            <li key={noteIndex}>{note}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {latest(message.generation).questions.length > 0 && (
                      <ProposalAnswers
                        key={latest(message.generation).id}
                        questions={latest(message.generation).questions}
                        disabled={busy !== null || pendingRetry}
                        onSend={(answers) =>
                          void runAdjustFlow({
                            generation: latest(message.generation),
                            text: answers,
                            showUser: true,
                            resume: null,
                          })
                        }
                      />
                    )}
                  </div>
                  <ProposalFiles
                    key={latest(message.generation).id}
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
                    <button
                      type="button"
                      className="secondary small"
                      disabled={busy !== null}
                      title="Start a fresh proposal instead of adjusting."
                      onClick={() => setAdjustMode(false)}
                    >
                      New proposal
                    </button>
                  </div>
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
                    generation={message.generation}
                    rootNames={rootNames}
                    api={api}
                    prefs={prefs}
                    loader={loader}
                    onChange={(generation) => updateProposal(message.id, generation)}
                    onAccepted={proposalAccepted}
                    readOnly
                  />
                  {newest !== null && (
                    <p className="hint">Replaced by {newest.generation.id}</p>
                  )}
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
            {failedProposal !== null && (
              <div className="muse-error-row" role="alert">
                <span className="error">{failedProposal.error}</span>
                <button
                  type="button"
                  className="secondary small"
                  disabled={busy !== null}
                  onClick={retryProposal}
                >
                  Retry proposal
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
            {!blocked && all.length > 0 && <p className="hint muse-outgoing">{outgoing}</p>}
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
                title="Muse answers from what is listed above. No file changes. Ctrl+Enter sends."
                onClick={() => void sendQuestion(text)}
              >
                Ask
              </button>
              {showAdjust ? (
                <button
                  type="button"
                  disabled={!canAdjust}
                  title="Save a new requirement version and regenerate the newest proposal."
                  onClick={() => void sendAdjustment(text)}
                >
                  Adjust proposal
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canSend}
                  title="Saved as a requirement. The code arrives as a proposal you review."
                  onClick={() => void sendProposal(text)}
                >
                  Propose change
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
