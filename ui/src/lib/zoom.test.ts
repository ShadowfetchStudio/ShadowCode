import { expect, it } from "vitest";
import {
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  normalizeZoom,
  stepZoom,
  unzoomViewportUnits,
  zoomPercent,
  zoomStatusText,
} from "./zoom";

it("steps up and down through the offered sizes and stops at the ends", () => {
  let zoom = DEFAULT_ZOOM;
  const up: number[] = [];
  for (let i = 0; i < 6; i++) up.push((zoom = stepZoom(zoom, 1)));
  expect(up).toEqual([1.1, 1.25, 1.5, 1.75, 1.75, 1.75]);
  const down: number[] = [];
  for (let i = 0; i < 8; i++) down.push((zoom = stepZoom(zoom, -1)));
  expect(down).toEqual([1.5, 1.25, 1.1, 1, 0.9, 0.8, 0.8, 0.8]);
  expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.8, 1.75]);
  // Between two steps, the neighbour in that direction.
  expect(stepZoom(1.2, 1)).toBe(1.25);
  expect(stepZoom(1.2, -1)).toBe(1.1);
  // Floating-point noise does not skip a step.
  expect(stepZoom(1.1000000001, 1)).toBe(1.25);
  expect(stepZoom(0.8999999999, -1)).toBe(0.8);
});

it("reads a saved size as the nearest step, else 100%", () => {
  for (const step of ZOOM_STEPS) expect(normalizeZoom(step)).toBe(step);
  expect(normalizeZoom(1.2)).toBe(1.25);
  expect(normalizeZoom("1.5")).toBe(1.5);
  expect(normalizeZoom(4)).toBe(1.75);
  expect(normalizeZoom(0.1)).toBe(0.8);
  for (const bad of [undefined, null, "", " ", "big", 0, -1, NaN, {}, true])
    expect(normalizeZoom(bad)).toBe(1);
});

it("says the size, and when it can go no further", () => {
  expect(zoomPercent(1.25)).toBe("125%");
  expect(zoomPercent(0.9)).toBe("90%");
  expect(zoomStatusText(1.1)).toBe("Text size 110%");
  expect(zoomStatusText(1.75)).toBe("Text size 175% · largest");
  expect(zoomStatusText(0.8)).toBe("Text size 80% · smallest");
});

it("divides viewport lengths by the CSS zoom and leaves everything else", () => {
  const z = (length: string) => `calc(${length} / var(--zoom, 1))`;
  expect(unzoomViewportUnits("min(86vh, 820px)")).toBe(
    `min(${z("86vh")}, 820px)`,
  );
  expect(unzoomViewportUnits("calc(100vh - 250px)")).toBe(
    `calc(${z("100vh")} - 250px)`,
  );
  expect(unzoomViewportUnits("clamp(22px, 2.6vw, 30px)")).toBe(
    `clamp(22px, ${z("2.6vw")}, 30px)`,
  );
  expect(unzoomViewportUnits("18vh auto 0")).toBe(`${z("18vh")} auto 0`);
  expect(unzoomViewportUnits("min(92dvh, 760px)")).toBe(
    `min(${z("92dvh")}, 760px)`,
  );
  expect(unzoomViewportUnits("-5vmin .5vmax")).toBe(
    `${z("-5vmin")} ${z(".5vmax")}`,
  );
  // Not lengths: identifiers, custom properties, colours, pixels, keywords.
  for (const value of [
    "12px",
    "var(--drawer-w)",
    "#10vh0a",
    "url(icon-2vh.png)",
    "auto",
    "a10vh",
    "0 0 4px var(--shadow)",
  ])
    expect(unzoomViewportUnits(value)).toBe(value);
  // Already divided (a stylesheet processed twice) stays as it is.
  const once = unzoomViewportUnits("calc(100vh - 2px)");
  expect(unzoomViewportUnits(once)).toBe(once);
});
