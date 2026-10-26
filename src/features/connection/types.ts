// Dominio de la prueba de conexión con Meta.
// Puro: sin React, sin Tauri, sin proveedores. El adaptador Tauri vive en tauri.ts.

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

// Debe coincidir con MetaErrorKind del crate Rust `ruth-meta` (snake_case).
// `not_tauri` solo existe en el frontend: el navegador no puede invocar comandos nativos.
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
  /** La API devolvió estado distinto de `completed` (p. ej. truncado por límite). */
  truncated: boolean;
  usage: TokenUsage | null;
}

export type ConnectionTestOutcome =
  | { ok: true; value: ConnectionTestOk }
  | { ok: false; error: MetaTestError };

/** Lectura local del entorno del proceso nativo. No hace llamadas de red. */
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
      return "Sin comprobar";
    case "unconfigured":
      return "Sin configurar";
    case "checking":
      return "Comprobando";
    case "available":
      return "Disponible";
    case "error":
      return "Error";
  }
}

export function kindLabel(kind: MetaErrorKind): string {
  switch (kind) {
    case "missing_key":
      return "Falta META_API_KEY";
    case "busy":
      return "Prueba en curso";
    case "auth":
      return "Autenticación";
    case "billing":
      return "Facturación";
    case "forbidden":
      return "Sin permiso";
    case "rate_limit":
      return "Límite de peticiones";
    case "model_not_found":
      return "Modelo no encontrado";
    case "bad_request":
      return "Petición inválida";
    case "server":
      return "Error del servidor";
    case "network":
      return "Red";
    case "timeout":
      return "Tiempo agotado";
    case "incomplete":
      return "Respuesta incompleta";
    case "refusal":
      return "Rechazo del modelo";
    case "invalid_response":
      return "Respuesta inválida";
    case "unexpected":
      return "Inesperado";
    case "not_tauri":
      return "Requiere Tauri";
  }
}
