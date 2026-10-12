import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";

const mocks = vi.hoisted(() => ({ agents: vi.fn(), mentions: vi.fn() }));
vi.mock("../api", () => ({ api: mocks }));

import { Composer, type SlashCommand } from "./Composer";
import { EffortControl, ModeToggle } from "./ComposerModes";
import { usePromptHistory } from "../hooks/useComposerExtras";
import { pushHistory } from "../lib/promptHistory";
import type { Mention } from "../lib/mentions";

function Harness({
  onSubmit = () => {},
  commands = [],
}: {
  onSubmit?: () => void;
  commands?: SlashCommand[];
}) {
  const [task, setTask] = useState("");
  const [mentions, setMentions] = useState<Mention[]>([]);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const history = usePromptHistory("/p");
  return (
    <>
      <output data-testid="task">{task}</output>
      <Composer
        task={task}
        onTask={setTask}
        promptRef={promptRef}
        attachments={[]}
        onRemoveAttachment={() => {}}
        onAttach={() => {}}
        canAttachImages={false}
        attachDisabled={false}
        picker={null}
        controls={null}
        commands={commands}
        placeholder=""
        hint=""
        busy={false}
        queueing={false}
        submitting={false}
        locked={false}
        canSend
        sendBlocked={null}
        stopDisabled={false}
        onSubmit={onSubmit}
        onStop={() => {}}
        mentions={mentions}
        onMention={(m) => setMentions((list) => [...list, m])}
        onRemoveMention={(path) =>
          setMentions((list) => list.filter((m) => m.path !== path))
        }
        history={history}
      />
    </>
  );
}

const field = () => screen.getByLabelText("Message ShadowCode");
const typed = (value: string) =>
  fireEvent.change(field(), {
    target: { value, selectionStart: value.length, selectionEnd: value.length },
  });

beforeEach(() => {
  localStorage.clear();
  mocks.agents.mockResolvedValue({
    agents: [
      {
        name: "explore",
        description: "Search",
        mode: "read-only",
        source: "builtin",
        path: "",
      },
    ],
    issues: [],
  });
  mocks.mentions.mockImplementation(async (query: string) => ({
    items: [
      { path: "src", kind: "dir" },
      { path: "src/app.ts", kind: "file" },
    ].filter((i) => i.path.includes(query.replace("@", ""))),
    truncated: false,
  }));
});
afterEach(cleanup);

describe("composer @ menu", () => {
  it("attaches a file as a chip and @path text, and removing the chip removes the text", async () => {
    render(<Harness />);
    typed("Explain @app");
    const menu = await screen.findByRole("listbox", { name: "Mentions" });
    const option = await within(menu).findByRole("option", {
      name: /src\/app\.ts/,
    });
    expect(option.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByTestId("task").textContent).toBe("Explain @src/app.ts ");
    const chips = screen.getByRole("list", {
      name: "Mentioned files and folders",
    });
    expect(chips.textContent).toContain("src/app.ts");
    expect(mocks.mentions).toHaveBeenCalledWith("app", 12);
    fireEvent.click(screen.getByRole("button", { name: "Remove src/app.ts" }));
    expect(screen.getByTestId("task").textContent).toBe("Explain");
    expect(
      screen.queryByRole("list", { name: "Mentioned files and folders" }),
    ).toBeNull();
  });

  it("offers subagents at the start of a message, then folders", async () => {
    render(<Harness />);
    typed("@");
    const agents = await screen.findByRole("group", { name: "Subagents" });
    expect(agents.textContent).toContain("@explore");
    const files = await screen.findByRole("group", {
      name: "Files and folders",
    });
    expect(files.textContent).toContain("src/");
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(screen.getByTestId("task").textContent).toBe("@explore ");
    // Escape closes the menu without changing the text.
    typed("see @sr");
    await screen.findByRole("listbox", { name: "Mentions" });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "Mentions" })).toBeNull();
    expect(screen.getByTestId("task").textContent).toBe("see @sr");
  });
});

describe("composer / menu", () => {
  const commands: SlashCommand[] = [
    { name: "help", description: "List native commands", arg_spec: "" },
    {
      name: "status",
      description: "Show the selected model and active work",
      arg_spec: "",
    },
    { name: "model", description: "Show or select a model", arg_spec: "[id]" },
    { name: "models", description: "List registered models", arg_spec: "" },
    { name: "review", description: "Review project changes", arg_spec: "" },
  ];
  const hits = () =>
    within(screen.getByRole("listbox", { name: "Slash commands" }))
      .getAllByRole("option")
      .map((option) => option.querySelector("strong")?.textContent);

  it("lists name matches first, then names and descriptions containing the text", () => {
    render(<Harness commands={commands} />);
    typed("/mod");
    expect(hits()).toEqual(["/model", "/models", "/status"]);
    typed("/view");
    expect(hits()).toEqual(["/review"]);
    typed("/zzz");
    expect(screen.getByText("No matching commands")).toBeTruthy();
  });

  it("Enter picks the highlighted command; the next Enter sends", () => {
    const submit = vi.fn();
    render(<Harness commands={commands} onSubmit={submit} />);
    typed("/mod");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(submit).not.toHaveBeenCalled();
    // A command without arguments gets no trailing space.
    expect(screen.getByTestId("task").textContent).toBe("/models");
    expect(
      screen.queryByRole("listbox", { name: "Slash commands" }),
    ).toBeNull();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(1);
    // Tab still picks, and a command that takes arguments gets a space.
    typed("/mo");
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(screen.getByTestId("task").textContent).toBe("/model ");
    // Nothing to pick: Enter sends what was typed.
    typed("/zzz");
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("points the field at the menu and its highlighted command", () => {
    render(<Harness commands={commands} />);
    expect(field().getAttribute("aria-controls")).toBeNull();
    expect(field().getAttribute("aria-autocomplete")).toBe("list");
    typed("/mod");
    const menu = screen.getByRole("listbox", { name: "Slash commands" });
    expect(field().getAttribute("aria-controls")).toBe(menu.id);
    const active = () =>
      document.getElementById(field().getAttribute("aria-activedescendant")!);
    expect(active()?.getAttribute("aria-selected")).toBe("true");
    expect(active()?.textContent).toContain("/model");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(active()?.textContent).toContain("/models");
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().getAttribute("aria-controls")).toBeNull();
    expect(field().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("points the field at the @ menu while it is open", async () => {
    render(<Harness />);
    typed("Explain @app");
    const menu = await screen.findByRole("listbox", { name: "Mentions" });
    await within(menu).findByRole("option", { name: /src\/app\.ts/ });
    expect(field().getAttribute("aria-controls")).toBe(menu.id);
    expect(
      document.getElementById(field().getAttribute("aria-activedescendant")!)
        ?.textContent,
    ).toContain("src/app.ts");
  });
});

describe("composer history", () => {
  it("recalls earlier prompts with ↑ and ↓ only from an empty field", () => {
    pushHistory("/p", "first prompt");
    pushHistory("/p", "second prompt");
    const submit = vi.fn();
    render(<Harness onSubmit={submit} />);
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(screen.getByTestId("task").textContent).toBe("second prompt");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(screen.getByTestId("task").textContent).toBe("first prompt");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(screen.getByTestId("task").textContent).toBe("first prompt");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByTestId("task").textContent).toBe("second prompt");
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByTestId("task").textContent).toBe("");
    // With text of its own, ↑ moves the caret instead.
    typed("draft");
    fireEvent.keyDown(field(), { key: "ArrowUp" });
    expect(screen.getByTestId("task").textContent).toBe("draft");
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("mode and effort", () => {
  it("switches mode and effort", async () => {
    const onMode = vi.fn();
    const onEffort = vi.fn();
    render(
      <>
        <ModeToggle mode="code" onChange={onMode} />
        <EffortControl effort="default" onChange={onEffort} />
      </>,
    );
    expect(
      screen.getByRole("radio", { name: "Code" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Plan" }));
    expect(onMode).toHaveBeenCalledWith("plan");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Reasoning effort"), {
        target: { value: "high" },
      });
    });
    expect(onEffort).toHaveBeenCalledWith("high");
  });
});
