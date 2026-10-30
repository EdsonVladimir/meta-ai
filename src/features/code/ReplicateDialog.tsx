// "Replicate structure as modules" dialog: from a workspace root, a
// preview of the base child folders (suggested or chosen) and creation
// in one transaction of the project (when new), the empty modules with
// name = folder, the root↔project link and the manual links. Nothing
// is created on preview; only on confirm. No AI or code analysis.
import { useEffect, useRef, useState } from "react";
import { listProjects } from "../requirements/client";
import type { ProjectDto } from "../requirements/types";
import { normalizeCodeError, replicateExecute, replicatePreview } from "./client";
import type {
  CodeError,
  CodeRootDto,
  ReplicateExecuteInput,
  ReplicatePreviewDto,
  ReplicateResultDto,
} from "./types";

export interface ReplicateApi {
  preview: (rootId: string, base?: string) => Promise<ReplicatePreviewDto>;
  execute: (input: ReplicateExecuteInput) => Promise<ReplicateResultDto>;
  listProjects: () => Promise<ProjectDto[]>;
}

const defaultApi: ReplicateApi = {
  preview: replicatePreview,
  execute: replicateExecute,
  listProjects,
};

/** Maximum visible in the dialog (the server revalidates its own). */
const MAX_PICK = 50;

const EXCLUSION_POLICY =
  "Hidden (`.`), node_modules, dist, build, target, coverage, __pycache__ and .git are excluded.";

export function ReplicateDialog({
  root,
  api = defaultApi,
  onClose,
  onDone,
}: {
  root: CodeRootDto;
  api?: ReplicateApi;
  onClose: () => void;
  onDone: (result: ReplicateResultDto) => void;
}) {
  const [base, setBase] = useState("");
  const [preview, setPreview] = useState<ReplicatePreviewDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<CodeError | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [newName, setNewName] = useState(root.name);
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [existingId, setExistingId] = useState("");
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<CodeError | null>(null);
  const [result, setResult] = useState<ReplicateResultDto | null>(null);
  const live = useRef(true);
  const seq = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function loadPreview(explicitBase?: string): Promise<void> {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    setLoadError(null);
    try {
      const [got, all] = await Promise.all([
        api.preview(root.id, explicitBase),
        projects === null ? api.listProjects() : Promise.resolve(projects),
      ]);
      if (!live.current || mine !== seq.current) return;
      setPreview(got);
      setBase(got.base);
      setProjects(all);
      // Checked by default: free ones; linked ones can be checked
      // too (the server reports them as already linked).
      setChecked(new Set(got.entries.filter((e) => e.linkedModule === null).map((e) => e.rel)));
    } catch (raw) {
      if (!live.current || mine !== seq.current) return;
      setLoadError(normalizeCodeError(raw));
    } finally {
      if (live.current && mine === seq.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadPreview();
    // Only on open: the base reloads with an explicit button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root.id]);

  function toggle(rel: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }

  const picked = preview === null ? [] : preview.entries.filter((e) => checked.has(e.rel));
  const nameOk = newName.trim() !== "";
  const targetOk = target === "new" ? nameOk : existingId !== "";
  const countOk = picked.length >= 1 && picked.length <= MAX_PICK;
  const canConfirm =
    preview !== null && !loading && !executing && result === null && countOk && targetOk;

  async function confirm(): Promise<void> {
    if (preview === null || !canConfirm) return;
    setExecuting(true);
    setExecError(null);
    try {
      const out = await api.execute({
        rootId: root.id,
        base: preview.base,
        rels: picked.map((e) => e.rel),
        target: target === "new" ? { kind: "new", name: newName.trim() } : { kind: "existing", projectId: existingId },
      });
      if (!live.current) return;
      setResult(out);
    } catch (raw) {
      if (!live.current) return;
      setExecError(normalizeCodeError(raw));
    } finally {
      if (live.current) setExecuting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label="Replicate structure as modules"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Replicate structure as modules</h3>
        <p className="hint">
          From "{root.name}": creates the project with empty modules (name = folder), links
          the root and links each module to its folder. Nothing is created until confirmed.
        </p>
        {loadError !== null && (
          <p className="error" role="alert">
            Could not read the structure: {loadError.message}{" "}
            <button type="button" className="secondary small" onClick={() => void loadPreview()}>
              Retry
            </button>
          </p>
        )}
        {loading && preview === null && <p className="hint">Reading folders…</p>}
        {preview !== null && result === null && (
          <>
            <div className="code-proposal-pick">
              <label className="hint" htmlFor="replicate-base">
                Base
              </label>
              <input
                id="replicate-base"
                type="text"
                value={base}
                placeholder='src/app, src… (or "Use the root")'
                disabled={loading || executing}
                onChange={(event) => setBase(event.target.value)}
              />
              <button
                type="button"
                className="secondary small"
                disabled={loading || executing || base.trim() === ""}
                onClick={() => void loadPreview(base.trim())}
              >
                {loading ? "Reading…" : "Refresh preview"}
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={loading || executing}
                title="Each child folder of the root becomes a module (handy for sibling microservices)"
                onClick={() => void loadPreview("")}
              >
                Use the root
              </button>
            </div>
            <p className="hint">
              {preview.suggested ? "Suggested" : "Chosen"}
              {preview.base === "" ? " (root): " : ": "}
              {preview.reason}
            </p>
            {preview.entries.length === 0 ? (
              <p className="hint">
                No child folders in "{preview.base}": nothing to replicate. Try another base.
              </p>
            ) : (
              <fieldset className="replicate-list">
                <legend className="hint">
                  Folders ({picked.length} of {preview.entries.length}, max {MAX_PICK})
                </legend>
                <ul>
                  {preview.entries.map((entry) => (
                    <li key={entry.rel}>
                      <label className="hint">
                        <input
                          type="checkbox"
                          checked={checked.has(entry.rel)}
                          disabled={executing}
                          onChange={() => toggle(entry.rel)}
                        />{" "}
                        <code>{entry.name}</code>{" "}
                        <span className="tree-secondary">{entry.rel}</span>
                        {entry.linkedModule !== null && (
                          <span className="link-badge" title="Already linked to this module">
                            {entry.linkedModule}
                          </span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            {preview.excluded.length > 0 && (
              <p className="hint">Excluded by policy: {preview.excluded.join(", ")}.</p>
            )}
            <p className="hint">{EXCLUSION_POLICY}</p>
            {preview.truncated && (
              <p className="hint">Truncated listing: there are more entries than shown.</p>
            )}
            {preview.overCap && (
              <p className="hint">
                More than {MAX_PICK} folders: uncheck down to {MAX_PICK} to confirm.
              </p>
            )}
            <div className="code-proposal-pick" role="radiogroup" aria-label="Target">
              <label className="hint">
                <input
                  type="radio"
                  name="replicate-target"
                  checked={target === "new"}
                  onChange={() => setTarget("new")}
                />{" "}
                New project
              </label>
              <label className="hint">
                <input
                  type="radio"
                  name="replicate-target"
                  checked={target === "existing"}
                  onChange={() => setTarget("existing")}
                />{" "}
                Existing project
              </label>
            </div>
            {target === "new" ? (
              <div className="code-proposal-pick">
                <label className="hint" htmlFor="replicate-name">
                  Name
                </label>
                <input
                  id="replicate-name"
                  type="text"
                  value={newName}
                  maxLength={120}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </div>
            ) : projects === null ? (
              <p className="hint">Loading projects…</p>
            ) : (
              <div className="code-proposal-pick">
                <label className="hint" htmlFor="replicate-project">
                  Project
                </label>
                <select
                  id="replicate-project"
                  value={existingId}
                  onChange={(event) => setExistingId(event.target.value)}
                >
                  <option value="">Choose a project…</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {execError !== null && (
              <p className="error" role="alert">
                Could not replicate: {execError.message} Nothing was half-created.
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                className="primary"
                disabled={!canConfirm}
                onClick={() => void confirm()}
              >
                {executing ? "Replicating…" : `Replicate ${picked.length} module${picked.length === 1 ? "" : "s"}`}
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
        {result !== null && (
          <>
            <div className="code-proposal-preview">
              <h4>Replica created</h4>
              <ul>
                <li>
                  Project <code>{result.projectName}</code>{" "}
                  {result.projectCreated ? "(new)" : "(existing)"} · root linked.
                </li>
                {result.modules.map((module) => (
                  <li key={module.moduleId}>
                    Module <code>{module.name}</code> → <code>{module.rel}</code>.
                  </li>
                ))}
                {result.alreadyLinked.length > 0 && (
                  <li>Already linked: {result.alreadyLinked.join(", ")}.</li>
                )}
              </ul>
            </div>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => onDone(result)}>
                Open in Requirements
              </button>
              <button type="button" className="secondary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
