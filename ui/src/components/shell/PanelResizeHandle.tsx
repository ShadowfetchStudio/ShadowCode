import { useEffect, useRef, useState } from "react";
import { readStore, writeStore } from "../../lib/storage";

const MIN = 320;
const DEFAULT = 440;
const KEY = "shadow:panel-width";

/** A keyboard and pointer operable split-view boundary. The preference is
 * remembered, but the effective width always leaves room for the conversation.
 * This owns only --panel-width on its containing app, including cleanup. */
export function PanelResizeHandle() {
  const ref = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState(() => {
    const saved = Number(readStore(KEY));
    return Number.isFinite(saved) && saved >= MIN
      ? Math.min(saved, 900)
      : DEFAULT;
  });
  const [maximum, setMaximum] = useState(900);
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  const width = Math.min(preferred, maximum);

  useEffect(() => {
    const app = ref.current?.closest<HTMLElement>(".app");
    if (!app) return;
    const measure = () => {
      const sidebar = app.querySelector<HTMLElement>(".sidebar");
      const rail =
        sidebar && getComputedStyle(sidebar).position !== "fixed"
          ? sidebar.offsetWidth
          : 0;
      setMaximum(Math.max(MIN, Math.min(900, app.clientWidth - rail - 380)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(app);
    const sidebar = app.querySelector(".sidebar");
    if (sidebar) observer.observe(sidebar);
    // Class changes include hiding the navigation and opening Preview.
    const changes = new MutationObserver(measure);
    changes.observe(app, { attributes: true, attributeFilter: ["class"] });
    measure();
    return () => {
      observer.disconnect();
      changes.disconnect();
    };
  }, []);

  useEffect(() => {
    const app = ref.current?.closest<HTMLElement>(".app");
    app?.style.setProperty("--panel-width", `${width}px`);
    return () => {
      app?.style.removeProperty("--panel-width");
    };
  }, [width]);

  const change = (next: number) => {
    const value = Math.round(Math.max(MIN, Math.min(maximum, next)));
    setPreferred(value);
    writeStore(KEY, String(value));
  };

  return (
    <div
      ref={ref}
      className="panel-resizer"
      role="separator"
      tabIndex={0}
      aria-label="Resize workspace panel"
      aria-orientation="vertical"
      aria-controls="drawer-panel"
      aria-valuemin={MIN}
      aria-valuemax={maximum}
      aria-valuenow={width}
      aria-valuetext={`${width} pixels`}
      title="Drag to resize. Arrow keys adjust width; Enter or double-click resets."
      onDoubleClick={() => change(DEFAULT)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          change(DEFAULT);
          return;
        }
        const step = event.shiftKey ? 64 : 16;
        const next =
          event.key === "ArrowLeft"
            ? width + step
            : event.key === "ArrowRight"
              ? width - step
              : event.key === "Home"
                ? MIN
                : event.key === "End"
                  ? maximum
                  : null;
        if (next === null) return;
        event.preventDefault();
        event.stopPropagation();
        change(next);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const app = event.currentTarget.closest<HTMLElement>(".app");
        const scale = app
          ? app.getBoundingClientRect().width / app.clientWidth
          : 1;
        drag.current = { x: event.clientX, width, scale: scale || 1 };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (drag.current)
          change(
            drag.current.width +
              (drag.current.x - event.clientX) / drag.current.scale,
          );
      }}
      onPointerUp={(event) => {
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
    />
  );
}
