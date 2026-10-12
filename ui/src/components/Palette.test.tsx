import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  Palette,
  noteRecentCommand,
  paletteGroups,
  readRecentCommands,
  type PaletteItem,
} from "./Palette";
import { conversationItems, projectItems } from "./shell/paletteJumps";
import type { Session } from "../api";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LABELS = [
  "New task",
  "Choose a model",
  "Open project",
  "Review changes",
  "Commit, push and open a pull request",
  "Compare models on this task",
  "Comparisons in this project",
  "Browse files",
  "Open a terminal",
  "Settings",
  "Keyboard shortcuts",
];
const command = (label: string, run = vi.fn()): PaletteItem => ({
  id: label.toLowerCase().replace(/\W+/g, "-"),
  label,
  hint: label === "New task" ? "Ctrl+N" : undefined,
  run,
});
const commands = () => LABELS.map((label) => command(label));

const field = () => screen.getByRole("combobox", { name: "Search commands" });
const type = (text: string) =>
  fireEvent.change(field(), { target: { value: text } });
const press = (key: string, init: object = {}) =>
  fireEvent.keyDown(field(), { key, ...init });
const optionNames = () =>
  screen
    .getAllByRole("option")
    .map((option) => option.textContent?.replace(/Ctrl\+N$/, ""));
const activeOption = () =>
  document.getElementById(field().getAttribute("aria-activedescendant")!);

it("finds commands by letters in order and shows the match without changing the name", () => {
  render(<Palette items={commands()} onClose={vi.fn()} />);
  type("rev ch");
  const best = screen.getAllByRole("option")[0];
  expect(best).toHaveAccessibleName("Review changes");
  expect(
    Array.from(best.querySelectorAll(".palette-match"), (m) => m.textContent),
  ).toEqual(["Rev", "ch"]);
  type("cmp");
  expect(optionNames().slice(0, 2)).toEqual([
    "Compare models on this task",
    "Comparisons in this project",
  ]);
  // The shortcut describes the option; it is not part of its name.
  type("new");
  const first = screen.getAllByRole("option")[0];
  expect(first).toHaveAccessibleName("New task");
  expect(first).toHaveAccessibleDescription("Ctrl+N");
});

it("wires the field to the listbox: expanded, active option, labelled groups", () => {
  render(<Palette items={commands()} onClose={vi.fn()} />);
  const listbox = screen.getByRole("listbox");
  expect(field()).toHaveAttribute("aria-expanded", "true");
  expect(field()).toHaveAttribute("aria-controls", listbox.id);
  expect(screen.getByRole("group", { name: "Commands" })).toBeTruthy();
  const options = screen.getAllByRole("option");
  expect(activeOption()).toBe(options[0]);
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  expect(options[1]).toHaveAttribute("aria-selected", "false");

  type("zzzz");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(field()).toHaveAttribute("aria-expanded", "false");
  expect(field()).not.toHaveAttribute("aria-activedescendant");
  expect(field()).not.toHaveAttribute("aria-controls");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Nothing matches “zzzz”.",
  );
});

it("moves with the arrow, Page and Home/End keys, and Enter runs the active command", () => {
  const items = commands();
  const onClose = vi.fn();
  render(<Palette items={items} onClose={onClose} />);
  press("ArrowUp");
  expect(activeOption()).toHaveAccessibleName("New task");
  press("ArrowDown");
  press("ArrowDown");
  expect(activeOption()).toHaveAccessibleName("Open project");
  press("End");
  expect(activeOption()).toHaveAccessibleName("Keyboard shortcuts");
  press("ArrowDown");
  expect(activeOption()).toHaveAccessibleName("Keyboard shortcuts");
  press("Home");
  expect(activeOption()).toHaveAccessibleName("New task");
  // Without a laid-out list a page is eight options.
  press("PageDown");
  expect(activeOption()).toHaveAccessibleName(LABELS[8]);
  press("PageDown");
  expect(activeOption()).toHaveAccessibleName(LABELS.at(-1));
  press("PageUp");
  expect(activeOption()).toHaveAccessibleName(LABELS[2]);
  // Shift+Home selects text in the field instead.
  press("Home", { shiftKey: true });
  expect(activeOption()).toHaveAccessibleName(LABELS[2]);
  // Typing starts again from the best match.
  type("files");
  expect(activeOption()).toHaveAccessibleName("Browse files");
  press("Enter");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(items[LABELS.indexOf("Browse files")].run).toHaveBeenCalledTimes(1);
});

it("the pointer picks an option without taking focus from the field", () => {
  const items = commands();
  render(<Palette items={items} onClose={vi.fn()} />);
  const option = screen.getByRole("option", { name: "Settings" });
  fireEvent.mouseMove(option);
  expect(activeOption()).toBe(option);
  const down = fireEvent.mouseDown(option);
  expect(down).toBe(false); // default prevented: the field keeps focus
  fireEvent.click(option);
  expect(items[LABELS.indexOf("Settings")].run).toHaveBeenCalledTimes(1);
});

it("lists matching conversations and projects once something is typed", () => {
  const open = vi.fn();
  const sessions = Array.from({ length: 10 }, (_, i): Session => ({
    id: `s${i}`,
    workspace: "/work/shop",
    status: "idle",
    title: `Fix the login bug ${i}`,
    updated_at: 0,
  }));
  render(
    <Palette
      items={commands()}
      conversations={conversationItems(sessions, open)}
      projects={projectItems(
        [{ id: "p1", path: "/work/shop", name: "shop", last_opened: 0 }],
        vi.fn(),
      )}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole("group", { name: "Conversations" })).toBeNull();
  type("login");
  const group = screen.getByRole("group", { name: "Conversations" });
  const found = Array.from(group.querySelectorAll('[role="option"]'));
  // At most eight, newest (the list's order) first.
  expect(found).toHaveLength(8);
  expect(found[0]).toHaveAccessibleName("Fix the login bug 0");
  expect(found[0]).toHaveAccessibleDescription("shop");
  fireEvent.click(found[2]);
  expect(open).toHaveBeenCalledWith("s2");
  // Conversations are not commands: nothing is remembered as recent.
  expect(readRecentCommands()).toEqual([]);

  type("shop");
  expect(
    screen
      .getByRole("group", { name: "Projects" })
      .querySelector('[role="option"]'),
  ).toHaveAccessibleName("shop");
});

it("shows the commands run last first when nothing is typed", () => {
  const items = commands();
  localStorage.setItem(
    "shadow:palette-recent",
    JSON.stringify(["settings", "gone", "review-changes"]),
  );
  render(<Palette items={items} onClose={vi.fn()} />);
  const recent = screen.getByRole("group", { name: "Recent" });
  expect(
    Array.from(
      recent.querySelectorAll('[role="option"]'),
      (o) => o.textContent,
    ),
  ).toEqual(["Settings", "Review changes"]);
  // Listed once: the full list continues without them.
  expect(screen.getAllByRole("option", { name: "Settings" })).toHaveLength(1);
  expect(activeOption()).toHaveAccessibleName("Settings");
  press("ArrowDown");
  press("ArrowDown");
  expect(activeOption()).toHaveAccessibleName("New task");
  press("Enter");
  expect(readRecentCommands()).toEqual([
    "new-task",
    "settings",
    "gone",
    "review-changes",
  ]);
});

it("keeps five recent commands and tolerates unreadable storage", () => {
  for (const id of ["a", "b", "c", "d", "e", "f", "b"]) noteRecentCommand(id);
  expect(readRecentCommands()).toEqual(["b", "f", "e", "d", "c"]);
  localStorage.setItem("shadow:palette-recent", "{not json");
  expect(readRecentCommands()).toEqual([]);
  localStorage.setItem("shadow:palette-recent", '{"a":1}');
  expect(readRecentCommands()).toEqual([]);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readRecentCommands()).toEqual([]);
  expect(() => noteRecentCommand("a")).not.toThrow();
  render(<Palette items={commands()} onClose={vi.fn()} />);
  expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
});

it("puts the group with the best match first", () => {
  const conversations = [
    { id: "c1", label: "Optimise the router", run: vi.fn() },
  ];
  const ids = (query: string) =>
    paletteGroups(query, { commands: commands(), conversations }).map(
      (g) => g.id,
    );
  expect(ids("settings")).toEqual(["commands"]);
  expect(ids("zzz")).toEqual([]);
  // "Optimise" fits "opt" better than "Open a terminal" does…
  expect(ids("opt")).toEqual(["conversations", "commands"]);
  // …and "terminal" fits "ter" better than "router" does.
  expect(ids("ter")).toEqual(["commands", "conversations"]);
  expect(ids("")).toEqual(["commands"]);
});

it("finds conversations by title under their project; untitled ones are left out", () => {
  const open = vi.fn();
  const items = conversationItems(
    [
      {
        id: "a",
        workspace: "/w/app",
        status: "idle",
        title: "",
        updated_at: 0,
      },
      {
        id: "b",
        workspace: "/w/.shadow/worktrees/t1",
        worktree_source: "/w/app",
        status: "idle",
        title: " Add dark mode ",
        updated_at: 0,
      },
    ],
    open,
  );
  expect(items.map(({ label, detail }) => ({ label, detail }))).toEqual([
    { label: "Add dark mode", detail: "app" },
  ]);
  items[0].run();
  expect(open).toHaveBeenCalledWith("b");
});

it("leaves out letters scattered across unrelated words when better matches exist", () => {
  const labels = (query: string) =>
    paletteGroups(query, {
      commands: [
        command("Workspace health"),
        command("Settings"),
        command("Stop the agent"),
      ],
      conversations: [command("Add dark mode to settings")],
    }).flatMap((group) => group.entries.map((entry) => entry.item.label));
  expect(labels("set")).toEqual([
    "Settings",
    "Stop the agent",
    "Add dark mode to settings",
  ]);
  // On its own, a scattered match is still offered.
  expect(
    paletteGroups("wsh", { commands: [command("Workspace health")] }).map(
      (group) => group.entries.length,
    ),
  ).toEqual([1]);
});
