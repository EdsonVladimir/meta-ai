// Editor presentation: local, honest controls. Nothing here changes
// content, saving or the domain.
import type { CodeDiffLayout, CodeEditorPrefs, CodeWhitespaceMode } from "./editorPrefs";

interface CodeEditorPrefsPanelProps {
  prefs: CodeEditorPrefs;
  onChange: (next: CodeEditorPrefs) => void;
  onReset: () => void;
}

export function CodeEditorPrefsPanel({ prefs, onChange, onReset }: CodeEditorPrefsPanelProps) {
  function update(patch: Partial<CodeEditorPrefs>) {
    onChange({ ...prefs, ...patch });
  }

  return (
    <details className="code-prefs">
      <summary title="Editor presentation (visual only)">Presentation</summary>
      <div className="code-prefs-panel" role="group" aria-label="Editor presentation">
        <label className="code-prefs-row">
          <input
            type="checkbox"
            checked={prefs.minimap}
            onChange={(event) => update({ minimap: event.target.checked })}
          />
          Minimap
        </label>
        <label className="code-prefs-row">
          <input
            type="checkbox"
            checked={prefs.wordWrap}
            onChange={(event) => update({ wordWrap: event.target.checked })}
          />
          Word wrap
        </label>
        <label className="code-prefs-row">
          <input
            type="checkbox"
            checked={prefs.guides}
            onChange={(event) => update({ guides: event.target.checked })}
          />
          Guides and bracket pairs
        </label>
        <label className="code-prefs-row">
          <input
            type="checkbox"
            checked={prefs.stickyScroll}
            onChange={(event) => update({ stickyScroll: event.target.checked })}
          />
          Sticky scroll header
        </label>
        <label className="code-prefs-row">
          Font size
          <input
            type="number"
            min={11}
            max={20}
            value={prefs.fontSize}
            aria-label="Font size"
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(next)) update({ fontSize: next });
            }}
          />
        </label>
        <label className="code-prefs-row">
          Line height
          <input
            type="number"
            min={16}
            max={32}
            value={prefs.lineHeight}
            aria-label="Line height"
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(next)) update({ lineHeight: next });
            }}
          />
        </label>
        <label className="code-prefs-row">
          Visible whitespace
          <select
            aria-label="Visible whitespace"
            value={prefs.whitespace}
            onChange={(event) => update({ whitespace: event.target.value as CodeWhitespaceMode })}
          >
            <option value="none">None</option>
            <option value="selection">Selection</option>
            <option value="all">All</option>
          </select>
        </label>
        <label className="code-prefs-row">
          Conflicts
          <select
            aria-label="Conflict diff layout"
            value={prefs.diffLayout}
            onChange={(event) => update({ diffLayout: event.target.value as CodeDiffLayout })}
          >
            <option value="side">Side by side</option>
            <option value="inline">Inline</option>
          </select>
        </label>
        <button type="button" className="secondary small" onClick={onReset}>
          Reset
        </button>
      </div>
    </details>
  );
}
