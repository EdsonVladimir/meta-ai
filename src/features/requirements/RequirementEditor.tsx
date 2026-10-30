import type { RequirementDetail, VersionDto } from "./types";
import { approvalsForVersion, currentVersion } from "./types";

interface RequirementEditorProps {
  detail: RequirementDetail;
  draft: string;
  dirty: boolean;
  author: string;
  viewing: VersionDto | null;
  busy: boolean;
  error: string | null;
  /** Effectively archived: history reading, no editing or saving. */
  readOnly: boolean;
  onEdit: (content: string) => void;
  onAuthorChange: (author: string) => void;
  onSave: () => void;
  onBackToCurrent: () => void;
  /** Rename the requirement; absent = no action (reading mount). */
  onRename?: () => void;
}

export function RequirementEditor({
  detail,
  draft,
  dirty,
  author,
  viewing,
  busy,
  error,
  readOnly,
  onEdit,
  onAuthorChange,
  onSave,
  onBackToCurrent,
  onRename,
}: RequirementEditorProps) {
  const current = currentVersion(detail);
  const title = detail.artifact.title;

  if (viewing !== null) {
    const approvals = approvalsForVersion(detail, viewing.id);
    return (
      <section className="editor" aria-label="Earlier version reading">
        <div className="editor-head">
          <h3>
            {title !== null && title !== "" ? (
              <>
                {title} <code>{detail.artifact.id}</code>
              </>
            ) : (
              <code>{detail.artifact.id}</code>
            )}{" "}
            · v{viewing.number} <span className="badge">reading</span>
          </h3>
          <button type="button" className="secondary small" onClick={onBackToCurrent}>
            Back to current (v{current?.number})
          </button>
        </div>
        <p className="hint">
          Provenance: {provenanceLabel(viewing)} ·{" "}
          {approvals.length === 0
            ? "unapproved"
            : approvals.map((a) => `approved by ${a.approvedBy} on ${a.at}`).join("; ")}
        </p>
        <pre className="readonly-box">{viewing.content}</pre>
        <p className="hint">Earlier versions cannot be edited or approved as current.</p>
      </section>
    );
  }

  return (
    <section className="editor" aria-label="Requirement editor">
      <div className="editor-head">
        <h3>
          {title !== null && title !== "" ? (
            <>
              {title} <code>{detail.artifact.id}</code>
            </>
          ) : (
            <code>{detail.artifact.id}</code>
          )}{" "}
          · v{current?.number} <span className="badge">current</span>
          {dirty && <span className="badge dirty">unsaved</span>}
          {readOnly && <span className="badge">archived</span>}
        </h3>
        {onRename !== undefined && (
          <button
            type="button"
            className="secondary small"
            onClick={onRename}
            disabled={busy || readOnly}
            title={readOnly ? "Restore the requirement before renaming it" : "Rename requirement"}
          >
            Rename
          </button>
        )}
      </div>
      {readOnly && (
        <p className="notice" role="note">
          Archived: you can read the history in Review, but not edit or
          save until restored.
        </p>
      )}
      <label className="field">
        <span>Content (local draft)</span>
        <textarea
          value={draft}
          onChange={(e) => onEdit(e.target.value)}
          rows={10}
          disabled={busy || readOnly}
          placeholder="Describe the requirement…"
        />
      </label>
      <div className="editor-row">
        <label className="field inline">
          <span>Version authorship</span>
          <input
            type="text"
            value={author}
            onChange={(e) => onAuthorChange(e.target.value)}
            disabled={busy || readOnly}
            placeholder="Your name"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          className="primary"
          onClick={onSave}
          disabled={busy || !dirty || readOnly}
          title={
            readOnly
              ? "Archived: restore it to save"
              : !dirty
                ? "No changes to save"
                : "Save new version (Ctrl+S)"
          }
        >
          {busy ? "Saving…" : "Save new version"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        Saving creates a new version without touching history. Recording a
        name as authorship is not authentication.
      </p>
    </section>
  );
}

function provenanceLabel(version: VersionDto): string {
  return version.provenance.kind === "ai"
    ? `AI proposal (${version.provenance.by})`
    : version.provenance.by;
}
