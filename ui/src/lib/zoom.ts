/** Text size: how much the whole interface is zoomed (`ui.zoom`, Ctrl+= /
 * Ctrl+- / Ctrl+0). Pure, so the steps can be tested and the build can share
 * the CSS property name (vite.config.ts). Applying it is hooks/useZoom.ts. */

/** The sizes offered, as a browser offers them around 100%. 175% still
 * leaves room for the composer in the smallest (520 px) window. */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75] as const;
export const DEFAULT_ZOOM = 1;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** A saved `ui.zoom` as one of the steps. The interface offers only these,
 * so a hand-edited 1.2 reads as the nearest (125%); anything that is not a
 * positive number is 100%. */
export function normalizeZoom(value: unknown): number {
  const zoom =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  if (!Number.isFinite(zoom) || zoom <= 0) return DEFAULT_ZOOM;
  return ZOOM_STEPS.reduce((best, step) =>
    Math.abs(step - zoom) < Math.abs(best - zoom) ? step : best,
  );
}

/** One step larger (1) or smaller (-1) than `current`, stopping at the ends.
 * A size between two steps moves to the neighbour in that direction. */
export function stepZoom(current: number, direction: 1 | -1): number {
  const eps = 1e-6;
  if (direction > 0)
    return ZOOM_STEPS.find((step) => step > current + eps) ?? MAX_ZOOM;
  return (
    [...ZOOM_STEPS].reverse().find((step) => step < current - eps) ?? MIN_ZOOM
  );
}

export const zoomPercent = (zoom: number) => `${Math.round(zoom * 100)}%`;

/** What the window says after a zoom key: the size, and when it is as large
 * or as small as it goes. */
export function zoomStatusText(zoom: number): string {
  const size = `Text size ${zoomPercent(zoom)}`;
  if (zoom >= MAX_ZOOM) return `${size} · largest`;
  if (zoom <= MIN_ZOOM) return `${size} · smallest`;
  return size;
}

/** Set on the root element while the interface is zoomed with CSS `zoom`
 * (a plain browser); unset when the desktop zooms its webview instead. */
export const ZOOM_VAR = "--zoom";

const VIEWPORT_LENGTH =
  /(?<![\w.#-])(-?(?:\d+(?:\.\d+)?|\.\d+)(?:[dsl]?v[hw]|vmin|vmax))\b/g;

/** A CSS value with every viewport length divided by the CSS zoom.
 * Browsers scale `100vh` inside a zoomed root by the zoom, so a dialog
 * capped at 86vh would grow past the window at 125%; divided, it stays a
 * share of the window, as it does under the desktop's webview zoom (where
 * the property is unset and the division is by 1). Run over every
 * stylesheet at build time; a value already divided is left alone. */
export function unzoomViewportUnits(value: string): string {
  if (value.includes(`var(${ZOOM_VAR}`)) return value;
  return value.replace(VIEWPORT_LENGTH, `calc($1 / var(${ZOOM_VAR}, 1))`);
}
