import { useMemo, useSyncExternalStore } from "react";
import { readStore, writeStore } from "./storage";

type Places = { pinned: string[]; recent: string[] };
const changed = "shadowcode-file-places";
const key = (workspace: string) => `shadow:file-places:${workspace}`;

function decode(raw: string | null): Places {
  let value;
  try {
    value = JSON.parse(raw ?? "{}");
  } catch {
    value = {};
  }
  function paths(items: unknown, limit: number): string[] {
    if (!Array.isArray(items)) return [];
    return [
      ...new Set(
        items.filter((p): p is string => typeof p === "string" && !!p),
      ),
    ].slice(0, limit);
  }
  return { pinned: paths(value?.pinned, 50), recent: paths(value?.recent, 12) };
}

function subscribe(refresh: () => void) {
  window.addEventListener(changed, refresh);
  window.addEventListener("storage", refresh);
  return () => {
    window.removeEventListener(changed, refresh);
    window.removeEventListener("storage", refresh);
  };
}

export function useFilePlaces(workspace: string) {
  const raw = useSyncExternalStore(subscribe, () => readStore(key(workspace)));
  return useMemo(() => decode(raw), [raw]);
}

function update(workspace: string, edit: (places: Places) => void) {
  if (!workspace) return;
  const places = decode(readStore(key(workspace)));
  edit(places);
  writeStore(key(workspace), JSON.stringify(places));
  window.dispatchEvent(new Event(changed));
}

export function rememberFile(workspace: string, path: string) {
  update(workspace, (places) => {
    places.recent = [path, ...places.recent.filter((p) => p !== path)].slice(
      0,
      12,
    );
  });
}

export function togglePinnedFile(workspace: string, path: string) {
  update(workspace, (places) => {
    if (places.pinned.includes(path))
      places.pinned = places.pinned.filter((p) => p !== path);
    else if (places.pinned.length < 50) places.pinned.push(path);
  });
}

export function clearRecentFiles(workspace: string) {
  update(workspace, (places) => {
    places.recent = [];
  });
}
