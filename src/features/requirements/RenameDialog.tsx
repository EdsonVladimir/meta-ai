// Rename dialog: small form with the current name, Save and Cancel.
// Enter saves, Escape cancels. Local validation is advisory (120
// characters max, non-empty); Rust revalidates on save and rejects stale
// revisions. Renaming touches no content, versions or drafts: only the
// organizational name or the metadata title.
import { useEffect, useRef, useState } from "react";
import {
  MAX_NAME_CHARS,
  renameKindLabel,
  renameTargetId,
  validateName,
  type RenameTarget,
} from "./names";

interface RenameDialogProps {
  target: RenameTarget;
  busy: boolean;
  error: string | null;
  /** Initial authorship for the title history (requirement/design). */
  author: string;
  onConfirm: (name: string, author: string) => void;
  onClose: () => void;
}

export function RenameDialog({ target, busy, error, author, onConfirm, onClose }: RenameDialogProps) {
  const [value, setValue] = useState(target.current);
  const [by, setBy] = useState(author);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const needsAuthor = target.kind === "requirement" || target.kind === "design";
  const kindLabel = renameKindLabel(target.kind);
  const id = renameTargetId(target);

  // Initial focus in the field, with the name selected for replacing.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Escape cancels (except while saving).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const invalid = validateName(value);
  const authorMissing = needsAuthor && by.trim() === "";
  const canSave = !busy && invalid === null && !authorMissing;

  function confirm() {
    if (!canSave) return;
    onConfirm(value.trim(), by.trim());
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Rename ${kindLabel} ${id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>
            Rename {kindLabel} <code>{id}</code>
          </h3>
          <button
            type="button"
            className="secondary small"
            onClick={onClose}
            disabled={busy}
            aria-label="Cancel rename"
          >
            ✕
          </button>
        </div>
        <label className="field">
          <span>{needsAuthor ? "Title" : "Name"}</span>
          <input
            ref={inputRef}
            type="text"
            value={value}
            maxLength={MAX_NAME_CHARS + 20}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirm();
            }}
            disabled={busy}
            autoComplete="off"
            aria-invalid={invalid !== null}
          />
        </label>
        {invalid !== null && (
          <p className="error" role="alert">
            {invalid}
          </p>
        )}
        {needsAuthor && (
          <label className="field">
            <span>Change authorship</span>
            <input
              type="text"
              value={by}
              onChange={(e) => setBy(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
              disabled={busy}
              placeholder="Your name"
              autoComplete="off"
            />
          </label>
        )}
        <p className="hint">
          {target.kind === "requirement" || target.kind === "design"
            ? target.expected === null && target.derived !== null
              ? `No own title: it now shows "${target.derived}" (first line). The ID does not change.`
              : "The ID, content, versions and approvals do not change."
            : "Organizational name: the ID and everything else stay put."}
        </p>
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={confirm}
            disabled={!canSave}
            title={invalid ?? (authorMissing ? "State the change authorship." : undefined)}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
