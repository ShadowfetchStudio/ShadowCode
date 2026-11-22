import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextChip } from "./ContextChip";

afterEach(() => {
  cleanup();
});

describe("ContextChip interactive HUD", () => {
  it("shows progress meter and triggers compact context action", () => {
    const onCompact = vi.fn();
    render(
      <ContextChip
        input={{
          local: false,
          budget: { used: 64000, limit: 128000 },
          contextLimit: 128000,
        }}
        onCompact={onCompact}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Context and cost/i });
    fireEvent.click(trigger);

    const meter = screen.getByRole("progressbar", { name: "Context window usage" });
    expect(meter).toHaveAttribute("aria-valuenow", "50");

    const compactBtn = screen.getByRole("button", { name: "Compact context" });
    fireEvent.click(compactBtn);
    expect(onCompact).toHaveBeenCalledOnce();
  });

  it("disables compact context while busy", () => {
    render(
      <ContextChip
        input={{
          local: true,
          budget: { used: 96000, limit: 128000 },
          contextLimit: 128000,
        }}
        busy
        onCompact={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Context and cost/i }));
    expect(screen.getByRole("button", { name: "Compact context" })).toBeDisabled();
  });
});
