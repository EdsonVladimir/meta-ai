// "Propose code" dialog: from ONE saved requirement or ONE saved
// mockup screen, plus the current scope, context preview, generation
// with Meta and per-file review (current↔proposed diff, accept or
// discard). Accepting writes to disk with a fingerprint; re-analyzing
// shows what changed in the analysis. It never generates alone or
// writes without an explicit click.
import { useEffect, useRef, useState } from "react";
import type { ArtifactDto } from "../../requirements/types";
import { listRequirements } from "../../requirements/client";
import { useRequirementsUi } from "../../requirements/uiStore";
import { docKey } from "../../requirements/saveStatus";
import { CodeConflictDiff } from "../CodeConflictDiff";
import {
  acceptCodeFile,
  discardCodeFile,
  genCodeContext,
  generateCode,
  listCodeGenerations,
  listMockupScreens,
  normalizeCodeError,
  readCodeFile,
  type CodeGenRequest,
} from "../client";
import type {
  CodeAcceptDto,
  CodeError,
  CodeFileDto,
  CodeGenContextDto,
  CodeGenerationDto,
  CodeMockupScreensDto,
  CodeProposalFileDto,
} from "../types";
import type { MonacoApi } from "../monacoLoader";
import type { CodeEditorPrefs } from "../editorPrefs";
import { languageForFile } from "../model";
import { diffIsEmpty, diffStructure } from "./diffStructure";
import type { ScopeFile } from "./StructureView";
import type { StructureResult } from "./structureTypes";

export interface CodeGenApi {
  listRequirements: (projectId: string, moduleId: string) => Promise<ArtifactDto[]>;
  listMockupScreens: (projectId: string, moduleId: string) => Promise<CodeMockupScreensDto[]>;
  genContext: (input: CodeGenRequest) => Promise<CodeGenContextDto>;
  generate: (input: CodeGenRequest) => Promise<CodeGenerationDto>;
  listGenerations: (moduleId: string) => Promise<CodeGenerationDto[]>;
  acceptFile: (generationId: string, pos: number) => Promise<CodeAcceptDto>;
  discardFile: (generationId: string, pos: number) => Promise<CodeGenerationDto>;
  readFile: (rootId: string, rel: string) => Promise<CodeFileDto>;
}

const defaultApi: CodeGenApi = {
  listRequirements,
  listMockupScreens,
  genContext: genCodeContext,
  generate: generateCode,
  listGenerations: listCodeGenerations,
  acceptFile: acceptCodeFile,
  discardFile: discardCodeFile,
  readFile: readCodeFile,
};

/** Readable origin of a generation: screen or requirement, with version. */
function originLabel(generation: CodeGenerationDto): string {
  if (generation.screenArtifactId !== "") {
    return `${generation.screenArtifactId}/${generation.screenId} @ ${generation.screenVersionId}`;
  }
  return `${generation.requirementArtifactId} @ ${generation.requirementVersionId}`;
}

interface CodeProposalDialogProps {
  projectId: string;
  moduleId: string;
  scope: ScopeFile[];
  rootNames: Record<string, string>;
  /** Analysis on open (re-analysis baseline). */
  baseline: StructureResult | null;
  /** Latest analysis (changes on re-analyze). */
  current: StructureResult | null;
  onReanalyze: () => Promise<void>;
  /** Notify the workspace: reloads the clean tab and refreshes the tree. */
  onFileAccepted: (rootId: string, rel: string) => void;
  onClose: () => void;
  prefs: CodeEditorPrefs;
  loader?: () => Promise<MonacoApi>;
  api?: CodeGenApi;
}

function reqLabel(req: ArtifactDto): string {
  return req.title ?? req.id;
}

export function CodeProposalDialog({
  projectId,
  moduleId,
  scope,
  rootNames,
  baseline,
  current,
  onReanalyze,
  onFileAccepted,
  onClose,
  prefs,
  loader,
  api = defaultApi,
}: CodeProposalDialogProps) {
  const [requirements, setRequirements] = useState<ArtifactDto[] | null>(null);
  const [reqError, setReqError] = useState<CodeError | null>(null);
  const [selectedReq, setSelectedReq] = useState("");
  const [source, setSource] = useState<"requirement" | "screen">("requirement");
  const [mockups, setMockups] = useState<CodeMockupScreensDto[] | null>(null);
  const [mockupsError, setMockupsError] = useState<CodeError | null>(null);
  const [selectedMockup, setSelectedMockup] = useState("");
  const [selectedScreen, setSelectedScreen] = useState("");
  const docStatus = useRequirementsUi((s) => s.docStatus);
  const requestSaveAll = useRequirementsUi((s) => s.requestSaveAll);
  const [preview, setPreview] = useState<CodeGenContextDto | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [opError, setOpError] = useState<string | null>(null);
  const [generation, setGeneration] = useState<CodeGenerationDto | null>(null);
  const [previous, setPrevious] = useState<CodeGenerationDto[] | null>(null);
  const [previousBusy, setPreviousBusy] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [currentTexts, setCurrentTexts] = useState<Record<number, string>>({});
  const [busyPos, setBusyPos] = useState<number | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const [reanalyzing, setReanalyzing] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let stale = false;
    setRequirements(null);
    setReqError(null);
    api
      .listRequirements(projectId, moduleId)
      .then((all) => {
        if (stale || !live.current) return;
        setRequirements(all.filter((req) => req.kind === "requirement" && !req.archived));
      })
      .catch((raw) => {
        if (stale || !live.current) return;
        setReqError(normalizeCodeError(raw));
      });
    return () => {
      stale = true;
    };
  }, [api, projectId, moduleId]);

  useEffect(() => {
    let stale = false;
    setMockups(null);
    setMockupsError(null);
    api
      .listMockupScreens(projectId, moduleId)
      .then((all) => {
        if (stale || !live.current) return;
        setMockups(all);
      })
      .catch((raw) => {
        if (stale || !live.current) return;
        setMockupsError(normalizeCodeError(raw));
      });
    return () => {
      stale = true;
    };
  }, [api, projectId, moduleId]);

  function request(): CodeGenRequest {
    return {
      projectId,
      moduleId,
      source:
        source === "screen"
          ? { kind: "screen", mockupId: selectedMockup, screenId: selectedScreen }
          : { kind: "requirement", artifactId: selectedReq },
      scope: scope.map((file) => ({ rootId: file.rootId, rel: file.rel })),
    };
  }

  function resetOutcome(): void {
    setPreview(null);
    setOpError(null);
  }

  async function loadPreview(): Promise<void> {
    setPreviewBusy(true);
    setOpError(null);
    setPreview(null);
    try {
      const context = await api.genContext(request());
      if (!live.current) return;
      setPreview(context);
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setPreviewBusy(false);
    }
  }

  async function runGenerate(): Promise<void> {
    setGenerating(true);
    setOpError(null);
    try {
      const created = await api.generate(request());
      if (!live.current) return;
      setGeneration(created);
      setExpanded(null);
      setCurrentTexts({});
      setFileNotice(null);
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setGenerating(false);
    }
  }

  async function loadPrevious(): Promise<void> {
    setPreviousBusy(true);
    setOpError(null);
    try {
      const all = await api.listGenerations(moduleId);
      if (!live.current) return;
      setPrevious(all);
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setPreviousBusy(false);
    }
  }

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

  async function accept(generationId: string, file: CodeProposalFileDto): Promise<void> {
    setBusyPos(file.pos);
    setOpError(null);
    setFileNotice(null);
    try {
      const outcome = await api.acceptFile(generationId, file.pos);
      if (!live.current) return;
      setGeneration(outcome.generation);
      if (outcome.alreadyAccepted) {
        setFileNotice(`"${file.rel}" was already accepted; not written again.`);
      } else {
        setFileNotice(
          `"${file.rel}" written to disk (fingerprint ${outcome.fingerprint ?? "?"}). Re-analyze to see the change.`,
        );
        onFileAccepted(file.rootId, file.rel);
      }
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setBusyPos(null);
    }
  }

  async function discard(generationId: string, file: CodeProposalFileDto): Promise<void> {
    setBusyPos(file.pos);
    setOpError(null);
    setFileNotice(null);
    try {
      const updated = await api.discardFile(generationId, file.pos);
      if (!live.current) return;
      setGeneration(updated);
      setFileNotice(`"${file.rel}" discarded.`);
    } catch (raw) {
      if (!live.current) return;
      setOpError(normalizeCodeError(raw).message);
    } finally {
      if (live.current) setBusyPos(null);
    }
  }

  async function reanalyze(): Promise<void> {
    setReanalyzing(true);
    try {
      await onReanalyze();
    } finally {
      if (!live.current) return;
      setReanalyzing(false);
      setRuns((n) => n + 1);
    }
  }

  const diff = runs > 0 ? diffStructure(baseline, current) : null;
  const usage = generation?.usage;
  const usageText =
    usage !== undefined && (usage.inputTokens !== null || usage.outputTokens !== null)
      ? ` · ${usage.inputTokens ?? "?"}+${usage.outputTokens ?? "?"} tokens`
      : "";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide code-proposal"
        role="dialog"
        aria-modal="true"
        aria-label="Propose code"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3>Propose code</h3>
          <button type="button" className="secondary small" onClick={onClose}>
            Close
          </button>
        </div>

        {generation === null && (
          <>
            <p className="hint">
              From a saved requirement or a saved mockup screen and the current scope (
              {scope.length} file{scope.length === 1 ? "" : "s"}). Only the origin and the saved
              scope content go to Meta; nothing is written without your Accept click.
            </p>
            <div className="code-proposal-pick" role="radiogroup" aria-label="Proposal origin">
              <label className="hint">
                <input
                  type="radio"
                  name="code-source"
                  checked={source === "requirement"}
                  onChange={() => {
                    setSource("requirement");
                    resetOutcome();
                  }}
                />{" "}
                Requirement
              </label>
              <label className="hint">
                <input
                  type="radio"
                  name="code-source"
                  checked={source === "screen"}
                  onChange={() => {
                    setSource("screen");
                    resetOutcome();
                  }}
                />{" "}
                Screen
              </label>
            </div>
            {source === "requirement" && (
              <>
                {reqError !== null && (
                  <p className="error" role="alert">
                    Could not list the requirements: {reqError.message}
                  </p>
                )}
                {requirements === null && reqError === null && (
                  <p className="hint">Loading requirements…</p>
                )}
                {requirements !== null && (
                  <div className="code-proposal-pick">
                    <label className="hint" htmlFor="code-req">
                      Requirement
                    </label>
                    <select
                      id="code-req"
                      value={selectedReq}
                      onChange={(event) => {
                        setSelectedReq(event.target.value);
                        resetOutcome();
                      }}
                    >
                      <option value="">Choose a requirement…</option>
                      {requirements.map((req) => (
                        <option key={req.id} value={req.id}>
                          {reqLabel(req)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="secondary small"
                      disabled={selectedReq === "" || previewBusy || generating}
                      onClick={() => void loadPreview()}
                    >
                      {previewBusy ? "Reading…" : "Preview"}
                    </button>
                  </div>
                )}
              </>
            )}
            {source === "screen" && (
              <>
                {mockupsError !== null && (
                  <p className="error" role="alert">
                    Could not list the mockups: {mockupsError.message}
                  </p>
                )}
                {mockups === null && mockupsError === null && (
                  <p className="hint">Loading mockups…</p>
                )}
                {mockups !== null && mockups.length === 0 && (
                  <p className="hint">No mockups with screens in this module.</p>
                )}
                {mockups !== null && mockups.length > 0 && (
                  <div className="code-proposal-pick">
                    <label className="hint" htmlFor="code-mockup">
                      Mockup
                    </label>
                    <select
                      id="code-mockup"
                      value={selectedMockup}
                      onChange={(event) => {
                        setSelectedMockup(event.target.value);
                        setSelectedScreen("");
                        resetOutcome();
                      }}
                    >
                      <option value="">Choose a mockup…</option>
                      {mockups.map((mockup) => (
                        <option key={mockup.artifactId} value={mockup.artifactId}>
                          {mockup.title}
                        </option>
                      ))}
                    </select>
                    <label className="hint" htmlFor="code-screen">
                      Screen
                    </label>
                    <select
                      id="code-screen"
                      value={selectedScreen}
                      disabled={selectedMockup === ""}
                      onChange={(event) => {
                        setSelectedScreen(event.target.value);
                        resetOutcome();
                      }}
                    >
                      <option value="">Choose a screen…</option>
                      {(mockups.find((m) => m.artifactId === selectedMockup)?.screens ?? []).map(
                        (screen) => (
                          <option key={screen.id} value={screen.id}>
                            {screen.title}
                          </option>
                        ),
                      )}
                    </select>
                    <button
                      type="button"
                      className="secondary small"
                      disabled={selectedScreen === "" || previewBusy || generating}
                      onClick={() => void loadPreview()}
                    >
                      {previewBusy ? "Reading…" : "Preview"}
                    </button>
                  </div>
                )}
                {selectedMockup !== "" &&
                  docStatus[docKey("mockup", selectedMockup)]?.dirty === true && (
                    <p className="notice" role="note">
                      This mockup has unsaved changes: the context will use the saved version.{" "}
                      <button
                        type="button"
                        className="secondary small"
                        onClick={() => requestSaveAll()}
                      >
                        Save all
                      </button>
                    </p>
                  )}
              </>
            )}
            {opError !== null && (
              <p className="error" role="alert">
                {opError}
              </p>
            )}
            {preview !== null && (
              <div className="code-proposal-preview">
                <h4>Will go to Meta</h4>
                <ul>
                  {preview.screenId !== "" ? (
                    <li>
                      Screen <code>{preview.artifactId}/{preview.screenId}</code> ("
                      {preview.screenTitle}") version <code>{preview.versionId}</code> (
                      {preview.screenChars} chars).
                    </li>
                  ) : (
                    <li>
                      Requirement <code>{preview.artifactId}</code> version{" "}
                      <code>{preview.versionId}</code> ({preview.requirementChars} chars).
                    </li>
                  )}
                  {preview.screenSources.map((item) => (
                    <li key={item.artifactId}>
                      Source <code>{item.artifactId}</code> version <code>{item.versionId}</code>{" "}
                      ({item.chars} chars).
                    </li>
                  ))}
                  {preview.files.map((file) => (
                    <li key={`${file.rootId}::${file.rel}`}>
                      <code>
                        {rootNames[file.rootId] ?? file.rootId}/{file.rel}
                      </code>{" "}
                      ({file.bytes} bytes, fingerprint {file.fingerprint}).
                    </li>
                  ))}
                </ul>
                <p className="hint">Approximate total: {preview.totalChars} chars.</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="primary"
                    disabled={generating}
                    onClick={() => void runGenerate()}
                  >
                    {generating ? "Generating…" : "Generate proposal"}
                  </button>
                </div>
              </div>
            )}
            <div className="code-proposal-previous">
              <button
                type="button"
                className="secondary small"
                disabled={previousBusy}
                onClick={() => void loadPrevious()}
              >
                {previous === null
                  ? "View previous"
                  : previousBusy
                    ? "Loading…"
                    : "Reload previous"}
              </button>
              {previous !== null && previous.length === 0 && (
                <p className="hint">No previous proposals in this module.</p>
              )}
              {previous !== null && previous.length > 0 && (
                <ul>
                  {previous.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="struct-link"
                        onClick={() => {
                          setGeneration(item);
                          setExpanded(null);
                          setCurrentTexts({});
                          setFileNotice(null);
                          setOpError(null);
                        }}
                      >
                        {item.id}
                      </button>{" "}
                      <span className="hint">
                        {originLabel(item)} · {item.files.length} file
                        {item.files.length === 1 ? "" : "s"}
                        {item.stale ? " · stale" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

        {generation !== null && (
          <>
            <div className="button-row">
              <button
                type="button"
                className="secondary small"
                onClick={() => {
                  setGeneration(null);
                  setPreview(null);
                  setOpError(null);
                  setFileNotice(null);
                }}
              >
                ← New proposal
              </button>
            </div>
            <h4>
              Proposal {generation.id}
              <span className="hint">
                {" "}
                · {generation.model}
                {usageText} · {originLabel(generation)}
              </span>
            </h4>
            <p>{generation.explanation}</p>
            {generation.assumptions.length > 0 && (
              <>
                <h4>Assumptions</h4>
                <ul>
                  {generation.assumptions.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </>
            )}
            {generation.questions.length > 0 && (
              <>
                <h4>Questions</h4>
                <ul>
                  {generation.questions.map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </>
            )}
            {generation.stale && (
              <p className="notice" role="note">
                Stale: {generation.staleReason ?? "the context changed."} Acceptance is
                blocked; generate a new proposal with "← New proposal".
              </p>
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
                      onClick={() => void accept(generation.id, file)}
                    >
                      {busyPos === file.pos ? "Accepting…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      className="secondary small"
                      disabled={file.state !== "pending" || busyPos !== null}
                      onClick={() => void discard(generation.id, file)}
                    >
                      Discard
                    </button>
                  </div>
                  {expanded === file.pos && (
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
            <div className="code-proposal-reanalyze">
              <button
                type="button"
                className="secondary small"
                disabled={reanalyzing}
                onClick={() => void reanalyze()}
              >
                {reanalyzing ? "Re-analyzing…" : "Re-analyze the scope"}
              </button>
              {diff !== null && diffIsEmpty(diff) && (
                <p className="hint">No analysis changes since opening.</p>
              )}
              {diff !== null && !diffIsEmpty(diff) && (
                <div>
                  <p className="hint">
                    Changes: +{diff.symbolsAdded}/−{diff.symbolsRemoved} symbols, +
                    {diff.relationsAdded}/−{diff.relationsRemoved} relations, +
                    {diff.endpointsAdded}/−{diff.endpointsRemoved} endpoints, +{diff.callsAdded}/−
                    {diff.callsRemoved} calls; unions {diff.unionsBefore}→{diff.unionsAfter}.
                  </p>
                  <ul>
                    {diff.samples.map((sample) => (
                      <li key={sample}>
                        <code>{sample}</code>
                      </li>
                    ))}
                  </ul>
                  {diff.truncatedSamples && <p className="hint">Truncated sample.</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
