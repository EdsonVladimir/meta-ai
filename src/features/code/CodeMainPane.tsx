// Central documents area: open-file tabs, editor and save dialogs.
// Rendered above every perspective when documents are open; opening a
// file never requires a "code" view. Scope analysis lives in the
// Architecture view; this pane only edits files.
import { useCodeWorkspace } from "./useCodeWorkspace";
import { CodeConflictDiff } from "./CodeConflictDiff";
import { CodeFileIcon } from "./CodeFileIcon";
import { CodeViewer } from "./CodeViewer";
import { tabKeyOf, tabQualifier } from "./model";

interface CodeMainPaneProps {
  /** Without own chrome: the center slot already provides panel and border. */
  bare?: boolean;
  /** Tabs strip only: the active view renders below in the same slot. */
  tabsOnly?: boolean;
}

export function CodeMainPane({ bare, tabsOnly }: CodeMainPaneProps) {
  const {
    desktop,
    show,
    loader,
    tabs,
    active,
    showDocument,
    tabButtonsRef,
    activeTab,
    handleEditorChange,
    requestCloseTab,
    closeConfirm,
    setCloseConfirm,
    closeConfirmSave,
    closeConfirmDiscard,
    closeTabLabel,
    conflict,
    setConflict,
    conflictTab,
    conflictDraft,
    comparing,
    setComparing,
    resolveConflictReload,
    resolveConflictReplace,
    prefs,
    handlePrefsChange,
    handlePrefsReset,
    handleRevealDir,
    handleTabsKey,
    reveal,
    loadTabContent,
    setTabs,
  } = useCodeWorkspace();

  if (!desktop) {
    if (tabsOnly === true) return null;
    return <p className="hint">Open documents need the Ruth IDE desktop app.</p>;
  }
  // Strip mode stays invisible until a document is open: no empty
  // chrome above the views.
  if (tabsOnly === true && tabs.length === 0) return null;

  return (
    <div className={bare === true ? "code-main bare" : "code-main"}>
      {tabs.length === 0 ? (
        <p className="hint code-empty">
          Open a file from the explorer to edit it. Ctrl+S saves the active tab.
        </p>
      ) : (
        <>
          <div
            className="code-tabs"
            role="tablist"
            aria-label="Open files"
            title="Arrow keys move between tabs"
            onKeyDown={handleTabsKey}
          >
            {tabs.map((tab) => {
              const key = tabKeyOf(tab);
              const qualifier = tabQualifier(tab, tabs);
              const selected = key === active;
              return (
                <div
                  key={key}
                  role="tab"
                  aria-selected={selected}
                  aria-label={`${tab.rel} from ${tab.rootName}${tab.dirty ? " (unsaved changes)" : ""}`}
                  className={`code-tab${selected ? " active" : ""}${tab.dirty ? " dirty" : ""}`}
                  title={`${tab.rootName} / ${tab.rel}`}
                >
                  <button
                    type="button"
                    ref={(node) => {
                      if (node === null) tabButtonsRef.current.delete(key);
                      else tabButtonsRef.current.set(key, node);
                    }}
                    className="code-tab-label"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => showDocument(key)}
                    aria-label={`Show ${tab.rel} from ${tab.rootName}`}
                  >
                    <CodeFileIcon name={tab.name} />
                    <span className="code-tab-name">{tab.name}</span>
                    {qualifier !== "" && <span className="code-tab-qual"> · {qualifier}</span>}
                  </button>
                  <button
                    type="button"
                    className={`icon-button${tab.dirty ? " dirty" : ""}`}
                    aria-label={`Close ${tab.rel}`}
                    title={tab.dirty ? "Close (has unsaved changes)" : "Close"}
                    onClick={() => requestCloseTab(key)}
                  >
                    {tab.dirty ? "●" : "×"}
                  </button>
                </div>
              );
            })}
          </div>
          {activeTab !== null && tabsOnly !== true && (
            <CodeViewer
              tab={activeTab}
              visible={show}
              prefs={prefs}
              onPrefsChange={handlePrefsChange}
              onPrefsReset={handlePrefsReset}
              onRevealDir={handleRevealDir}
              reveal={
                reveal !== null &&
                activeTab !== null &&
                tabKeyOf(activeTab) === reveal.key
                  ? { ...reveal.range, nonce: reveal.nonce }
                  : null
              }
              onRetry={() => void loadTabContent(activeTab.rootId, activeTab.rel)}
              onLanguageChange={(language) =>
                setTabs((prev) =>
                  prev.map((tab) =>
                    tabKeyOf(tab) === tabKeyOf(activeTab) ? { ...tab, language } : tab,
                  ),
                )
              }
              onEditorChange={handleEditorChange}
              loader={loader}
            />
          )}
        </>
      )}
      {closeConfirm !== null && (
        <div className="modal-backdrop" onClick={() => setCloseConfirm(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Close tab with changes"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Unsaved changes</h3>
            <p>"{closeTabLabel}" has changes not saved to disk.</p>
            <div className="button-row">
              <button type="button" className="primary" onClick={() => void closeConfirmSave()}>
                Save
              </button>
              <button
                type="button"
                className="danger"
                onClick={closeConfirmDiscard}
              >
                Discard
              </button>
              <button type="button" className="secondary" onClick={() => setCloseConfirm(null)} autoFocus>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {conflict !== null && conflictTab !== null && (
        <div className="modal-backdrop" onClick={() => { setConflict(null); setComparing(false); }}>
          <div
            className="modal code-conflict"
            role="alertdialog"
            aria-modal="true"
            aria-label="Save conflict"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>The file changed on disk</h3>
            <p>
              "{conflictTab.rootName}/{conflictTab.rel}" changed outside Ruth since you read it.
              Your draft is intact: compare and choose.
            </p>
            {comparing && (
              <CodeConflictDiff
                key={conflict.key}
                diskText={conflict.diskText}
                draftText={conflictDraft}
                language={conflictTab.language}
                prefs={prefs}
                loader={loader}
              />
            )}
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setComparing((v) => !v)}>
                {comparing ? "Hide comparison" : "Compare"}
              </button>
              <button type="button" className="secondary" onClick={resolveConflictReload}>
                Reload (discard draft)
              </button>
              <button type="button" className="danger" onClick={() => void resolveConflictReplace()}>
                Overwrite disk
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => { setConflict(null); setComparing(false); }}
                autoFocus
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
