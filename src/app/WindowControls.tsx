// Controles de ventana propios (la ventana no tiene decoración nativa):
// minimizar, maximizar/restaurar y cerrar. Solo escritorio: en navegador
// no se muestra nada. Cerrar no sale directo: avisa a App para que pase
// por la puerta de borradores y luego por el flujo existente (que frena
// ante terminales activas). Nunca usa salida forzada.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriEnvironment } from "../lib/env";

interface WindowControlsProps {
  onCloseRequest: () => void;
  onToggleMaximize: () => Promise<void>;
}

export function WindowControls({ onCloseRequest, onToggleMaximize }: WindowControlsProps) {
  const [maximized, setMaximized] = useState(false);
  const desktop = isTauriEnvironment();

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    const refresh = () => {
      void getCurrentWindow()
        .isMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch(() => {});
    };
    refresh();
    // El sistema también maximiza (arrastrar arriba, Win+Arriba…): el
    // icono sigue al estado real, no solo a este botón.
    let unlisten: (() => void) | null = null;
    void getCurrentWindow()
      .onResized(refresh)
      .then((off) => {
        unlisten = off;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div className="window-controls" role="toolbar" aria-label="Controles de ventana">
      <button
        type="button"
        className="win-button"
        onClick={() => void getCurrentWindow().minimize().catch(() => {})}
        aria-label="Minimizar"
        title="Minimizar"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="win-button"
        onClick={() =>
          void onToggleMaximize().then(() =>
            getCurrentWindow()
              .isMaximized()
              .then(setMaximized)
              .catch(() => {}),
          )
        }
        aria-label={maximized ? "Restaurar" : "Maximizar"}
        title={maximized ? "Restaurar" : "Maximizar"}
      >
        {maximized ? (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path
              d="M6 3h7v7M10 13H3V6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="win-button win-close"
        onClick={onCloseRequest}
        aria-label="Cerrar"
        title="Cerrar"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
