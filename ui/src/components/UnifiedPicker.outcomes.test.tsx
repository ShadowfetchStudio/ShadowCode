import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UnifiedPicker } from "./UnifiedPicker";
import type { PickerTarget } from "../lib/picker";
import type { ModelOutcomes } from "../lib/outcomes";

afterEach(() => cleanup());

const codex: PickerTarget = {
  id: "cli:codex",
  provider: "cli:codex",
  group: "subscriptions",
  name: "Codex",
  inference: "cloud",
  availability: "ready",
  availability_label: "Ready",
  tools: true,
};
const cheap: PickerTarget = {
  id: "api:openrouter:cheap",
  provider: "openrouter",
  group: "api",
  name: "Cheap Coder",
  inference: "cloud",
  availability: "ready",
  availability_label: "Ready",
  tools: true,
};

const outcomes: ModelOutcomes = {
  workspace: "/p",
  suggest_from_history: true,
  models: [
    {
      model_id: "cli:codex",
      model_label: "Codex",
      samples: 3,
      median_seconds: 90,
      median_tokens: 1000,
      median_cost_usd: null,
      cost_samples: 0,
      verified_samples: 2,
      passes: 2,
      pass_rate: 1,
      last_finished_at: 2,
    },
    {
      model_id: "api:openrouter:cheap",
      model_label: "cheap",
      samples: 2,
      median_seconds: 40,
      median_tokens: 800,
      median_cost_usd: 0.03,
      cost_samples: 2,
      verified_samples: 2,
      passes: 1,
      pass_rate: 0.5,
      last_finished_at: 1,
    },
  ],
  suggestion: {
    model_id: "api:openrouter:cheap",
    name: "Cheap Coder",
    median_cost_usd: 0.03,
    pass_rate: 0.5,
    passes: 1,
    samples: 2,
    reason: "Cheapest model that passed verification in this project",
  },
};

function Harness({
  onSelect = vi.fn(),
  onSuggestionsChange,
  data = outcomes,
}: {
  onSelect?: (id: string) => void;
  onSuggestionsChange?: (on: boolean) => void;
  data?: ModelOutcomes;
}) {
  const [value, setValue] = useState("cli:codex");
  const [open, setOpen] = useState(true);
  return (
    <UnifiedPicker
      targets={[codex, cheap]}
      value={value}
      open={open}
      onOpenChange={setOpen}
      onSelect={(id) => {
        setValue(id);
        onSelect(id);
      }}
      onConnect={vi.fn()}
      onSetup={vi.fn()}
      onAddLocal={vi.fn()}
      outcomes={data}
      onSuggestionsChange={onSuggestionsChange}
    />
  );
}

it("shows a compact per-row history with unavailable costs", () => {
  render(<Harness />);
  expect(
    screen.getByText(/Here: 1m 30s · cost unavailable · 2\/2 passed · 3 tasks/),
  ).toBeTruthy();
  expect(
    screen.getByText(/Here: 40s · \$0.03 · 1\/2 passed · 2 tasks/),
  ).toBeTruthy();
});

it("offers the suggestion and switches only when accepted", () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  const note = screen.getByRole("note", { name: "Suggested model" });
  expect(note.textContent).toContain("Cheap Coder");
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use Cheap Coder" }));
  expect(onSelect).toHaveBeenCalledWith("api:openrouter:cheap");
});

it("can dismiss the suggestion without switching", () => {
  const onSelect = vi.fn();
  render(<Harness onSelect={onSelect} />);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("note", { name: "Suggested model" })).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});

it("shows no suggestion when the server offers none", () => {
  render(<Harness data={{ ...outcomes, suggestion: null }} />);
  expect(screen.queryByRole("note", { name: "Suggested model" })).toBeNull();
});

it("opens the side-by-side history and toggles the opt-in", () => {
  const onSuggestionsChange = vi.fn();
  render(<Harness onSuggestionsChange={onSuggestionsChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Compare history" }));
  const table = screen.getByRole("table", {
    name: "Model history in this project",
  });
  expect(table.textContent).toContain("Median reported cost");
  expect(table.textContent).toContain("cost unavailable");
  expect(table.textContent).toContain("$0.03");
  const box = screen.getByRole("checkbox", {
    name: /Suggest the cheapest model that passed here/,
  });
  expect((box as HTMLInputElement).checked).toBe(true);
  fireEvent.click(box);
  expect(onSuggestionsChange).toHaveBeenCalledWith(false);
});
