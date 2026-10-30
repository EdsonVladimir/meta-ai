// Bottom terminal panel: tabs (up to three), starting folder, actions
// and lifecycle notices. Always mounted: hiding keeps sessions and
// scrollback; output goes straight into xterm without React.
//
// The terminal has the user's permissions: it is not a sandbox and is
// not confined to the starting folder (see README). Ruth scrubs the
// `META_*` family from the child environment, but the shell may load
// credentials from the user's personal configuration.
import { Fragment, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  addTerminalTab,
  applyTerminalExit,
  canCreateTerminal,
  createUnlistenCollector,
  dragPaneWidths,
  dropPaneWidth,
  equalPaneWidths,
  needsTerminalCloseConfirm,
  nextActiveTerminal,
  removeTerminalTab,
  shortTerminalCwd,
  terminalStatusLabel,
  type TerminalLayout,
} from "./coordination";
import {
  closeTerminal,
  createTerminal,
  isTauriEnvironment,
  listenTerminalCloseRequested,
  listenTerminalExit,
  listenTerminalOutput,
  listTerminals,
  normalizeTerminalError,
  quitAppWithTerminals,
  resizeTerminal,
  writeTerminal,
} from "./client";
import { TerminalView, type TerminalHandle } from "./TerminalView";
import type { TerminalTab } from "./types";
import {
  DEFAULT_TERMINAL_HEIGHT,
  MAX_TERMINAL_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  RESIZE_KEYBOARD_STEP_FRAC,
  RESIZE_KEYBOARD_STEP_PX,
  useRequirementsUi,
} from "../requirements/uiStore";
/** Paste chunks well below the Rust cap (256 KiB). */
const WRITE_CHUNK = 60 * 1024;
/** Minimum width of a side-by-side pane (mirrors the CSS). */
const MIN_PANE_PX = 240;

interface TerminalPanelProps {
  visible: boolean;
  onHide: () => void;
}

export function TerminalPanel({ visible, onHide }: TerminalPanelProps) {
  const desktop = isTauriEnvironment();
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [layout, setLayout] = useState<TerminalLayout>("tabs");
  /** Sizes persisted in the store (across sessions). */
  const widths = useRequirementsUi((s) => s.terminalPaneWidths);
  const storedHeight = useRequirementsUi((s) => s.terminalHeight);
  const height = storedHeight ?? DEFAULT_TERMINAL_HEIGHT;
  const maximized = useRequirementsUi((s) => s.terminalMaximized);
  const [folder, setFolder] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [closing, setClosing] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);
  const [quitRequest, setQuitRequest] = useState<number | null>(null);
  const handlesRef = useRef(new Map<string, TerminalHandle>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const cancelledRef = useRef(false);
  const terminalRequest = useRequirementsUi((s) => s.terminalRequest);
  const handledTerminalReq = useRef(0);

  // "Open terminal here" from the code tree: one session in that folder,
  // without touching the open ones. Each request is served once.
  useEffect(() => {
    if (!desktop || terminalRequest === null) return;
    if (terminalRequest.nonce === handledTerminalReq.current) return;
    handledTerminalReq.current = terminalRequest.nonce;
    void handleCreate(terminalRequest.cwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop, terminalRequest]);

  // Initial reconciliation and one-time subscriptions: output goes straight
  // to xterm (no setState per chunk) and exits update the tab.
  useEffect(() => {
    if (!desktop) return;
    cancelledRef.current = false;
    void (async () => {
      try {
        const listed = await listTerminals();
        if (cancelledRef.current) return;
        setTabs(listed.map((info) => ({ info })));
        setActiveId((prev) => prev ?? listed[0]?.id ?? null);
      } catch (raw) {
        if (!cancelledRef.current) setError(normalizeTerminalError(raw).message);
      }
    })();
    // Collector: if unmounting arrives before resolving (dev mounts twice),
    // late unsubscribes apply immediately and no orphaned listeners
    // duplicate the output.
    const collector = createUnlistenCollector();
    collector.track(
      listenTerminalOutput((event) => {
        // Leftovers from already-closed sessions are silently ignored.
        handlesRef.current.get(event.id)?.write(event.data);
      }),
    );
    collector.track(
      listenTerminalExit((event) => {
        setTabs((prev) => applyTerminalExit(prev, event.id, event.code));
      }),
    );
    collector.track(
      listenTerminalCloseRequested((event) => {
        setQuitRequest(event.running);
      }),
    );
    return () => {
      cancelledRef.current = true;
      collector.dispose();
    };
  }, [desktop]);

  // Focus the active one when showing the panel or switching tabs/layout.
  useEffect(() => {
    if (!visible || activeId === null) return;
    const frame = requestAnimationFrame(() => {
      handlesRef.current.get(activeId)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, activeId, tabs.length, layout]);

  function registerHandle(id: string, handle: TerminalHandle | null) {
    // One session, one view instance: if anything tried to mount two
    // views for the same id, warn instead of duplicating output.
    if (handle === null) {
      handlesRef.current.delete(id);
    } else {
      if (handlesRef.current.has(id)) {
        console.warn(`Terminal ${id}: already had a view attached; replacing it.`);
      }
      handlesRef.current.set(id, handle);
    }
  }

  async function handleInput(id: string, data: string) {
    try {
      for (let at = 0; at < data.length; at += WRITE_CHUNK) {
        await writeTerminal(id, data.slice(at, at + WRITE_CHUNK));
      }
    } catch (raw) {
      const err = normalizeTerminalError(raw);
      if (err.kind === "unknown_session" || err.kind === "session_exited") {
        setTabs((prev) => applyTerminalExit(prev, id, prev.find((t) => t.info.id === id)?.info.exitCode ?? null));
      }
      setError(err.message);
    }
  }

  async function handleSize(id: string, cols: number, rows: number) {
    try {
      await resizeTerminal(id, cols, rows);
    } catch (raw) {
      const err = normalizeTerminalError(raw);
      // Resizing a session that just ended is not an error for the
      // person: its state already tells the story.
      if (err.kind === "unknown_session" || err.kind === "session_exited") return;
      setError(err.message);
    }
  }

  async function handleCreate(cwd: string | null = folder) {
    if (creating) return;
    if (!canCreateTerminal(tabsRef.current)) {
      setError("3-session limit: close one to open another.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // 80×24 at start: the view measures and fits the PTY on mount.
      const info = await createTerminal(cwd, 80, 24);
      if (cancelledRef.current) return;
      setTabs((prev) => addTerminalTab(prev, info));
      setActiveId(info.id);
      // New session: even split side by side.
      useRequirementsUi.getState().setTerminalPaneWidths(null);
    } catch (raw) {
      if (!cancelledRef.current) setError(normalizeTerminalError(raw).message);
    } finally {
      if (!cancelledRef.current) setCreating(false);
    }
  }

  async function handleClose(id: string) {
    const tab = tabsRef.current.find((candidate) => candidate.info.id === id);
    if (tab === undefined || closing) return;
    if (needsTerminalCloseConfirm(tab)) {
      setCloseConfirmId(id);
      return;
    }
    await doClose(id);
  }

  async function doClose(id: string) {
    setClosing(true);
    setCloseConfirmId(null);
    try {
      await closeTerminal(id);
    } catch (raw) {
      const err = normalizeTerminalError(raw);
      // If Rust no longer knows it, it was closed: same effect.
      if (err.kind !== "unknown_session") {
        setError(err.message);
        setClosing(false);
        return;
      }
    }
    const closedIndex = tabsRef.current.findIndex((tab) => tab.info.id === id);
    setTabs((prev) => removeTerminalTab(prev, id));
    setActiveId((prev) => nextActiveTerminal(tabsRef.current, id, prev));
    // Space is redistributed among the rest.
    {
      const prev = useRequirementsUi.getState().terminalPaneWidths;
      useRequirementsUi
        .getState()
        .setTerminalPaneWidths(
          prev !== null && prev.length === tabsRef.current.length
            ? dropPaneWidth(prev, closedIndex)
            : null,
        );
    }
    setClosing(false);
  }

  function handleClear(id: string) {
    // View and scrollback only: the shell never notices (no PTY involved).
    handlesRef.current.get(id)?.clear();
  }

  async function handlePickFolder() {
    try {
      const chosen = await open({ directory: true, multiple: false, title: "Terminal starting folder" });
      if (typeof chosen === "string") {
        setFolder(chosen);
        setError(null);
      }
    } catch (raw) {
      setError(normalizeTerminalError(raw).message);
    }
  }

  async function handleQuit() {
    setQuitting(true);
    try {
      await quitAppWithTerminals();
    } catch (raw) {
      setError(normalizeTerminalError(raw).message);
      setQuitting(false);
      setQuitRequest(null);
    }
  }

  function activeTab(): TerminalTab | undefined {
    return tabs.find((tab) => tab.info.id === activeId);
  }

  const panesRef = useRef<HTMLDivElement | null>(null);

  function onPaneSepPointerDown(event: React.PointerEvent<HTMLDivElement>, index: number) {
    event.preventDefault();
    const container = panesRef.current;
    if (container === null) return;
    const containerWidth = container.getBoundingClientRect().width;
    if (containerWidth <= 0) return;
    const startX = event.clientX;
    const start = fractions;
    const minFrac = MIN_PANE_PX / containerWidth;
    const onMove = (move: PointerEvent) => {
      useRequirementsUi
        .getState()
        .setTerminalPaneWidths(
          dragPaneWidths(start, index, (move.clientX - startX) / containerWidth, minFrac),
        );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onPaneSepKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number) {
    const container = panesRef.current;
    if (container === null) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth <= 0) return;
      const delta = event.key === "ArrowRight" ? RESIZE_KEYBOARD_STEP_FRAC : -RESIZE_KEYBOARD_STEP_FRAC;
      useRequirementsUi
        .getState()
        .setTerminalPaneWidths(
          dragPaneWidths(fractions, index, delta, MIN_PANE_PX / containerWidth),
        );
    } else if (event.key === "Home") {
      event.preventDefault();
      useRequirementsUi.getState().setTerminalPaneWidths(null);
    }
  }

  function onDragHandlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent) => {
      const next = startHeight + (startY - move.clientY);
      useRequirementsUi
        .getState()
        .setTerminalHeight(
          Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, Math.round(next))),
        );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onDragHandleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? RESIZE_KEYBOARD_STEP_PX : -RESIZE_KEYBOARD_STEP_PX;
      useRequirementsUi
        .getState()
        .setTerminalHeight(
          Math.min(MAX_TERMINAL_HEIGHT, Math.max(MIN_TERMINAL_HEIGHT, height + delta)),
        );
    } else if (event.key === "Home") {
      event.preventDefault();
      useRequirementsUi.getState().setTerminalHeight(null);
    }
  }

  if (!desktop) {
    return (
      <section className="terminal-panel" hidden={!visible} aria-label="Terminal">
        <p className="hint">The integrated terminal needs the Ruth IDE desktop app. Nothing to run here.</p>
      </section>
    );
  }

  const active = activeTab();
  const fractions =
    widths !== null && widths.length === tabs.length ? widths : equalPaneWidths(tabs.length);
  return (
    <section
      className={`terminal-panel${maximized ? " maximized" : ""}`}
      hidden={!visible}
      aria-label="Terminal"
      style={maximized ? undefined : { height: `min(${height}px, calc(100dvh - 10rem))` }}
    >
      <div
        className="terminal-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Terminal panel height"
        aria-valuenow={height}
        aria-valuemin={MIN_TERMINAL_HEIGHT}
        aria-valuemax={MAX_TERMINAL_HEIGHT}
        tabIndex={0}
        onPointerDown={onDragHandlePointerDown}
        onKeyDown={onDragHandleKeyDown}
      />
      <div className="terminal-head">
        {layout === "tabs" ? (
          <div className="terminal-tabs" role="tablist" aria-label="Sessions">
            {tabs.length === 0 && <span className="hint">No sessions: create the first.</span>}
            {tabs.map((tab) => (
              <SessionHead
                key={tab.info.id}
                tab={tab}
                active={tab.info.id === activeId}
                asTab
                closing={closing}
                onSelect={() => setActiveId(tab.info.id)}
                onClear={() => handleClear(tab.info.id)}
                onClose={() => void handleClose(tab.info.id)}
              />
            ))}
          </div>
        ) : (
          <span className="hint">
            {tabs.length === 0
              ? "No sessions: create the first."
              : `${tabs.length} ${tabs.length === 1 ? "session" : "sessions"} side by side.`}
          </span>
        )}
        <div className="terminal-actions" role="toolbar" aria-label="Terminal actions">
          <button
            type="button"
            className="term-tool"
            onClick={() => void handleCreate()}
            disabled={creating || !canCreateTerminal(tabs)}
            aria-label={creating ? "Opening session" : "New terminal"}
            title={
              creating
                ? "Opening…"
                : canCreateTerminal(tabs)
                  ? "New terminal"
                  : "Three-session limit: close one first"
            }
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => setLayout((prev) => (prev === "tabs" ? "parallel" : "tabs"))}
            aria-label={layout === "tabs" ? "View side by side" : "View as tabs"}
            title={layout === "tabs" ? "View side by side" : "View as tabs"}
          >
            {layout === "tabs" ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M6.5 2.5v11M9.5 2.5v11M2.5 2.5h11v11h-11z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M2.5 5.5v8h11v-8M2.5 5.5L4 2.5h6l1.5 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => void handlePickFolder()}
            aria-label="Folder for new sessions"
            title="Folder for new sessions"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3.5L8 5h5a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => useRequirementsUi.getState().setTerminalMaximized(!maximized)}
            aria-label={maximized ? "Restore terminal panel" : "Maximize terminal panel"}
            aria-pressed={maximized}
            title={maximized ? "Restore previous layout" : "Fill the workbench (terminal only)"}
          >
            {maximized ? (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M6 9.5H2.5V6 M2.5 9.5 8 4 M10 6.5h3.5V10 M13.5 6.5 8 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M9.5 2.5h4v4 M13.5 2.5 8 8 M6.5 13.5h-4v-4 M2.5 13.5l5.5-5.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
          <button
            type="button"
            className="term-tool"
            onClick={() => {
              useRequirementsUi.getState().setTerminalMaximized(false);
              onHide();
            }}
            aria-label="Hide terminal panel"
            title="Hide panel (sessions keep running)"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M3.5 6 8 10.5 12.5 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
      <p className="hint terminal-cwd" title={folder ?? undefined}>
        New sessions folder: {folder ?? "your home folder (default)"}. Open ones
        keep theirs. The terminal has your permissions: it is not a sandbox.
      </p>
      {/*
        One structure for both layouts: xterm views never unmount when
        toggling (stable keys), so no output is lost and nothing
        restarts. In tabs, by construction: pane headers don't render
        (only the strip), inactive wrappers carry inline `display:none`
        and the active one `flex:1`; a stylesheet failure cannot show
        two levels or squeezed side-by-side panes.
      */}
      <div
        className="terminal-panes"
        ref={panesRef}
        role="group"
        aria-label={layout === "tabs" ? "Active session" : "Sessions side by side"}
      >
        {tabs.map((tab, index) => {
          const isActive = tab.info.id === activeId;
          const hiddenInTabs = layout === "tabs" && !isActive;
          return (
            <Fragment key={tab.info.id}>
              {layout === "parallel" && index > 0 && (
                <div
                  key={`sep-${tab.info.id}`}
                  className="terminal-sep"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Width between ${tabs[index - 1].info.id} and ${tab.info.id}`}
                  tabIndex={0}
                  onPointerDown={(event) => onPaneSepPointerDown(event, index - 1)}
                  onKeyDown={(event) => onPaneSepKeyDown(event, index - 1)}
                />
              )}
              <div
                key={`wrap-${tab.info.id}`}
                className="terminal-pane-wrap"
                hidden={hiddenInTabs}
                style={
                  layout === "parallel"
                    ? { flexGrow: fractions[index], flexShrink: 1, flexBasis: 0 }
                    : hiddenInTabs
                      ? { display: "none" }
                      : { flex: "1 1 auto" }
                }
              >
                <div
                  className={`terminal-pane${isActive ? " focused" : ""}${layout === "tabs" ? " flat" : ""}`}
                  onFocusCapture={() => setActiveId(tab.info.id)}
                >
                  {layout === "parallel" && (
                    <SessionHead
                      tab={tab}
                      active={isActive}
                      asTab={false}
                      closing={closing}
                      onSelect={() => setActiveId(tab.info.id)}
                      onClear={() => handleClear(tab.info.id)}
                      onClose={() => void handleClose(tab.info.id)}
                    />
                  )}
                  <div className="terminal-pane-body">
                    <TerminalView
                      id={tab.info.id}
                      active={isActive}
                      shown={layout === "parallel" || isActive}
                      visible={visible}
                      register={registerHandle}
                      onInput={(id, data) => void handleInput(id, data)}
                      onSize={(id, cols, rows) => void handleSize(id, cols, rows)}
                      onError={setError}
                    />
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
        {tabs.length === 0 && <TerminalEmpty />}
      </div>
      {active !== undefined && (
        <p className="hint terminal-status">
          {active.info.shell} · {active.info.cwd} · {active.info.cols}×{active.info.rows} ·{" "}
          {terminalStatusLabel(active.info)}
          {!active.info.running && " — close the tab whenever you want; its text stays above."}
        </p>
      )}
      {error !== null && (
        <p className="error terminal-error" role="alert">
          {error}{" "}
          <button type="button" className="secondary small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}
      {closeConfirmId !== null && (
        <div className="modal-backdrop" onClick={() => setCloseConfirmId(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Close ${closeConfirmId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Close {closeConfirmId}</h3>
            <p>Its process will end. Are you sure?</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setCloseConfirmId(null)} autoFocus>
                Cancel
              </button>
              <button type="button" className="danger" onClick={() => void doClose(closeConfirmId)}>
                Close session
              </button>
            </div>
          </div>
        </div>
      )}
      {quitRequest !== null && (
        <div className="modal-backdrop" onClick={() => setQuitRequest(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label="Close with open terminals"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>
              {quitRequest} {quitRequest === 1 ? "running terminal" : "running terminals"}
            </h3>
            <p>Closing Ruth IDE will end their processes. Processes are not restored on reopen.</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setQuitRequest(null)} autoFocus>
                Keep working
              </button>
              <button type="button" className="danger" onClick={() => void handleQuit()} disabled={quitting}>
                {quitting ? "Closing…" : "Close Ruth IDE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * A session header (tab or pane): name and status plus its own Clear
 * and Close icons. Sibling buttons, never nested: pressing clear/close
 * never selects or activates another session by accident.
 */
function SessionHead({
  tab,
  active,
  asTab,
  closing,
  onSelect,
  onClear,
  onClose,
}: {
  tab: TerminalTab;
  active: boolean;
  asTab: boolean;
  closing: boolean;
  onSelect: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const fullTitle = `${tab.info.id} · ${tab.info.shell} · ${tab.info.cwd} · ${terminalStatusLabel(tab.info)}`;
  return (
    <div className={`terminal-tab${active ? " active" : ""}`}>
      <button
        type="button"
        role={asTab ? "tab" : undefined}
        aria-selected={asTab ? active : undefined}
        aria-pressed={asTab ? undefined : active}
        className="terminal-tab-label"
        onClick={onSelect}
        title={fullTitle}
      >
        <span className={`term-dot ${tab.info.running ? "running" : "exited"}`} aria-hidden="true" />
        <span className="terminal-tab-name">
          {tab.info.id} · {shortTerminalCwd(tab.info.cwd, null)}
        </span>
      </button>
      <button
        type="button"
        className="term-icon"
        onClick={onClear}
        aria-label={`Clear ${tab.info.id} view`}
        title={`Clear ${tab.info.id} view (its process keeps running)`}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M4.5 11.5 11.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="term-icon"
        onClick={onClose}
        disabled={closing}
        aria-label={`Close ${tab.info.id}`}
        title={`Close ${tab.info.id} (ends its process)`}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function TerminalEmpty() {
  return (
    <p className="hint terminal-empty">
      Run shells, agents like <code>$HOME/.local/bin/muse</code>, servers or Git. Nothing
      runs when opening the panel: everything starts from what you type.
    </p>
  );
}
