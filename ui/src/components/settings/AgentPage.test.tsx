import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/transport";
import { Settings } from "../Settings";
import { AgentPage } from "./AgentPage";

afterEach(cleanup);

const CFG = {
  agent: {
    max_steps: 64,
    tool_timeout_sec: 60,
    parallel_reads: true,
    compact_ratio: 0.7,
    model_retries: 3,
    retry_backoff_sec: 1.0,
    max_fix_retries: 3,
    max_output_bytes: 256_000,
    max_task_tokens: 1_000_000,
    autonomy_profile: "normal",
    summary_compaction: true,
    summary_timeout_sec: 60,
    stuck_check: true,
  },
  checkpoints: {
    shell: true,
    vendor: true,
    keep: 200,
    max_copy_files: 5000,
    max_copy_bytes: 67_108_864,
  },
  verification: { commands: ["cargo test --offline"] },
};

const input = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;
const describedBy = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") || "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent || "")
    .join(" | ");
const saveButton = () =>
  screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;

it("shows each group with the saved values, what they do, ranges and defaults", () => {
  render(<AgentPage cfg={CFG} onSave={vi.fn()} />);
  for (const legend of [
    "Limits",
    "Long conversations",
    "Recovery",
    "Subagents",
    "Checkpoints",
    "Checks",
  ])
    expect(screen.getByRole("group", { name: legend })).toBeTruthy();
  expect(input("Steps per task").value).toBe("64");
  expect(describedBy(input("Steps per task"))).toBe(
    "Model turns one task may take. At the limit the task stops so you can review its changes and continue. 1–1,000 · default 64.",
  );
  expect(describedBy(input("Tool time limit"))).toContain(
    "1–3,600 seconds · default 60.",
  );
  expect(input("Shorten history at this share of the context").value).toBe(
    "0.7",
  );
  expect(
    (screen.getByLabelText("Autonomy profile") as HTMLSelectElement).value,
  ).toBe("normal");
  // `subagents` is not in the configuration until it is saved: defaults.
  expect(input("Running at once").value).toBe("4");
  expect(input("Nesting depth").value).toBe("1");
  expect(input("Let the agent start subagents").checked).toBe(true);
  expect(input("Bytes copied in a folder without Git").value).toBe("67108864");
  expect(input("Check 1").value).toBe("cargo test --offline");
  // Nothing changed: nothing to save, nothing to reset.
  expect(saveButton().disabled).toBe(true);
  expect(
    screen.queryByRole("button", { name: /^Reset .* to its default$/ }),
  ).toBeNull();
});

it("validates inline, then saves only the changed keys of its own groups", async () => {
  const onSave = vi.fn(async () => {});
  render(<AgentPage cfg={CFG} onSave={onSave} />);
  const steps = input("Steps per task");
  fireEvent.change(steps, { target: { value: "0" } });
  expect(steps.getAttribute("aria-invalid")).toBe("true");
  expect(describedBy(steps)).toContain("Enter a whole number from 1 to 1,000.");
  fireEvent.change(input("Shorten history at this share of the context"), {
    target: { value: "0.99" },
  });
  expect(screen.getByRole("status").textContent).toBe(
    "Fix the 2 settings marked above to save.",
  );
  expect(saveButton().disabled).toBe(true);

  fireEvent.change(steps, { target: { value: "120" } });
  expect(steps.getAttribute("aria-invalid")).toBeNull();
  fireEvent.change(input("Shorten history at this share of the context"), {
    target: { value: "0.8" },
  });
  fireEvent.click(input("Pause and ask when the agent seems stuck"));
  fireEvent.change(input("Running at once"), { target: { value: "6" } });
  fireEvent.click(input("Before subscription turns"));
  fireEvent.change(screen.getByLabelText("Autonomy profile"), {
    target: { value: "extended" },
  });
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledWith(
    {
      agent: {
        max_steps: 120,
        compact_ratio: 0.8,
        stuck_check: false,
        autonomy_profile: "extended",
      },
      subagents: { max_parallel: 6 },
      checkpoints: { vendor: false },
    },
    { rethrow: true },
  );
});

it("resets one setting or all of them to the defaults", async () => {
  render(
    <AgentPage
      cfg={{
        ...CFG,
        agent: { ...CFG.agent, max_steps: 200, stuck_check: false },
      }}
      onSave={vi.fn()}
    />,
  );
  const reset = screen.getByRole("button", {
    name: "Reset Steps per task to its default",
  });
  fireEvent.click(reset);
  expect(input("Steps per task").value).toBe("64");
  expect(document.activeElement).toBe(input("Steps per task"));
  expect(
    screen.queryByRole("button", {
      name: "Reset Steps per task to its default",
    }),
  ).toBeNull();
  // The checkbox still differs; Reset all puts it and the checks back too.
  expect(input("Pause and ask when the agent seems stuck").checked).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Reset all to defaults" }),
  );
  expect(input("Pause and ask when the agent seems stuck").checked).toBe(true);
  expect(screen.queryByLabelText("Check 1")).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Reset all to defaults",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  // Focus moves to Save, which now saves the defaults.
  await waitFor(() => expect(document.activeElement).toBe(saveButton()));
  expect(saveButton().disabled).toBe(false);
});

it("edits the list of checks", async () => {
  const onSave = vi.fn(async () => {});
  render(<AgentPage cfg={CFG} onSave={onSave} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a check" }));
  const second = input("Check 2");
  await waitFor(() => expect(document.activeElement).toBe(second));
  fireEvent.change(second, { target: { value: "x".repeat(64_001) } });
  expect(second.getAttribute("aria-invalid")).toBe("true");
  expect(describedBy(second)).toBe("A command can be at most 64,000 bytes.");
  expect(saveButton().disabled).toBe(true);
  fireEvent.change(second, { target: { value: "  npm run lint  " } });
  fireEvent.click(screen.getByRole("button", { name: "Remove check 1" }));
  expect(input("Check 1").value).toBe("  npm run lint  ");
  fireEvent.click(saveButton());
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      { verification: { commands: ["npm run lint"] } },
      { rethrow: true },
    ),
  );
});

it("shows the engine's reason when it refuses a save, on the setting it names", async () => {
  const onSave = vi.fn(async () => {
    throw new ApiError("checkpoints.keep must be between 1 and 10000");
  });
  render(<AgentPage cfg={CFG} onSave={onSave} />);
  const keep = input("Checkpoints kept per repository");
  fireEvent.change(keep, { target: { value: "300" } });
  fireEvent.click(saveButton());
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "checkpoints.keep must be between 1 and 10000",
  );
  expect(keep.getAttribute("aria-invalid")).toBe("true");
  expect(describedBy(keep)).toContain(
    "checkpoints.keep must be between 1 and 10000",
  );
  expect(describedBy(saveButton())).toBe(
    "checkpoints.keep must be between 1 and 10000",
  );
  // Editing clears the refusal; the value stays for another try.
  fireEvent.change(keep, { target: { value: "250" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(keep.getAttribute("aria-invalid")).toBeNull();
});

it("says when the autonomy profile caps a larger token budget", () => {
  render(<AgentPage cfg={CFG} onSave={vi.fn()} />);
  const budget = input("Token budget per task");
  fireEvent.change(budget, { target: { value: "3000000" } });
  expect(describedBy(budget)).toContain(
    "With the Normal profile a task still stops at 1,000,000 tokens.",
  );
  fireEvent.change(screen.getByLabelText("Autonomy profile"), {
    target: { value: "extended" },
  });
  expect(describedBy(budget)).not.toContain("still stops");
});

it("is a Settings section", () => {
  render(
    <Settings
      cfg={CFG}
      initialSection="agent"
      health={null}
      sessionId=""
      busy={false}
      onClose={vi.fn()}
      onSave={vi.fn(async () => {})}
      onCatalogChanged={vi.fn()}
      onToast={vi.fn()}
      onOpenSession={vi.fn()}
      onSkillsChanged={async () => {}}
      onUseSkill={vi.fn()}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(
    within(nav)
      .getByRole("button", { name: "Agent" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(screen.getByRole("heading", { name: "Agent" })).toBeTruthy();
});

it("shows the profile's own values and notes the ones the open project changes", async () => {
  const onSave = vi.fn(async () => {});
  // The open project sets 200 steps and turns parallel reads off for itself.
  const cfg = {
    ...CFG,
    agent: { ...CFG.agent, max_steps: 200, parallel_reads: false },
    agent_profile: CFG.agent,
    agent_project: { max_steps: 200, parallel_reads: false },
  };
  render(<AgentPage cfg={cfg} onSave={onSave} />);
  const steps = input("Steps per task");
  expect(steps.value).toBe("64");
  expect(describedBy(steps)).toContain("This project uses 200.");
  expect(input("Run read-only tools of one turn together").checked).toBe(true);
  expect(
    describedBy(input("Run read-only tools of one turn together")),
  ).toContain("This project uses off.");
  expect(describedBy(input("Tool time limit"))).not.toContain("This project");
  // Nothing changed against the profile, so there is nothing to save; a
  // change is measured against the profile too.
  expect(saveButton().disabled).toBe(true);
  fireEvent.change(steps, { target: { value: "80" } });
  fireEvent.click(saveButton());
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledWith(
    { agent: { max_steps: 80 } },
    expect.anything(),
  );
});
