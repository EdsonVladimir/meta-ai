// Una sesión en pantalla: instancia xterm.js con ajuste al contenedor.
// La salida entra por `handle.write` (eventos Tauri → xterm, sin React);
// las teclas salen por `onInput` hacia el PTY. Al ocultarse conserva el
// scrollback (acotado a 2000 líneas); al desmontarse se destruye.
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
  /** Recibe foco y se marca como actual (una sola). */
  active: boolean;
  /** Visible en pantalla (en paralelo, todas; en pestañas, la activa). */
  shown: boolean;
  visible: boolean;
  register: (id: string, handle: TerminalHandle | null) => void;
  onInput: (id: string, data: string) => void;
  onSize: (id: string, cols: number, rows: number) => void;
  onError: (message: string) => void;
}

/** Espera tras el último cambio de tamaño antes de avisar al PTY. */
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
      // Solo la vista mostrada mide: una oculta mide cero y ensuciaría el PTY.
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
    // Copiar/pegar explícitos. Ctrl+C sigue siendo del PTY (SIGINT) y no
    // se intercepta; Ctrl+S llega al PTY (XOFF) y el Guardar del editor lo
    // ignora dentro del panel (ver workspace).
    term.attachCustomKeyEventHandler((event) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.shiftKey && event.key.toLowerCase() === "c") {
        const selected = term.getSelection();
        if (selected !== "") {
          navigator.clipboard?.writeText(selected).catch(() => {
            callbacksRef.current.onError("No se pudo copiar: el portapapeles no está disponible.");
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
            callbacksRef.current.onError("No se pudo pegar: permite el acceso al portapapeles.");
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
            callbacksRef.current.onError("No se pudo pegar: permite el acceso al portapapeles.");
          });
        return false;
      }
      return true;
    });

    // El observador también cubre mostrar/ocultar: al reaparecer el tamaño
    // cambia y se re-mide (con antirrebote) sin código extra.
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
      aria-label={`Terminal ${id}${active ? ", activa" : ""}. Ctrl C interrumpe, Ctrl Mayús C copia, Ctrl Mayús V pega.`}
    />
  );
}
