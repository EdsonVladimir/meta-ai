// Esc cancels a dialog, wherever focus is. Off while it must not close,
// such as during a write.
import { useEffect, useRef } from "react";

export function useEscape(onEscape: () => void, enabled = true): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handler.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
