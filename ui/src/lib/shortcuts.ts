/** Match shortcut hints to the keyboard of the computer displaying the UI.
 * Remote access uses the browser's keyboard, not the engine host's platform. */
export function shortcutModifier(
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "⌘" : "Ctrl";
}

export function shortcutHint(keys: string, platform?: string): string {
  const modifier = shortcutModifier(platform);
  // Keep macOS Minimize and Cycle Windows available to the native window.
  if (modifier === "⌘" && keys === "M") return "⌘+Shift+M";
  if (modifier === "⌘" && keys === "`") return "Ctrl+`";
  return `${modifier}+${keys}`;
}
