// Archive and delete dialog: advisory summary (contents, dependents,
// baselines, generations) with a separate explicit confirmation. Execution
// revalidates the conditions in Rust; on failure the dialog keeps the
// summary and the selection stays intact.
import { useEffect } from "react";
import type { ArchivePreviewDto } from "./types";
import type { ArchiveAction, ArchiveTarget } from "./archive";

interface ArchiveDialogProps {
  target: ArchiveTarget;
  action: ArchiveAction;
  preview: ArchivePreviewDto | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
  onActionChange: (action: ArchiveAction) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function targetName(target: ArchiveTarget): string {
  if (target.kind === "project") return target.projectId;
  return target.kind === "module" ? target.moduleId : target.artifactId;
}

function targetKind(target: ArchiveTarget): string {
  if (target.kind === "project") return "project";
  return target.kind === "module" ? "module" : "requirement";
}

function logLabel(log: string): string {
  return log === "design" ? "design" : "requirements";
}

function roleLabel(role: string): string {
  if (role === "owns") return "module generation";
  if (role === "context") return "quoted in its context";
  if (role === "accepted") return "accepted proposal that created it";
  if (role === "target") return "update aimed at it";
  return role;
}

function titleFor(target: ArchiveTarget, action: ArchiveAction): string {
  const what = `${targetKind(target)} ${targetName(target)}`;
  if (action === "archive") return `Archive ${what}`;
  if (action === "restore") return `Restore ${what}`;
  return `Delete ${what} permanently`;
}

export function ArchiveDialog({
  target,
  action,
  preview,
  loading,
  busy,
  error,
  onActionChange,
  onConfirm,
  onRetry,
  onClose,
}: ArchiveDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-label={titleFor(target, action)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>{titleFor(target, action)}</h3>
          <button
            type="button"
            className="secondary small"
            onClick={onClose}
            disabled={busy}
            autoFocus
          >
            Close
          </button>
        </div>
        {loading && <p className="hint">Loading summary…</p>}
        {error !== null && preview === null && (
          <div>
            <p className="error" role="alert">
              Could not load the summary: {error}
            </p>
            <div className="modal-actions">
              <button type="button" className="primary" onClick={onRetry}>
                Retry
              </button>
            </div>
          </div>
        )}
        {preview !== null && (
          <div>
            <p className="hint">
              Current state:{" "}
              <span className={preview.archived ? "archived-badge" : "review-badge ok"}>
                {preview.archived ? "archived" : "active"}
              </span>{" "}
              · {preview.versions} {preview.versions === 1 ? "version" : "versions"} ·{" "}
              {preview.approvals} {preview.approvals === 1 ? "approval" : "approvals"}
            </p>
            {preview.kind === "project" && (
              <section aria-label="Project modules">
                <h4>Modules ({preview.modules.length})</h4>
                {preview.modules.length === 0 ? (
                  <p className="hint">Empty project.</p>
                ) : (
                  <ul className="archive-list">
                    {preview.modules.map((item) => (
                      <li key={item.id}>
                        <code>{item.id}</code> <span className="hint">{item.name}</span>
                        {item.archived && <span className="archived-badge">archived</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {preview.kind === "module" && (
              <section aria-label="Module contents">
                <h4>Contents ({preview.contents.length})</h4>
                {preview.contents.length === 0 ? (
                  <p className="hint">Empty module.</p>
                ) : (
                  <ul className="archive-list">
                    {preview.contents.map((item) => (
                      <li key={item.id}>
                        <code>{item.id}</code> <span className="kind-badge">{item.kind}</span>
                        {item.archived && <span className="archived-badge">archived</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            <section aria-label="Dependents">
              <h4>Dependents ({preview.dependents.length})</h4>
              {preview.dependents.length === 0 ? (
                <p className="hint">No artifact depends on this {targetKind(target)}.</p>
              ) : (
                <ul className="archive-list">
                  {preview.dependents.map((dep) => (
                    <li key={dep.artifact.id}>
                      <code>{dep.artifact.id}</code> <span className="kind-badge">{dep.artifact.kind}</span>{" "}
                      <span className="hint">
                        {dep.sameModule ? "this module" : `module ${dep.artifact.moduleId}`}
                      </span>
                      {dep.artifact.archived && <span className="archived-badge">archived</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="Baselines">
              <h4>Baselines ({preview.baselines.length})</h4>
              {preview.baselines.length === 0 ? (
                <p className="hint">No baseline includes it.</p>
              ) : (
                <div>
                  <ul className="archive-list">
                    {preview.baselines.map((base) => (
                      <li key={base.id}>
                        <code>{base.name}</code> <span className="hint">{base.id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">
                    Historical and immutable: they stay readable and exportable.
                  </p>
                </div>
              )}
            </section>
            <section aria-label="Work deliveries">
              <h4>Work deliveries ({preview.deliveries.length})</h4>
              {preview.deliveries.length === 0 ? (
                <p className="hint">No work delivery includes it.</p>
              ) : (
                <div>
                  <ul className="archive-list">
                    {preview.deliveries.map((delivery) => (
                      <li key={delivery.id}>
                        <code>{delivery.name}</code>{" "}
                        <span className="hint">{delivery.id}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">
                    Deliveries protect their content just like baselines.
                  </p>
                </div>
              )}
            </section>
            <section aria-label="Generations">
              <h4>Generations ({preview.generations.length})</h4>
              {preview.generations.length === 0 ? (
                <p className="hint">No generation mentions it.</p>
              ) : (
                <ul className="archive-list">
                  {preview.generations.map((gen) => (
                    <li key={`${gen.log}:${gen.id}:${gen.role}`}>
                      <code>{gen.id}</code>{" "}
                      <span className="hint">
                        {logLabel(gen.log)} · {roleLabel(gen.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {error !== null && (
              <p className="error" role="alert">
                Could not complete: {error} Nothing changed.
              </p>
            )}
            <ArchiveActions
              target={target}
              action={action}
              preview={preview}
              busy={busy}
              onActionChange={onActionChange}
              onConfirm={onConfirm}
              onClose={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ArchiveActions({
  target,
  action,
  preview,
  busy,
  onActionChange,
  onConfirm,
  onClose,
}: {
  target: ArchiveTarget;
  action: ArchiveAction;
  preview: ArchivePreviewDto;
  busy: boolean;
  onActionChange: (action: ArchiveAction) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const what = targetKind(target);
  if (action === "delete") {
    if (!preview.canDelete) {
      return (
        <div>
          <div className="archive-blocked" role="note">
            <p>
              <strong>Cannot delete "{targetName(target)}".</strong>
            </p>
            <ul>
              {preview.deleteBlockers.map((blocker) => (
                <li key={blocker.code}>{blocker.message}</li>
              ))}
            </ul>
          </div>
          <div className="modal-actions">
            {!preview.archived && preview.kind !== "project" && (
              <button
                type="button"
                className="primary"
                onClick={() => onActionChange("archive")}
                disabled={busy}
              >
                Archive instead
              </button>
            )}
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Close
            </button>
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="archive-danger" role="note">
          <p>
            <strong>"{targetName(target)}" will be deleted permanently</strong>
            {preview.kind === "project"
              ? " (empty project, no references)."
              : preview.kind === "module"
                ? " (empty module, no references)."
                : ` with its ${preview.versions} ${preview.versions === 1 ? "version" : "versions"}.`}
          </p>
          <p>
            No approvals, no dependents, no baselines and no mentions in
            generations. This action cannot be undone.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : `Delete "${targetName(target)}" permanently`}
          </button>
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="hint">
        {action === "archive"
          ? `It will hide from the active lists. It keeps versions, approvals, dependencies, ` +
            `baselines and generations, and you can still read its history. You cannot edit, generate ` +
            `or approve on ${targetName(target)} until restored.`
          : `It will return to the active lists with all its history intact.${
              preview.kind === "module"
                ? " What was individually archived inside stays archived."
                : ""
            }`}
      </p>
      <div className="modal-actions">
        <button type="button" className="primary" onClick={onConfirm} disabled={busy}>
          {busy
            ? action === "archive"
              ? "Archiving…"
              : "Restoring…"
            : action === "archive"
              ? `Archive ${what} "${targetName(target)}"`
              : `Restore ${what} "${targetName(target)}"`}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
