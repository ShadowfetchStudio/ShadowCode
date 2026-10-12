import { useCallback, useRef, useState } from "react";
import { readableError } from "../lib/transport";

export type ToastKind = "ok" | "err" | "info";
/** A button on the notification (Undo after a rewind). */
export type ToastAction = { label: string; run: () => void };
export type Toast = {
  id: number;
  text: string;
  kind: ToastKind;
  action?: ToastAction;
};

/** Time a held notification still gets once the pointer or focus leaves it,
 * so it does not vanish the moment the reader looks away. */
export const TOAST_RESUME_MS = 2000;

/** A notification's countdown: running (`timer` set) or held with `left`
 * milliseconds to go. */
type Countdown = {
  timer?: ReturnType<typeof setTimeout>;
  due: number;
  left: number;
};

/** Up to four notifications; errors stay 8 s, ones with an action 12 s, the
 * rest 5 s. `hold` pauses one while it is pointed at or has focus, and it
 * resumes with the time it had left (at least TOAST_RESUME_MS). Callers
 * often pass `String(error)`; the text is shown without a JavaScript class
 * prefix ("Error: …"). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const countdowns = useRef(new Map<number, Countdown>());
  const dismiss = useCallback((id: number) => {
    clearTimeout(countdowns.current.get(id)?.timer);
    countdowns.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const run = useCallback(
    (id: number, ms: number) =>
      countdowns.current.set(id, {
        timer: setTimeout(() => dismiss(id), ms),
        due: Date.now() + ms,
        left: ms,
      }),
    [dismiss],
  );
  const toast = useCallback(
    (text: string, kind: ToastKind = "info", action?: ToastAction) => {
      const id = ++seq.current;
      const shown = readableError(text) || text;
      setToasts((prev) => [
        ...prev.slice(-3),
        { id, text: shown, kind, action },
      ]);
      run(id, action ? 12000 : kind === "err" ? 8000 : 5000);
    },
    [run],
  );
  const hold = useCallback(
    (id: number, held: boolean) => {
      const countdown = countdowns.current.get(id);
      if (!countdown) return;
      if (held && countdown.timer !== undefined) {
        clearTimeout(countdown.timer);
        countdown.timer = undefined;
        countdown.left = Math.max(0, countdown.due - Date.now());
      } else if (!held && countdown.timer === undefined)
        run(id, Math.max(countdown.left, TOAST_RESUME_MS));
    },
    [run],
  );
  return { toasts, toast, dismiss, hold };
}
