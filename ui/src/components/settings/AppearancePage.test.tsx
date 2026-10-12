import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppearancePage } from "./PreferencePages";

afterEach(() => cleanup());

const group = (name: string) => screen.getByRole("radiogroup", { name });
const radio = (name: string, option: string) =>
  within(group(name)).getByRole("radio", { name: option });

it("previews theme and text size as they are picked, and saves them with the notifications", async () => {
  const preview = vi.fn();
  const onSave = vi.fn(async () => undefined);
  const { unmount } = render(
    <AppearancePage
      cfg={{ ui: { theme: "light", zoom: 1.1, notify: false } }}
      appearance={{ theme: "light", zoom: 1.1, preview }}
      onSave={onSave}
    />,
  );
  expect(radio("Theme", "Light").getAttribute("aria-checked")).toBe("true");
  expect(radio("Text size", "110%").getAttribute("aria-checked")).toBe("true");
  expect(
    within(group("Text size"))
      .getAllByRole("radio")
      .map((r) => r.textContent),
  ).toEqual(["80%", "90%", "100%", "110%", "125%", "150%", "175%"]);
  // Opening the page previews nothing.
  expect(preview).not.toHaveBeenCalled();
  fireEvent.click(radio("Theme", "Dark"));
  expect(preview).toHaveBeenLastCalledWith({ theme: "dark", zoom: 1.1 });
  fireEvent.click(radio("Text size", "150%"));
  expect(preview).toHaveBeenLastCalledWith({ theme: "dark", zoom: 1.5 });
  expect(radio("Text size", "150%").getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Reset to 100%" }));
  expect(preview).toHaveBeenLastCalledWith({ theme: "dark", zoom: 1 });
  expect(screen.getByRole("button", { name: "Reset to 100%" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(radio("Text size", "125%"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith({
    ui: expect.objectContaining({ theme: "dark", zoom: 1.25, notify: false }),
  });
  // Leaving the page goes back to whatever is saved.
  unmount();
  expect(preview).toHaveBeenLastCalledWith(null);
});

it("without the window's controls it starts from the config", () => {
  render(
    <AppearancePage
      cfg={{ ui: { theme: "dark", zoom: "1.2" } }}
      onSave={vi.fn(async () => undefined)}
    />,
  );
  expect(radio("Theme", "Dark").getAttribute("aria-checked")).toBe("true");
  expect(radio("Text size", "125%").getAttribute("aria-checked")).toBe("true");
});
