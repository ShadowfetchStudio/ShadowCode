import { useWallClock } from "../hooks/useWallClock";
import { messageTime } from "../lib/messageTime";

/** A message's time, small and muted at its edge, with the full date and
 * time as a tooltip. `quiet` times show only while the message is hovered
 * or focused. Nothing is shown without a recorded time. It re-renders at
 * midnight on its own, so "14:32" becomes "Yesterday 14:32" in a window
 * left open. `now` and `locale` are for tests. */
export function MessageTime({
  ts,
  quiet = false,
  now,
  locale,
}: {
  ts?: number;
  quiet?: boolean;
  now?: number;
  locale?: string;
}) {
  const current = useWallClock(now);
  const time = ts ? messageTime(ts, current, locale) : null;
  if (!time) return null;
  return (
    <time
      className={`message-time${quiet ? " is-quiet" : ""}`}
      dateTime={time.iso}
      title={time.full}
    >
      {time.label}
    </time>
  );
}
