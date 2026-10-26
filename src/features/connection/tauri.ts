// Adaptador Tauri para la prueba de conexión. Toda llamada real a Meta nace
// aquí, solo cuando la persona pulsa "Probar conexión". `getMetaStatus` es
// una lectura local del entorno del proceso nativo, sin red.
import { invoke } from "@tauri-apps/api/core";
import {
  asErrorKind,
  type ConnectionTestOk,
  type ConnectionTestOutcome,
  type MetaStatus,
  type MetaTestError,
} from "./types";

export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || "__TAURI__" in w;
}

export async function getMetaStatus(): Promise<MetaStatus> {
  return invoke<MetaStatus>("meta_status");
}

export async function testMetaConnection(): Promise<ConnectionTestOutcome> {
  if (!isTauriEnvironment()) {
    return {
      ok: false,
      error: {
        kind: "not_tauri",
        message:
          "La prueba nativa requiere ejecutar Ruth IDE como aplicación de escritorio (Tauri).",
        retryable: false,
      },
    };
  }
  try {
    const value = await invoke<ConnectionTestOk>("test_meta_connection");
    return { ok: true, value };
  } catch (raw) {
    return { ok: false, error: normalizeInvokeError(raw) };
  }
}

function normalizeInvokeError(raw: unknown): MetaTestError {
  if (raw !== null && typeof raw === "object") {
    const candidate = raw as Partial<MetaTestError>;
    if (typeof candidate.message === "string") {
      const retryAfter =
        typeof candidate.retryAfterSecs === "number" &&
        Number.isFinite(candidate.retryAfterSecs)
          ? candidate.retryAfterSecs
          : null;
      return {
        kind: asErrorKind(candidate.kind),
        message: candidate.message,
        retryable: candidate.retryable === true,
        retryAfterSecs: retryAfter,
      };
    }
  }
  return {
    kind: "unexpected",
    message: "Error inesperado al invocar la prueba nativa.",
    retryable: false,
  };
}
