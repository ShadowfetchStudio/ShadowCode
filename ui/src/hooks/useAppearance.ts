import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { DEFAULT_ZOOM, normalizeZoom, stepZoom } from "../lib/zoom";
import { useStableCallback } from "./useStableCallback";
import { useTheme } from "./useTheme";
import type { ToastKind } from "./useToasts";
import { readStore } from "../lib/storage";
import { transportKind } from "../lib/transport";
import { ZOOM_KEY, applyZoom, currentZoom, useZoom } from "./useZoom";

/** Choices on Settings › Appearance that are shown but not saved yet. */
export type AppearancePreview = { theme: string; zoom: number };

/** What Settings › Appearance starts from, and how it previews a choice
 * (`null` goes back to the saved theme and size). */
export type AppearanceControls = {
  theme: string;
  zoom: number;
  preview: (next: AppearancePreview | null) => void;
  /** Set when this browser keeps its own text size (remote access): saving
   * Appearance hands the size here instead of to the shared config. */
  keepZoom?: (zoom: number) => void;
};

/** A zoom key was pressed: the size to show for a moment. `id` changes on
 * every press, including one that cannot go any further. */
export type ZoomNotice = { zoom: number; id: number };

/** Zoom keys are saved this long after the last press, so holding Ctrl+=
 * writes the config once. */
export const ZOOM_SAVE_DELAY_MS = 400;

/** The window's theme and text size: the saved ones from the `ui` config
 * group, an unsaved preview from Settings › Appearance, and zoom steps from
 * the keyboard and the command palette, which apply at once and are saved
 * once the keys stop. */
export function useAppearance({
  cfg,
  loaded,
  reloadConfig,
  toast,
}: {
  cfg: Record<string, unknown>;
  loaded: boolean;
  reloadConfig: () => Promise<void>;
  toast: (text: string, kind?: ToastKind) => void;
}) {
  const ui = (cfg.ui || {}) as { theme?: unknown; zoom?: unknown };
  const savedTheme = loaded ? String(ui.theme || "system") : undefined;
  // A phone or browser using remote access keeps its own text size in its
  // own storage, starting at 100%; `ui.zoom` is the desktop's.
  const [local] = useState(() => transportKind() === "remote");
  const [localZoom, setLocalZoom] = useState(() =>
    normalizeZoom(readStore(ZOOM_KEY)),
  );
  const configZoom = local
    ? localZoom
    : loaded
      ? normalizeZoom(ui.zoom)
      : undefined;
  // A size from the keyboard wins over the config until its save is read
  // back, so a slower reload of an earlier step never undoes a later one.
  const [chosen, setChosen] = useState<number | null>(null);
  const [preview, setPreview] = useState<AppearancePreview | null>(null);
  const [notice, setNotice] = useState<ZoomNotice | null>(null);
  const savedZoom = chosen ?? configZoom;
  useTheme(preview?.theme ?? savedTheme, savedTheme);
  useZoom(preview?.zoom ?? savedZoom, savedZoom);

  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const generation = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  /** One step larger (1), smaller (-1) or back to 100% (0). */
  const zoom = useStableCallback((direction: 1 | -1 | 0) => {
    const from = currentZoom();
    const next = direction === 0 ? DEFAULT_ZOOM : stepZoom(from, direction);
    setNotice((last) => ({ zoom: next, id: (last?.id ?? 0) + 1 }));
    if (next === from) return;
    // Applied now, not after the render, so a fast second press steps on.
    applyZoom(next);
    if (local) {
      setLocalZoom(next);
      return;
    }
    setChosen(next);
    const run = ++generation.current;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const settle = () => {
        if (run === generation.current) setChosen(null);
      };
      api
        .saveConfig({ ui: { zoom: next } })
        .then(reloadConfig)
        .then(settle, (e) => {
          // The saved size comes back; say why.
          settle();
          toast(String(e), "err");
        });
    }, ZOOM_SAVE_DELAY_MS);
  });

  /** "system", "light" or "dark", saved at once (the command palette). */
  const setTheme = useStableCallback((theme: string) => {
    api
      .saveConfig({ ui: { theme } })
      .then(reloadConfig)
      .catch((e) => toast(String(e), "err"));
  });

  const controls: AppearanceControls = {
    theme: savedTheme ?? "system",
    zoom: savedZoom ?? currentZoom(),
    preview: setPreview,
    keepZoom: local ? setLocalZoom : undefined,
  };
  return { theme: controls.theme, zoom, setTheme, notice, controls };
}
