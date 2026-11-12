import { useCallback, useEffect, useRef, useState } from "react";

/** Readiness may arrive after navigation or another focus choice. Only an
 * explicit, still-owned request can move keyboard input into a shell. */
export function useTerminalFocus() {
  const pending = useRef<string | null>(null);
  const [revision, setRevision] = useState(0);
  const cancel = useCallback(() => {
    pending.current = null;
  }, []);
  const request = useCallback((owner: string, immediate = true) => {
    pending.current = owner;
    if (immediate) setRevision((value) => value + 1);
  }, []);
  const ready = useCallback((owner: string, element: HTMLElement) => {
    if (pending.current !== owner || !element.isConnected) return;
    pending.current = null;
    element.focus();
  }, []);
  useEffect(() => {
    const newerChoice = (event: Event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".terminal-panel, .terminal-dock")
      )
        cancel();
    };
    document.addEventListener("focusin", newerChoice, true);
    document.addEventListener("pointerdown", newerChoice, true);
    return () => {
      document.removeEventListener("focusin", newerChoice, true);
      document.removeEventListener("pointerdown", newerChoice, true);
    };
  }, [cancel]);
  return { request, ready, cancel, revision };
}
