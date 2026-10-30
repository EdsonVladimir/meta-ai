// Shared pieces of the visual-editor inspector: commit-on-blur editing
// (history is not dirtied on every keystroke), requirement citations,
// deletion confirmation and design metadata.
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
 * Field that commits on blur or Enter (Escape reverts). It restarts
 * with `key` when the external value changes (e.g. undo).
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

/** Requirement citations: checkboxes over the declared source set. */
export function RefsPicker({ allowed, selected, onChange }: RefsPickerProps) {
  if (allowed.length === 0) {
    return <p className="hint">No citable sources in this design.</p>;
  }
  function toggle(id: string, checked: boolean) {
    onChange(
      checked ? [...selected, id].sort() : selected.filter((ref) => ref !== id),
    );
  }
  return (
    <fieldset className="refs-picker">
      <legend>Cited requirements</legend>
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

interface MockupRefsEditorProps {
  /** Citable mockups (declared-set identifiers). */
  mockups: string[];
  selected: string[];
  onChange: (refs: string[]) => void;
}

/**
 * Citations to `mockup/component` motivating the element: which mockup
 * field or action justifies this node or entity. Informational, not
 * dependencies. The component is typed by hand: Rust requires the
 * mockup in the set and the alphabet, without checking fine-grained
 * existence (like `designs` in mockups).
 */
export function MockupRefsEditor({ mockups, selected, onChange }: MockupRefsEditorProps) {
  const [mockup, setMockup] = useState(mockups[0] ?? "");
  const [element, setElement] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (mockups.length === 0) {
    return <p className="hint">No citable mockups in this design.</p>;
  }
  function add(): void {
    setError(null);
    const clean = element.trim();
    if (!/^[A-Za-z0-9_]{1,64}$/.test(clean)) {
      setError("The component uses letters, digits and underscore.");
      return;
    }
    const ref = `${mockup}/${clean}`;
    if (selected.includes(ref)) {
      setError("That citation already exists.");
      return;
    }
    onChange([...selected, ref]);
    setElement("");
  }
  return (
    <div className="field">
      <span>Motivated by (mockup/component)</span>
      {selected.length > 0 && (
        <ul className="question-list">
          {selected.map((ref) => (
            <li key={ref}>
              <code>{ref}</code>
              <button
                type="button"
                className="secondary small"
                aria-label={`Remove citation ${ref}`}
                onClick={() => onChange(selected.filter((r) => r !== ref))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="add-row">
        <select value={mockup} aria-label="Cited mockup" onChange={(e) => setMockup(e.target.value)}>
          {mockups.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={element}
          placeholder="component"
          maxLength={64}
          aria-label="Cited component"
          autoComplete="off"
          onChange={(e) => setElement(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="secondary small" onClick={add}>
          Add
        </button>
      </div>
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="hint">Which field or action justifies this element. Informational.</p>
    </div>
  );
}

interface DeleteConfirmProps {
  what: string;
  consequences: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

/** Explicit deletion confirmation with its consequences. */
export function DeleteConfirm({ what, consequences, onConfirm, onCancel }: DeleteConfirmProps) {
  return (
    <div className="delete-confirm" role="alertdialog" aria-label={`Delete ${what}`}>
      <ul>
        {consequences.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <div className="row-actions">
        <button type="button" className="danger small" onClick={onConfirm} autoFocus>
          Delete
        </button>
        <button type="button" className="secondary small" onClick={onCancel}>
          Cancel
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

/** Design title, explanation and open questions. */
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
    <section className="inspector-meta" aria-label="Design data">
      <h4>Design</h4>
      <CommitInput key={`t:${title}`} label="Title" value={title} onCommit={onTitle} maxLength={200} />
      <CommitInput
        key={`e:${explanation}`}
        label="Explanation"
        value={explanation}
        onCommit={onExplanation}
        multiline
        maxLength={2000}
      />
      <div className="field">
        <span>Open questions ({questions.length}/5)</span>
        {questions.length > 0 && (
          <ul className="question-list">
            {questions.map((question, i) => (
              <li key={`${i}:${question}`}>
                <CommitInput
                  label={`Question ${i + 1}`}
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
                  aria-label={`Remove question ${i + 1}`}
                  onClick={() => onQuestions(questions.filter((_, j) => j !== i))}
                >
                  Remove
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
              placeholder="New question"
              maxLength={1000}
              aria-label="New question"
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
              Add
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
