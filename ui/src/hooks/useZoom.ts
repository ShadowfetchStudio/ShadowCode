import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readStore, writeStore } from "../lib/storage";
import { transportKind } from "../lib/transport";
import { DEFAULT_ZOOM, ZOOM_VAR, normalizeZoom } from "../lib/zoom";

/** The saved text size (`ui.zoom`), kept in browser storage too so a reload
 * opens at that size before the config has loaded. */
export const ZOOM_KEY = "shadow:zoom";

let applied: number | null = null;
let css = DEFAULT_ZOOM;
/** The desktop refused to zoom its webview (a shell without the
 * permission): CSS zoom from then on. */
let webviewRefused = false;
const cssListeners = new Set<(zoom: number) => void>();

/** The size in use. */
export const currentZoom = () => applied ?? DEFAULT_ZOOM;

/** The part of the size done with CSS `zoom`: 1 when the webview zooms. */
export const cssZoom = () => css;

/** Called when the CSS part changes, for views that measure in window
 * pixels (the terminal). Returns the unsubscribe function. */
export function onCssZoom(listener: (zoom: number) => void) {
  cssListeners.add(listener);
  return () => void cssListeners.delete(listener);
}

function setCssZoom(zoom: number) {
  const root = document.documentElement.style;
  if (zoom === DEFAULT_ZOOM) {
    root.removeProperty("zoom");
    root.removeProperty(ZOOM_VAR);
  } else {
    root.setProperty("zoom", String(zoom));
    root.setProperty(ZOOM_VAR, String(zoom));
  }
  if (zoom === css) return;
  css = zoom;
  cssListeners.forEach((listener) => listener(zoom));
}

/** Zooms the whole interface. The desktop zooms its webview, as a browser's
 * own zoom does, so layout, media queries and the terminal's and editor's
 * pointer maths stay in step. A plain browser (remote access, the test
 * suite) cannot set its own zoom, so the root element gets CSS `zoom`:
 * stylesheets divide viewport units by it (vite.config.ts), and the
 * terminal opts out and scales its font instead (TerminalView). */
export function applyZoom(zoom: number) {
  if (zoom === applied) return;
  applied = zoom;
  if (transportKind() !== "tauri" || webviewRefused) {
    setCssZoom(zoom);
    return;
  }
  setCssZoom(DEFAULT_ZOOM);
  Promise.resolve()
    .then(() => getCurrentWebview().setZoom(zoom))
    .catch(() => {
      webviewRefused = true;
      setCssZoom(currentZoom());
    });
}

/** Before the first render: the last saved size, else 100%. */
export function applyInitialZoom() {
  applyZoom(normalizeZoom(readStore(ZOOM_KEY)));
}

/** Applies `zoom` whenever it changes and remembers `saved` for the next
 * start (a preview passes the saved size, so an unsaved choice is never
 * remembered). `undefined` means the config has not loaded yet, so the size
 * chosen at startup stays. */
export function useZoom(zoom: number | undefined, saved = zoom) {
  useEffect(() => {
    if (saved !== undefined) writeStore(ZOOM_KEY, String(saved));
  }, [saved]);
  useEffect(() => {
    if (zoom !== undefined) applyZoom(zoom);
  }, [zoom]);
}
