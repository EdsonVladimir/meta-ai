// One session on screen: an xterm.js instance fitted to its container.
// Output enters through `handle.write` (Tauri events → xterm, no React);
// keys leave through `onInput` toward the PTY. Hiding keeps the
// scrollback (capped at 2000 lines); unmounting destroys it.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface TerminalHandle {
  write: (data: string) => void;
  clear: () => void;
  focus: () => void;
}

interface TerminalViewProps {
  id: string;
  /** Receives focus and is marked current (only one). */
  active: boolean;
  /** On screen (side by side: all of them; tabs: the active one). */
  shown: boolean;
  visible: boolean;
  register: (id: string, handle: TerminalHandle | null) => void;
  onInput: (id: string, data: string) => void;
  onSize: (id: string, cols: number, rows: number) => void;
  onError: (message: string) => void;
}

/** Wait after the last resize before notifying the PTY. */
const RESIZE_DEBOUNCE_MS = 150;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

export function TerminalView({ id, active, shown, visible, register, onInput, onSize, onError }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onInput, onSize, onError });
  callbacksRef.current = { onInput, onSize, onError };
  const shownRef = useRef({ shown, visible });
  shownRef.current = { shown, visible };

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const term = new Terminal({
      theme: {
        background: cssVar("--panel", "#1b2129"),
        foreground: cssVar("--fg", "#e6edf3"),
        cursor: cssVar("--accent", "#3ddc97"),
        selectionBackground: "rgba(61, 220, 151, 0.3)",
      },
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 2000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    let lastSent = "";
    const sendSize = () => {
      // Only the shown view measures: a hidden one measures zero and would dirty the PTY.
      if (!shownRef.current.shown || !shownRef.current.visible) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      const dims = fit.proposeDimensions();
      if (dims === undefined || dims.cols < 2 || dims.rows < 1) return;
      term.resize(dims.cols, dims.rows);
      const key = `${dims.cols}x${dims.rows}`;
      if (key !== lastSent) {
        lastSent = key;
        callbacksRef.current.onSize(id, dims.cols, dims.rows);
      }
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleSize = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        sendSize();
      }, RESIZE_DEBOUNCE_MS);
    };

    const onData = term.onData((data) => callbacksRef.current.onInput(id, data));
    // Explicit copy/paste. Ctrl+C still belongs to the PTY (SIGINT) and
    // is not intercepted; Ctrl+S reaches the PTY (XOFF) and the editor's
    // Save ignores it inside the panel (see workspace).
    term.attachCustomKeyEventHandler((event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        const selected = term.getSelection();
        if (selected !== "") {
          navigator.clipboard?.writeText(selected).catch(() => {
            callbacksRef.current.onError("Could not copy: the clipboard is not available.");
          });
        }
        return false;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === "v") {
        navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text !== "") callbacksRef.current.onInput(id, text);
          })
          .catch(() => {
            callbacksRef.current.onError("Could not paste: allow clipboard access.");
          });
        return false;
      }
      if (event.key === "Insert" && event.shiftKey) {
        navigator.clipboard
          ?.readText()
          .then((text) => {
            if (text !== "") callbacksRef.current.onInput(id, text);
          })
          .catch(() => {
            callbacksRef.current.onError("Could not paste: allow clipboard access.");
          });
        return false;
      }
      return true;
    });

    // The observer also covers show/hide: on reappearing the size
    // changes and is re-measured (debounced) with no extra code.
    const observer = new ResizeObserver(scheduleSize);
    observer.observe(container);
    sendSize();

    register(id, {
      write: (data) => term.write(data),
      clear: () => term.clear(),
      focus: () => term.focus(),
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      onData.dispose();
      register(id, null);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div
      ref={containerRef}
      className="terminal-view"
      hidden={!shown}
      role="application"
      aria-label={`Terminal ${id}${active ? ", active" : ""}. Ctrl C interrupts, Ctrl Shift C copies, Ctrl Shift V pastes.`}
    />
  );
}
