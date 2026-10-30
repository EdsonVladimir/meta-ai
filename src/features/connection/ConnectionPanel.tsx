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

  // Local read of the native environment only (key present? which model?).
  // No network traffic; never calls Meta.
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
        setStatusError("Could not read the native environment status.");
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
        <h2 id="connection-title">Meta connection</h2>
        <p className="status" role="status" aria-live="polite">
          <span className={`dot dot-${state}`} aria-hidden="true" />
          {stateLabel(state)}
        </p>
      </div>

      {!isNative && (
        <p className="notice">
          You are in a browser. The connection test is native and requires
          running Ruth IDE as a desktop application (Tauri). The test is
          never simulated and no key is exposed on the web.
        </p>
      )}

      {isNative && status && (
        <dl className="facts">
          <div>
            <dt>Key configured</dt>
            <dd>{status.configured ? "Yes" : "No (META_API_KEY)"}</dd>
          </div>
          <div>
            <dt>Model</dt>
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
        {state === "checking" ? "Checking…" : "Test connection"}
      </button>
      <p className="hint">
        The test sends a minimal request to Meta Model API and shows the
        text, the model and the token usage. Nothing runs at startup: only
        when the button is pressed.
      </p>

      {outcome && (
        <div className="result">
          {outcome.ok ? (
            <>
              <h3>Test passed</h3>
              <dl className="facts">
                <div>
                  <dt>Response</dt>
                  <dd>
                    <code>{outcome.value.text}</code>
                  </dd>
                </div>
                <div>
                  <dt>Model</dt>
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
                  The API returned the response unfinished (the test&apos;s
                  minimal output limit). The connection works.
                </p>
              )}
            </>
          ) : (
            <>
              <h3>Test failed: {kindLabel(outcome.error.kind)}</h3>
              <p>{outcome.error.message}</p>
              {outcome.error.kind === "rate_limit" &&
                outcome.error.retryAfterSecs != null && (
                  <p className="notice">
                    The API asks to wait {outcome.error.retryAfterSecs} seconds
                    before retrying.
                  </p>
                )}
              {outcome.error.retryable &&
                outcome.error.kind !== "rate_limit" && (
                  <p className="notice">
                    This is a transient error: you can retry with the button.
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
  if (!usage) return "Not provided by the API";
  return `input ${usage.inputTokens} · output ${usage.outputTokens} · total ${usage.totalTokens}`;
}
