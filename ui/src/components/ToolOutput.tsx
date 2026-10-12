import { memo, useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { outputView, showAllLabel } from "../lib/toolOutput";

/** A tool's output: a preview, "Show all (N lines)" / "Show less" when it is
 * longer (bounded, see lib/toolOutput), and Copy for the whole of it. Copy
 * sits in the box's corner as on code blocks, shown on hover or focus so a
 * column of short outputs stays quiet. `name` says whose output it is
 * ("npm test") in the buttons' accessible names. Memoized: an open timeline
 * re-renders while a task runs. */
export const ToolOutput = memo(function ToolOutput({
  text,
  name,
  className,
}: {
  text: string;
  name: string;
  /** For the `<pre>` (each place styles its own box). */
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const view = useMemo(() => outputView(text, expanded), [text, expanded]);
  const [copied, copy] = useCopyFeedback();
  return (
    <div className={`tool-output${expanded ? " is-expanded" : ""}`}>
      {/* The box scrolls: focusable, so the keyboard can scroll it too. */}
      <pre className={className} tabIndex={0}>
        {view.text}
      </pre>
      <button
        type="button"
        className={`tool-output-copy${copied ? " is-copied" : ""}`}
        aria-label={
          copied ? `Copied the output of ${name}` : `Copy the output of ${name}`
        }
        onClick={() => void copy(text)}
      >
        {copied ? (
          <Check size={12} aria-hidden="true" />
        ) : (
          <Copy size={12} aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
      {view.long && (
        <div className="tool-output-bar">
          {view.hidden && <span className="hint">{view.hidden}</span>}
          <button type="button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : showAllLabel(view, text.length)}
            <span className="sr-only"> of the output of {name}</span>
          </button>
        </div>
      )}
    </div>
  );
});
