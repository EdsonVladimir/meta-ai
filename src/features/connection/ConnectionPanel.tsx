import { useEffect, useRef, useState } from "react";
import {
  getMetaStatus,
  isTauriEnvironment,
  testMetaConnection,
} from "./tauri";
import {
  kindLabel,
  stateLabel,
  type ConnectionState,
  type ConnectionTestOutcome,
  type MetaStatus,
} from "./types";

export function ConnectionPanel() {
  const [isNative] = useState<boolean>(() => isTauriEnvironment());
  const [state, setState] = useState<ConnectionState>("unknown");
  const [status, setStatus] = useState<MetaStatus | null>(null);
  const [outcome, setOutcome] = useState<ConnectionTestOutcome | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const checkingRef = useRef(false);

  // Solo lectura local del entorno nativo (¿hay clave? ¿qué modelo?).
  // No genera tráfico de red ni llama a Meta.
  useEffect(() => {
    if (!isNative) return;
    let cancelled = false;
    getMetaStatus()
      .then((value) => {
        if (cancelled) return;
        setStatus(value);
        setState(value.configured ? "unknown" : "unconfigured");
      })
      .catch(() => {
        if (cancelled) return;
        setStatusError("No se pudo leer el estado del entorno nativo.");
      });
    return () => {
      cancelled = true;
    };
  }, [isNative]);

  async function handleTest() {
    if (!isNative || checkingRef.current) return;
    checkingRef.current = true;
    setState("checking");
    setOutcome(null);
    try {
      const result = await testMetaConnection();
      setOutcome(result);
      if (result.ok) {
        setState("available");
      } else if (result.error.kind === "missing_key") {
        setState("unconfigured");
      } else {
        setState("error");
      }
    } finally {
      checkingRef.current = false;
    }
  }

  return (
    <section className="panel" aria-labelledby="connection-title">
      <div className="panel-head">
        <h2 id="connection-title">Conexión con Meta</h2>
        <p className="status" role="status" aria-live="polite">
          <span className={`dot dot-${state}`} aria-hidden="true" />
          {stateLabel(state)}
        </p>
      </div>

      {!isNative && (
        <p className="notice">
          Estás en un navegador. La prueba de conexión es nativa y requiere
          ejecutar Ruth IDE como aplicación de escritorio (Tauri). No se
          simula la prueba ni se expone ninguna clave en la web.
        </p>
      )}

      {isNative && status && (
        <dl className="facts">
          <div>
            <dt>Clave configurada</dt>
            <dd>{status.configured ? "Sí" : "No (META_API_KEY)"}</dd>
          </div>
          <div>
            <dt>Modelo</dt>
            <dd>
              <code>{status.model}</code>
            </dd>
          </div>
        </dl>
      )}
      {statusError && <p className="notice">{statusError}</p>}

      <button
        type="button"
        className="primary"
        onClick={handleTest}
        disabled={!isNative || state === "checking"}
      >
        {state === "checking" ? "Comprobando…" : "Probar conexión"}
      </button>
      <p className="hint">
        La prueba envía una petición mínima a Meta Model API y muestra el
        texto, el modelo y el uso de tokens. Nada se ejecuta al arrancar: solo
        al pulsar el botón.
      </p>

      {outcome && (
        <div className="result">
          {outcome.ok ? (
            <>
              <h3>Prueba correcta</h3>
              <dl className="facts">
                <div>
                  <dt>Respuesta</dt>
                  <dd>
                    <code>{outcome.value.text}</code>
                  </dd>
                </div>
                <div>
                  <dt>Modelo</dt>
                  <dd>
                    <code>{outcome.value.model}</code>
                  </dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd>{formatUsage(outcome.value.usage)}</dd>
                </div>
              </dl>
              {outcome.value.truncated && (
                <p className="notice">
                  La API devolvió la respuesta sin completar (límite de salida
                  mínimo de la prueba). La conexión funciona.
                </p>
              )}
            </>
          ) : (
            <>
              <h3>Prueba fallida: {kindLabel(outcome.error.kind)}</h3>
              <p>{outcome.error.message}</p>
              {outcome.error.kind === "rate_limit" &&
                outcome.error.retryAfterSecs != null && (
                  <p className="notice">
                    La API pide esperar {outcome.error.retryAfterSecs} segundos
                    antes de reintentar.
                  </p>
                )}
              {outcome.error.retryable &&
                outcome.error.kind !== "rate_limit" && (
                  <p className="notice">
                    Es un error transitorio: puedes reintentar con el botón.
                  </p>
                )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatUsage(
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null,
): string {
  if (!usage) return "No proporcionado por la API";
  return `entrada ${usage.inputTokens} · salida ${usage.outputTokens} · total ${usage.totalTokens}`;
}
