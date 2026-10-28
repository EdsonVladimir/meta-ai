// Piezas compartidas del inspector del editor visual: edición con
// confirmación (no se ensucia el historial a cada tecla), citas a
// requisitos, confirmación de borrado y metadatos del diseño.
import { useState } from "react";

interface CommitInputProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  multiline?: boolean;
}

/**
 * Campo que confirma al salir o pulsar Intro (Escape revierte). Se
 * reinicia con `key` cuando el valor externo cambia (p. ej. deshacer).
 */
export function CommitInput({
  label,
  value,
  onCommit,
  placeholder,
  maxLength,
  multiline,
}: CommitInputProps) {
  const [text, setText] = useState(value);
  function commit() {
    if (text !== value) onCommit(text);
  }
  const field =
    multiline === true ? (
      <textarea
        value={text}
        rows={3}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Escape") setText(value);
        }}
      />
    ) : (
      <input
        type="text"
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") setText(value);
        }}
      />
    );
  return (
    <label className="field">
      <span>{label}</span>
      {field}
    </label>
  );
}

interface RefsPickerProps {
  allowed: string[];
  selected: string[];
  onChange: (refs: string[]) => void;
}

/** Citas a requisitos: casillas sobre el conjunto de fuentes declaradas. */
export function RefsPicker({ allowed, selected, onChange }: RefsPickerProps) {
  if (allowed.length === 0) {
    return <p className="hint">Sin fuentes citables en este diseño.</p>;
  }
  function toggle(id: string, checked: boolean) {
    onChange(
      checked ? [...selected, id].sort() : selected.filter((ref) => ref !== id),
    );
  }
  return (
    <fieldset className="refs-picker">
      <legend>Requisitos citados</legend>
      {allowed.map((id) => (
        <label key={id} className="check">
          <input
            type="checkbox"
            checked={selected.includes(id)}
            onChange={(e) => toggle(id, e.target.checked)}
          />
          <code>{id}</code>
        </label>
      ))}
    </fieldset>
  );
}

interface DeleteConfirmProps {
  what: string;
  consequences: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmación explícita de borrado con sus consecuencias. */
export function DeleteConfirm({ what, consequences, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="delete-confirm" role="alertdialog" aria-label={`Eliminar ${what}`}>
      <ul>
        {consequences.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <div className="row-actions">
        <button type="button" className="danger small" onClick={onConfirm} autoFocus>
          Eliminar
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

interface DesignMetaFormProps {
  title: string;
  explanation: string;
  questions: string[];
  onTitle: (title: string) => void;
  onExplanation: (explanation: string) => void;
  onQuestions: (questions: string[]) => void;
}

/** Título, explicación y preguntas pendientes del diseño. */
export function DesignMetaForm({
  title,
  explanation,
  questions,
  onTitle,
  onExplanation,
  onQuestions,
}: DesignMetaFormProps) {
  const [draft, setDraft] = useState("");
  return (
    <section className="inspector-meta" aria-label="Datos del diseño">
      <h4>Diseño</h4>
      <CommitInput key={`t:${title}`} label="Título" value={title} onCommit={onTitle} maxLength={200} />
      <CommitInput
        key={`e:${explanation}`}
        label="Explicación"
        value={explanation}
        onCommit={onExplanation}
        multiline
        maxLength={2000}
      />
      <div className="field">
        <span>Preguntas pendientes ({questions.length}/5)</span>
        {questions.length > 0 && (
          <ul className="question-list">
            {questions.map((question, i) => (
              <li key={`${i}:${question}`}>
                <CommitInput
                  label={`Pregunta ${i + 1}`}
                  value={question}
                  maxLength={1000}
                  onCommit={(next) => {
                    const list = [...questions];
                    list[i] = next;
                    onQuestions(list);
                  }}
                />
                <button
                  type="button"
                  className="secondary small"
                  aria-label={`Quitar pregunta ${i + 1}`}
                  onClick={() => onQuestions(questions.filter((_, j) => j !== i))}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        )}
        {questions.length < 5 && (
          <div className="add-row">
            <input
              type="text"
              value={draft}
              placeholder="Nueva pregunta"
              maxLength={1000}
              aria-label="Nueva pregunta"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim() !== "") {
                  onQuestions([...questions, draft.trim()]);
                  setDraft("");
                }
              }}
            />
            <button
              type="button"
              className="secondary small"
              disabled={draft.trim() === ""}
              onClick={() => {
                onQuestions([...questions, draft.trim()]);
                setDraft("");
              }}
            >
              Añadir
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
