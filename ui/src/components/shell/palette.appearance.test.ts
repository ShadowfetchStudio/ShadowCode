import { expect, it, vi } from "vitest";
import { paletteItems, type PaletteActions } from "./palette";

function items(themeInUse?: string) {
  const themes: string[] = [];
  const zooms: number[] = [];
  const actions: PaletteActions = {
    newTask: vi.fn(),
    chooseModel: vi.fn(),
    openProject: vi.fn(),
    panel: vi.fn(),
    compare: vi.fn(),
    comparisons: vi.fn(),
    settings: vi.fn(),
    exportTask: vi.fn(),
    stop: vi.fn(),
    theme: (theme) => themes.push(theme),
    themeInUse,
    zoom: (direction) => zooms.push(direction),
    help: vi.fn(),
    find: vi.fn(),
  };
  return { list: paletteItems(actions), themes, zooms };
}

it("reaches every theme, System included, and marks the one in use", () => {
  const { list, themes } = items("system");
  const entries = list.filter((item) => item.label.startsWith("Theme: "));
  expect(entries.map((item) => item.label)).toEqual([
    "Theme: same as the system",
    "Theme: light",
    "Theme: dark",
  ]);
  expect(entries.map((item) => item.hint)).toEqual([
    "In use",
    undefined,
    undefined,
  ]);
  entries.forEach((item) => item.run());
  expect(themes).toEqual(["system", "light", "dark"]);
  // Nothing is marked before the config has loaded.
  expect(
    items()
      .list.filter((item) => item.label.startsWith("Theme: "))
      .every((item) => item.hint === undefined),
  ).toBe(true);
});

it("zooms in, out and back to 100% with the keys shown", () => {
  const { list, zooms } = items("light");
  const zoom = list.filter((item) => item.id.startsWith("zoom-"));
  expect(zoom.map((item) => [item.label, item.hint])).toEqual([
    ["Zoom in · larger text", "Ctrl+="],
    ["Zoom out · smaller text", "Ctrl+-"],
    ["Reset zoom to 100%", "Ctrl+0"],
  ]);
  zoom.forEach((item) => item.run());
  expect(zooms).toEqual([1, -1, 0]);
});
