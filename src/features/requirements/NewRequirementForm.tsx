import { useState } from "react";

interface NewRequirementFormProps {
  busy: boolean;
  error: string | null;
  onCreate: (content: string, author: string) => void;
  onCancel: () => void;
}

export function NewRequirementForm({ busy, error, onCreate, onCancel }: NewRequirementFormProps) {
  const [content, setContent] = useState("");
  const [author, setAuthor] = useState("");

  return (
    <section className="editor" aria-label="Nuevo requisito">
      <div className="editor-head">
        <h3>Nuevo requisito</h3>
      </div>
      <label className="field">
        <span>Contenido de la primera versión</span>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          disabled={busy}
          placeholder="p. ej. Confirmar una venta descuenta stock."
        />
      </label>
      <div className="editor-row">
        <label className="field inline">
          <span>Autoría</span>
          <input
            type="text"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            disabled={busy}
            placeholder="Tu nombre"
            autoComplete="off"
          />
        </label>
        <div className="button-row">
          <button
            type="button"
            className="primary"
            onClick={() => onCreate(content, author)}
            disabled={busy || content.trim() === "" || author.trim() === ""}
          >
            {busy ? "Creando…" : "Crear requisito"}
          </button>
          <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
