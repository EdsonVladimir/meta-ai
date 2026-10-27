// Detección del entorno Tauri, compartida por las funcionalidades.

export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return "__TAURI_INTERNALS__" in w || "__TAURI__" in w;
}
