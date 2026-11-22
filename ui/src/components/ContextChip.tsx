import { useEffect, useRef, useState } from "react";
import { Gauge, Minimize2 } from "lucide-react";
import { breakdownRows, contextChip, type ChipInput } from "../lib/usageChip";
import type { Transcript } from "../lib/transcript";

/** "42% · 38k / 128k · $0.12": context use and cost for the open
 * conversation. Clicking opens the interactive context budget HUD. */
export function ContextChip({
  input,
  compaction,
  onCompact,
  busy = false,
}: {
  input: ChipInput;
  compaction?: Transcript["compaction"];
  onCompact?: () => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("mousedown", close);
    };
  }, [open]);
  const chip = contextChip(input);
  if (!chip) return null;
  return (
    <span className="ctx-chip-wrap" ref={box}>
      <button
        type="button"
        className={`ctx-chip ctx-${chip.level}`}
        aria-label={`Context and cost: ${chip.label}`}
        aria-expanded={open}
        title="Context and cost for this conversation"
        onClick={() => setOpen((v) => !v)}
      >
        <Gauge size={12} aria-hidden="true" />
        {chip.percent !== null && (
          <span className="ctx-mini" aria-hidden="true">
            <span
              className="ctx-mini-fill"
              style={{ width: `${chip.percent}%` }}
            />
          </span>
        )}
        <span>{chip.text}</span>
        {chip.reportedBy && (
          <span className="ctx-source">· {chip.reportedBy}</span>
        )}
      </button>
      {open && (
        <div
          className="ctx-breakdown ctx-hud"
          role="dialog"
          aria-label="Context and cost breakdown"
        >
          <div className="ctx-hud-head">
            <strong>Context budget</strong>
            {chip.percent !== null && (
              <span className={`ctx-hud-pct ctx-${chip.level}`}>
                {chip.percent}% used
              </span>
            )}
          </div>
          {chip.percent !== null && (
            <div
              className="ctx-hud-meter"
              role="progressbar"
              aria-label="Context window usage"
              aria-valuenow={chip.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                className={`ctx-hud-meter-fill ctx-${chip.level}`}
                style={{ width: `${Math.min(100, chip.percent)}%` }}
              />
            </div>
          )}
          <dl>
            {breakdownRows(input, compaction).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {onCompact && (
            <div className="ctx-hud-actions">
              <button
                type="button"
                className="mini"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onCompact();
                }}
              >
                <Minimize2 size={12} aria-hidden="true" />
                Compact context
              </button>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
