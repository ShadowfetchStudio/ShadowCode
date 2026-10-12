import { useCallback, useEffect, useRef, useState } from "react";

/** How long a copy button says "Copied". */
export const COPIED_MS = 1800;

/** Copies text and says so on the button for a moment ("Copied"), the way
 * code blocks and tool output do. A copy that fails leaves the button as it
 * was. */
export function useCopyFeedback(): [
  copied: boolean,
  copy: (text: string) => Promise<void>,
] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
    }
  }, []);
  return [copied, copy];
}
