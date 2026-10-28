// Diálogo de renombrado: formulario pequeño con el nombre actual, Guardar
// y Cancelar. Enter guarda, Escape cancela. La validación local es
// orientativa (máximo 120 caracteres, no vacío); Rust revalida al guardar
// y rechaza revisiones obsoletas. Renombrar no toca contenido, versiones
// ni borradores: solo el nombre organizativo o el título metadato.
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
  /** Autoría inicial para el historial de títulos (requisito/diagrama). */
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

  // Foco inicial en el campo, con el nombre seleccionado para reemplazarlo.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Escape cancela (salvo mientras se guarda).
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
        aria-label={`Renombrar ${kindLabel} ${id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h3>
            Renombrar {kindLabel} <code>{id}</code>
          </h3>
          <button
            type="button"
            className="secondary small"
            onClick={onClose}
            disabled={busy}
            aria-label="Cancelar renombrado"
          >
            ✕
          </button>
        </div>
        <label className="field">
          <span>{needsAuthor ? "Título" : "Nombre"}</span>
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
            <span>Autoría del cambio</span>
            <input
              type="text"
              value={by}
              onChange={(e) => setBy(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
              disabled={busy}
              placeholder="Tu nombre"
              autoComplete="off"
            />
          </label>
        )}
        <p className="hint">
          {target.kind === "requirement" || target.kind === "design"
            ? target.expected === null && target.derived !== null
              ? `Sin título propio: ahora se muestra «${target.derived}» (primera línea). El ID no cambia.`
              : "El ID, el contenido, las versiones y las aprobaciones no cambian."
            : "Nombre organizativo: el ID y todo lo demás no cambian."}
        </p>
        {error !== null && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="primary"
            onClick={confirm}
            disabled={!canSave}
            title={invalid ?? (authorMissing ? "Indica la autoría del cambio." : undefined)}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}
