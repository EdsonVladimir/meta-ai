// Panel inferior de terminal: pestañas (hasta tres), carpeta inicial,
// acciones y avisos de ciclo de vida. Siempre montado: ocultar conserva
// sesiones y scrollback; la salida entra directa a xterm sin React.
//
// La terminal tiene los permisos del usuario: no es un sandbox ni está
// confinada a la carpeta inicial (ver README). Ruth depura la familia
// `META_*` del entorno hijo, pero el shell puede cargar credenciales de
// la configuración personal del usuario.
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

const MIN_PANEL_HEIGHT = 160;
const MAX_PANEL_HEIGHT = 560;
const DEFAULT_PANEL_HEIGHT = 260;
/** Trozos de pegado muy por debajo del tope de Rust (256 KiB). */
const WRITE_CHUNK = 60 * 1024;
/** Ancho mínimo de un panel en paralelo (igual que el CSS). */
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
  /** Fracciones de ancho en paralelo; null = reparto equitativo. */
  const [widths, setWidths] = useState<number[] | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [height, setHeight] = useState(DEFAULT_PANEL_HEIGHT);
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

  // Reconciliación inicial y suscripciones únicas: la salida va directa a
  // xterm (sin setState por fragmento) y los fines actualizan la ficha.
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
    // Colector: si el desmontaje llega antes de resolverse (dev monta dos
    // veces), las bajas tardías se aplican al momento y no quedan
    // listeners huérfanos duplicando la salida.
    const collector = createUnlistenCollector();
    collector.track(
      listenTerminalOutput((event) => {
        // Los restos de sesiones ya cerradas se ignoran en silencio.
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

  // Enfocar la activa al mostrar el panel, cambiar de pestaña o de disposición.
  useEffect(() => {
    if (!visible || activeId === null) return;
    const frame = requestAnimationFrame(() => {
      handlesRef.current.get(activeId)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, activeId, tabs.length, layout]);

  function registerHandle(id: string, handle: TerminalHandle | null) {
    // Una sesión, una instancia visual: si algo intentara montar dos
    // vistas para el mismo id, se avisa en vez de duplicar salida.
    if (handle === null) {
      handlesRef.current.delete(id);
    } else {
      if (handlesRef.current.has(id)) {
        console.warn(`Terminal ${id}: ya tenía vista asociada; se sustituye.`);
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
      // Redimensionar una sesión que acaba de terminar no es un error
      // para la persona: su estado ya lo cuenta.
      if (err.kind === "unknown_session" || err.kind === "session_exited") return;
      setError(err.message);
    }
  }

  async function handleCreate() {
    if (creating || !canCreateTerminal(tabsRef.current)) return;
    setCreating(true);
    setError(null);
    try {
      // 80×24 de arranque: la vista mide y ajusta el PTY al montar.
      const info = await createTerminal(folder, 80, 24);
      if (cancelledRef.current) return;
      setTabs((prev) => addTerminalTab(prev, info));
      setActiveId(info.id);
      // Nueva sesión: reparto equitativo en paralelo.
      setWidths(null);
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
      // Si Rust ya no la conoce, estaba cerrada: el efecto es el mismo.
      if (err.kind !== "unknown_session") {
        setError(err.message);
        setClosing(false);
        return;
      }
    }
    const closedIndex = tabsRef.current.findIndex((tab) => tab.info.id === id);
    setTabs((prev) => removeTerminalTab(prev, id));
    setActiveId((prev) => nextActiveTerminal(tabsRef.current, id, prev));
    // El espacio se redistribuye entre los que quedan.
    setWidths((prev) =>
      prev !== null && prev.length === tabsRef.current.length
        ? dropPaneWidth(prev, closedIndex)
        : null,
    );
    setClosing(false);
  }

  function handleClear(id: string) {
    // Solo vista y scrollback: el shell ni se entera (sin PTY de por medio).
    handlesRef.current.get(id)?.clear();
  }

  async function handlePickFolder() {
    try {
      const chosen = await open({ directory: true, multiple: false, title: "Carpeta inicial de la terminal" });
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
      setWidths(dragPaneWidths(start, index, (move.clientX - startX) / containerWidth, minFrac));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onDragHandlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent) => {
      const next = startHeight + (startY - move.clientY);
      setHeight(Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(next))));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!desktop) {
    return (
      <section className="terminal-panel" hidden={!visible} aria-label="Terminal">
        <p className="hint">La terminal integrada requiere Ruth IDE de escritorio. Nada que ejecutar aquí.</p>
      </section>
    );
  }

  const active = activeTab();
  const fractions =
    widths !== null && widths.length === tabs.length ? widths : equalPaneWidths(tabs.length);
  return (
    <section
      className="terminal-panel"
      hidden={!visible}
      aria-label="Terminal"
      style={{ height: `${height}px` }}
    >
      <div
        className="terminal-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Altura del panel de terminal"
        onPointerDown={onDragHandlePointerDown}
      />
      <div className="terminal-head">
        {layout === "tabs" ? (
          <div className="terminal-tabs" role="tablist" aria-label="Sesiones">
            {tabs.length === 0 && <span className="hint">Sin sesiones: crea la primera.</span>}
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
              ? "Sin sesiones: crea la primera."
              : `${tabs.length} ${tabs.length === 1 ? "sesión" : "sesiones"} en paralelo.`}
          </span>
        )}
        <div className="terminal-actions" role="toolbar" aria-label="Acciones de terminal">
          <button
            type="button"
            className="term-tool"
            onClick={() => void handleCreate()}
            disabled={creating || !canCreateTerminal(tabs)}
            aria-label={creating ? "Abriendo sesión" : "Nueva terminal"}
            title={
              creating
                ? "Abriendo…"
                : canCreateTerminal(tabs)
                  ? "Nueva terminal"
                  : "Límite de tres sesiones: cierra una antes"
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
            aria-label={layout === "tabs" ? "Ver en paralelo" : "Ver en pestañas"}
            title={layout === "tabs" ? "Ver en paralelo" : "Ver en pestañas"}
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
            aria-label="Carpeta para nuevas sesiones"
            title="Carpeta para nuevas sesiones"
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
            onClick={onHide}
            aria-label="Ocultar panel de terminal"
            title="Ocultar panel (las sesiones siguen en marcha)"
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
        Carpeta de sesiones nuevas: {folder ?? "tu carpeta personal (por defecto)"}. Las abiertas
        conservan la suya. La terminal tiene tus permisos: no es un sandbox.
      </p>
      {/*
        Una sola estructura para ambas disposiciones: las vistas xterm
        nunca se desmontan al alternar (claves estables), así no se
        pierde salida ni se reinicia nada. En pestañas, por
        construcción: las cabeceras de panel no se renderizan (solo la
        tira), los envoltorios inactivos llevan `display:none` en línea
        y el activo `flex:1`; imposible mostrar dos niveles ni paneles
        paralelos estrechos por un fallo de hoja de estilos.
      */}
      <div
        className="terminal-panes"
        ref={panesRef}
        role="group"
        aria-label={layout === "tabs" ? "Sesión activa" : "Sesiones en paralelo"}
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
                  aria-label={`Ancho entre ${tabs[index - 1].info.id} y ${tab.info.id}`}
                  onPointerDown={(event) => onPaneSepPointerDown(event, index - 1)}
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
          {!active.info.running && " — cierra la pestaña cuando quieras; su texto queda arriba."}
        </p>
      )}
      {error !== null && (
        <p className="error terminal-error" role="alert">
          {error}{" "}
          <button type="button" className="secondary small" onClick={() => setError(null)}>
            Cerrar aviso
          </button>
        </p>
      )}
      {closeConfirmId !== null && (
        <div className="modal-backdrop" onClick={() => setCloseConfirmId(null)}>
          <div
            className="modal"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Cerrar ${closeConfirmId}`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>Cerrar {closeConfirmId}</h3>
            <p>Su proceso terminará. ¿Seguro?</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setCloseConfirmId(null)} autoFocus>
                Cancelar
              </button>
              <button type="button" className="danger" onClick={() => void doClose(closeConfirmId)}>
                Cerrar sesión
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
            aria-label="Cerrar con terminales abiertas"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>
              Hay {quitRequest} {quitRequest === 1 ? "terminal en marcha" : "terminales en marcha"}
            </h3>
            <p>Cerrar Ruth IDE terminará sus procesos. Los procesos no se restauran al reabrir.</p>
            <div className="button-row">
              <button type="button" className="secondary" onClick={() => setQuitRequest(null)} autoFocus>
                Seguir trabajando
              </button>
              <button type="button" className="danger" onClick={() => void handleQuit()} disabled={quitting}>
                {quitting ? "Cerrando…" : "Cerrar Ruth IDE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Cabecera de una sesión (pestaña o panel): nombre y estado más iconos
 * Limpiar y Cerrar propios. Son botones hermanos, nunca anidados: pulsar
 * limpiar/cerrar no selecciona ni activa otra sesión por accidente.
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
        aria-label={`Limpiar vista de ${tab.info.id}`}
        title={`Limpiar vista de ${tab.info.id} (el proceso sigue en marcha)`}
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
        aria-label={`Cerrar ${tab.info.id}`}
        title={`Cerrar ${tab.info.id} (termina su proceso)`}
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
      Ejecuta shells, agentes como <code>$HOME/.local/bin/muse</code>, servidores o Git. Nada se
      ejecuta al abrir el panel: todo nace de lo que escribas.
    </p>
  );
}
