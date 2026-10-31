// Closing with drafts, by any route. Rust stops every close while the
// frontend reports drafts and asks here; see `commands/window.rs`.
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauriEnvironment } from "../lib/env";

export const DRAFTS_CLOSE_EVENT = "ruth-drafts-close-requested";

/** The next close passes the drafts check: the person already chose. */
export async function allowCloseOnce(): Promise<void> {
  if (isTauriEnvironment()) await invoke("app_allow_close_once");
}

export function useCloseGuard(hasDrafts: boolean, onCloseRequested: () => void): void {
  const handler = useRef(onCloseRequested);
  handler.current = onCloseRequested;

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    void invoke("app_set_unsaved_drafts", { unsaved: hasDrafts }).catch(() => {});
  }, [hasDrafts]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let active = true;
    let stop: (() => void) | null = null;
    void listen(DRAFTS_CLOSE_EVENT, () => handler.current()).then((unlisten) => {
      if (active) stop = unlisten;
      else unlisten();
    });
    return () => {
      active = false;
      stop?.();
    };
  }, []);
}
