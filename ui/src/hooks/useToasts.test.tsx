import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { TOAST_RESUME_MS, useToasts } from "./useToasts";
import { Toasts } from "../components/shell/Chrome";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The window's wiring: the hook's state, rendered by the stack. */
function Harness({
  shown,
  more = "",
}: {
  shown: { text: string; kind?: "ok" | "err" | "info"; undo?: boolean }[];
  more?: string;
}) {
  const { toasts, toast, dismiss, hold } = useToasts();
  useEffect(() => {
    for (const t of shown)
      toast(
        t.text,
        t.kind,
        t.undo ? { label: "Undo", run: () => undefined } : undefined,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {more && (
        <button type="button" onClick={() => toast(more)}>
          More
        </button>
      )}
      <Toasts toasts={toasts} onDismiss={dismiss} onHold={hold} />
    </>
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const note = (text: string) => screen.queryByText(text)?.closest(".toast");

it("closes after its time, errors later than the rest", () => {
  render(
    <Harness shown={[{ text: "Saved" }, { text: "Failed", kind: "err" }]} />,
  );
  advance(4999);
  expect(note("Saved")).toBeTruthy();
  advance(1);
  expect(note("Saved")).toBeFalsy();
  expect(note("Failed")?.getAttribute("role")).toBe("alert");
  advance(3000);
  expect(note("Failed")).toBeFalsy();
});

it("waits while pointed at, then finishes the time it had left", () => {
  render(<Harness shown={[{ text: "Task deleted" }]} />);
  advance(1000);
  fireEvent.pointerEnter(note("Task deleted")!);
  advance(60_000);
  expect(note("Task deleted")).toBeTruthy();
  fireEvent.pointerLeave(note("Task deleted")!);
  advance(3999);
  expect(note("Task deleted")).toBeTruthy();
  advance(1);
  expect(note("Task deleted")).toBeFalsy();
});

it("waits while focus is inside and gives a short minimum afterwards", () => {
  render(<Harness shown={[{ text: "Restored 1 file.", undo: true }]} />);
  advance(11_900);
  const undo = screen.getByRole("button", { name: "Undo" });
  fireEvent.focus(undo);
  advance(30_000);
  expect(note("Restored 1 file.")).toBeTruthy();
  // Moving between its buttons keeps it held.
  const close = screen.getByRole("button", { name: "Dismiss notification" });
  fireEvent.blur(undo, { relatedTarget: close });
  fireEvent.focus(close);
  advance(30_000);
  expect(note("Restored 1 file.")).toBeTruthy();
  // Pointer and focus are tracked apart: leaving with the pointer while
  // focus stays inside keeps it.
  fireEvent.pointerEnter(note("Restored 1 file.")!);
  fireEvent.pointerLeave(note("Restored 1 file.")!);
  advance(30_000);
  expect(note("Restored 1 file.")).toBeTruthy();
  fireEvent.blur(close, { relatedTarget: document.body });
  advance(TOAST_RESUME_MS - 1);
  expect(note("Restored 1 file.")).toBeTruthy();
  advance(1);
  expect(note("Restored 1 file.")).toBeFalsy();
});

it("a held notification pushed out by newer ones still finishes", () => {
  render(
    <Harness
      shown={[{ text: "One" }, { text: "Two" }, { text: "Three" }]}
      more="Four"
    />,
  );
  fireEvent.pointerEnter(note("One")!);
  expect(vi.getTimerCount()).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  // "One" left the stack while held: nothing will report leaving it, so its
  // countdown runs again (four shown plus that one).
  expect(note("One")).toBeFalsy();
  expect(vi.getTimerCount()).toBe(5);
  advance(5000);
  expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelectorAll(".toast")).toHaveLength(0);
});

it("closes notifications raised while the window starts (StrictMode)", () => {
  // StrictMode mounts, unmounts and mounts again in development; the
  // countdowns started in between must survive that.
  render(
    <StrictMode>
      <Harness shown={[{ text: "Starting" }]} />
    </StrictMode>,
  );
  expect(document.querySelectorAll(".toast").length).toBeGreaterThan(0);
  advance(5000);
  expect(document.querySelectorAll(".toast")).toHaveLength(0);
});
