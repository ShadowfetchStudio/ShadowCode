import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FindBar } from "./FindBar";

afterEach(cleanup);

function bar(over: Partial<Parameters<typeof FindBar>[0]> = {}) {
  const props = {
    query: "bug",
    onQuery: vi.fn(),
    label: "3 of 12",
    total: 12,
    searching: false,
    error: "",
    focusRequest: 1,
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { props, view: render(<FindBar {...props} />) };
}

const input = () =>
  screen.getByRole("textbox", { name: "Find in conversation" });

it("is a labelled search with a polite count", () => {
  const { props } = bar({ searching: true });
  expect(screen.getByRole("search", { name: "Find in conversation" }));
  expect(input()).toHaveProperty("value", "bug");
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(status.textContent).toBe("3 of 12, searching older messages");
  fireEvent.change(input(), { target: { value: "bugs" } });
  expect(props.onQuery).toHaveBeenCalledWith("bugs");
});

it("steps with Enter, Shift+Enter, F3 and the buttons; Escape closes", () => {
  const { props } = bar();
  fireEvent.keyDown(input(), { key: "Enter" });
  expect(props.onNext).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
  expect(props.onPrevious).toHaveBeenCalledTimes(1);
  // F3 works wherever focus is, but not inside a terminal or a dialog.
  fireEvent.keyDown(document.body, { key: "F3" });
  expect(props.onNext).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(document.body, { key: "F3", shiftKey: true });
  expect(props.onPrevious).toHaveBeenCalledTimes(2);
  const terminal = document.createElement("div");
  terminal.dataset.terminal = "";
  document.body.append(terminal);
  fireEvent.keyDown(terminal, { key: "F3" });
  expect(props.onNext).toHaveBeenCalledTimes(2);
  terminal.remove();
  fireEvent.click(screen.getByRole("button", { name: "Next match" }));
  fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
  expect(props.onNext).toHaveBeenCalledTimes(3);
  expect(props.onPrevious).toHaveBeenCalledTimes(3);
  // Escape is handled here, so the window's shortcuts leave it alone.
  const escape = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  input().dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(props.onClose).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close find" }));
  expect(props.onClose).toHaveBeenCalledTimes(2);
});

it("cannot step without matches and says when older pages are missing", () => {
  bar({ label: "No matches", total: 0, error: "Engine stopped" });
  expect(screen.getByRole("status").textContent).toBe("No matches");
  expect(
    screen.getByRole("button", { name: "Next match" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe(
    "Older messages unavailable",
  );
});

function Host() {
  const [open, setOpen] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setOpen((n) => n + 1)}>
        Open
      </button>
      {open > 0 && (
        <FindBar
          query="bug"
          onQuery={() => undefined}
          label=""
          total={0}
          searching={false}
          error=""
          focusRequest={open}
          onNext={() => undefined}
          onPrevious={() => undefined}
          onClose={() => setOpen(0)}
        />
      )}
    </>
  );
}

it("takes focus, selects the query on each request and gives focus back", () => {
  render(<Host />);
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(input());
  const field = input() as HTMLInputElement;
  field.setSelectionRange(3, 3);
  // Ctrl+F again (from anywhere) selects the query to type over.
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(field);
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
  fireEvent.keyDown(field, { key: "Escape" });
  expect(screen.queryByRole("search")).toBeNull();
  expect(document.activeElement).toBe(opener);
});
