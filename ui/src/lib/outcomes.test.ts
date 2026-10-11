import { describe, expect, it } from "vitest";
import {
  compactHistory,
  formatCost,
  formatDuration,
  formatPassRate,
  type ModelOutcomeStats,
} from "./outcomes";

const base: ModelOutcomeStats = {
  model_id: "cli:codex",
  model_label: "Codex",
  samples: 4,
  median_seconds: 125,
  median_tokens: 2000,
  median_cost_usd: null,
  cost_samples: 0,
  verified_samples: 3,
  passes: 2,
  pass_rate: 2 / 3,
  last_finished_at: 1,
};

describe("outcome formatting", () => {
  it("never invents a cost", () => {
    expect(formatCost(null)).toBe("cost unavailable");
    expect(formatCost(0)).toBe("$0");
    expect(formatCost(0.004)).toBe("<$0.01");
    expect(formatCost(0.256)).toBe("$0.26");
  });

  it("formats durations", () => {
    expect(formatDuration(null)).toBe("unavailable");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3720)).toBe("1h 2m");
  });

  it("shows pass counts only when something was verified", () => {
    expect(formatPassRate(base)).toBe("2/3 passed");
    expect(
      formatPassRate({ ...base, pass_rate: null, verified_samples: 0 }),
    ).toBe("not verified");
  });

  it("builds the compact row history", () => {
    expect(compactHistory(base)).toBe(
      "2m 5s · cost unavailable · 2/3 passed · 4 tasks",
    );
    expect(compactHistory({ ...base, samples: 1, median_cost_usd: 0.1 })).toBe(
      "2m 5s · $0.10 · 2/3 passed · 1 task",
    );
  });
});
