import { useEffect, useRef } from "react";
import { Check, ListChecks, LoaderCircle, X } from "lucide-react";
import type { PlanStep } from "../../api";
import type { Toast } from "../../hooks/useToasts";
import { planStepLabel } from "../../lib/statusLabels";

/** Small pieces of the window frame: the startup screen, the task plan above
 * the composer and the notification stack. */

export function BootScreen({
  timedOut,
  error,
  onRetry,
}: {
  timedOut: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <div className="boot">
      <img src="/icon-192.png" alt="" />
      <span>Opening your workspace…</span>
      <LoaderCircle className="spin" size={18} aria-hidden="true" />
      {timedOut && (
        <div className="boot-timeout">
          <p>Taking longer than expected. The engine may still be starting.</p>
          {error && <p className="health-bad">{error}</p>}
          <button type="button" onClick={onRetry}>
            Retry connection
          </button>
        </div>
      )}
    </div>
  );
}

export function TaskPlan({ plan }: { plan: PlanStep[] }) {
  if (!plan.length) return null;
  const completed = plan.filter((p) => p.status === "done").length;
  return (
    <details className="task-plan">
      <summary>
        <ListChecks size={15} aria-hidden="true" />
        <span>Task plan</span>
        <span className="dim">
          {completed} of {plan.length}
        </span>
        <div className="plan-track">
          <span style={{ width: `${(completed / plan.length) * 100}%` }} />
        </div>
      </summary>
      <ol>
        {plan.map((p) => (
          <li key={p.id} className={`plan-${p.status}`}>
            {p.status === "done" ? (
              <Check size={14} aria-hidden="true" />
            ) : (
              <span className="plan-circle" />
            )}
            <span>{p.title}</span>
            <small>{planStepLabel(p.status)}</small>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function Toasts({
  toasts,
  onDismiss,
  onHold,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  /** Pause (true) or resume (false) a notification's countdown. */
  onHold?: (id: number, held: boolean) => void;
}) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onHold={onHold} />
      ))}
    </div>
  );
}

/** One notification. It stays while the pointer is over it or focus is
 * inside it (reading it, or reaching Undo by keyboard), and counts down
 * again once both have left. */
function ToastItem({
  toast: t,
  onDismiss,
  onHold,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
  onHold?: (id: number, held: boolean) => void;
}) {
  const pointer = useRef(false);
  const focus = useRef(false);
  const hold = useRef(onHold);
  hold.current = onHold;
  const sync = () => hold.current?.(t.id, pointer.current || focus.current);
  // Pushed out by newer notifications while held: nothing reports leaving
  // it, so let its countdown finish.
  useEffect(() => () => hold.current?.(t.id, false), [t.id]);
  return (
    <div
      className={`toast ${t.kind}`}
      role={t.kind === "err" ? "alert" : "status"}
      aria-live={t.kind === "err" ? "assertive" : "polite"}
      onPointerEnter={() => {
        pointer.current = true;
        sync();
      }}
      onPointerLeave={() => {
        pointer.current = false;
        sync();
      }}
      onFocus={() => {
        focus.current = true;
        sync();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focus.current = false;
        sync();
      }}
    >
      <span>{t.text}</span>
      {t.action && (
        <button
          type="button"
          className="mini toast-action"
          onClick={() => {
            onDismiss(t.id);
            t.action?.run();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(t.id)}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
