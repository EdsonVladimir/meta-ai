// Tauri adapter for the connection test. Every real call to Meta starts
// here, only when the person presses "Test connection". `getMetaStatus`
// is a local read of the native process environment, no network.
import { invoke } from "@tauri-apps/api/core";
import { isTauriEnvironment } from "../../lib/env";
import {
  asErrorKind,
  type ConnectionTestOk,
  type ConnectionTestOutcome,
  type MetaStatus,
  type MetaTestError,
} from "./types";

export { isTauriEnvironment };

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
          "The native test requires running Ruth IDE as a desktop application (Tauri).",
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
    message: "Unexpected error invoking the native test.",
    retryable: false,
  };
}
