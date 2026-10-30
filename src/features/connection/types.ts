// Meta connection-test domain.
// Pure: no React, no Tauri, no providers. The Tauri adapter lives in tauri.ts.

export type ConnectionState =
  | "unknown"
  | "unconfigured"
  | "checking"
  | "available"
  | "error";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Must match MetaErrorKind from the Rust `ruth-meta` crate (snake_case).
// `not_tauri` only exists in the frontend: the browser cannot invoke native commands.
export type MetaErrorKind =
  | "missing_key"
  | "busy"
  | "auth"
  | "billing"
  | "forbidden"
  | "rate_limit"
  | "model_not_found"
  | "bad_request"
  | "server"
  | "network"
  | "timeout"
  | "incomplete"
  | "refusal"
  | "invalid_response"
  | "unexpected"
  | "not_tauri";

export interface MetaTestError {
  kind: MetaErrorKind;
  message: string;
  retryable: boolean;
  retryAfterSecs?: number | null;
}

export interface ConnectionTestOk {
  text: string;
  model: string;
  /** The API returned a non-`completed` status (e.g. truncated by limit). */
  truncated: boolean;
  usage: TokenUsage | null;
}

export type ConnectionTestOutcome =
  | { ok: true; value: ConnectionTestOk }
  | { ok: false; error: MetaTestError };

/** Local read of the native process environment. Makes no network calls. */
export interface MetaStatus {
  configured: boolean;
  model: string;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set([
  "missing_key",
  "busy",
  "auth",
  "billing",
  "forbidden",
  "rate_limit",
  "model_not_found",
  "bad_request",
  "server",
  "network",
  "timeout",
  "incomplete",
  "refusal",
  "invalid_response",
  "unexpected",
  "not_tauri",
]);

export function asErrorKind(raw: unknown): MetaErrorKind {
  return typeof raw === "string" && KNOWN_KINDS.has(raw)
    ? (raw as MetaErrorKind)
    : "unexpected";
}

export function stateLabel(state: ConnectionState): string {
  switch (state) {
    case "unknown":
      return "Not checked";
    case "unconfigured":
      return "Not configured";
    case "checking":
      return "Checking";
    case "available":
      return "Available";
    case "error":
      return "Error";
  }
}

export function kindLabel(kind: MetaErrorKind): string {
  switch (kind) {
    case "missing_key":
      return "Missing META_API_KEY";
    case "busy":
      return "Test in progress";
    case "auth":
      return "Authentication";
    case "billing":
      return "Billing";
    case "forbidden":
      return "Forbidden";
    case "rate_limit":
      return "Rate limited";
    case "model_not_found":
      return "Model not found";
    case "bad_request":
      return "Bad request";
    case "server":
      return "Server error";
    case "network":
      return "Network";
    case "timeout":
      return "Timed out";
    case "incomplete":
      return "Incomplete response";
    case "refusal":
      return "Model refusal";
    case "invalid_response":
      return "Invalid response";
    case "unexpected":
      return "Unexpected";
    case "not_tauri":
      return "Requires Tauri";
  }
}
