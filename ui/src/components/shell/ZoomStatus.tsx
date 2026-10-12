import { useEffect, useState } from "react";
import type { ZoomNotice } from "../../hooks/useAppearance";
import { zoomStatusText } from "../../lib/zoom";
import "../../appearance.css";

/** How long the size stays on screen after a zoom key. */
const SHOWN_MS = 1500;

/** The text size for a moment after Ctrl+=, Ctrl+- or Ctrl+0, like a
 * browser's zoom bubble: one line that each press replaces, rather than a
 * stack of notifications. The live region stays mounted so screen readers
 * hear every change. */
export function ZoomStatus({ notice }: { notice: ZoomNotice | null }) {
  const [shown, setShown] = useState<ZoomNotice | null>(null);
  useEffect(() => {
    if (!notice) return;
    setShown(notice);
    const timer = setTimeout(() => setShown(null), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div
      className="zoom-status"
      role="status"
      data-shown={shown ? "" : undefined}
    >
      {shown ? zoomStatusText(shown.zoom) : ""}
    </div>
  );
}
