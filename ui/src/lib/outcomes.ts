/** Per-model, per-project outcome history from GET /api/models/outcomes.
 * Costs are shown only when the provider, vendor CLI or this computer
 * reported them; everything else reads "unavailable", never a guess. */

export type ModelOutcomeStats = {
  model_id: string;
  model_label: string;
  samples: number;
  median_seconds: number | null;
  median_tokens: number | null;
  /** Median over tasks with a reported cost; null = unavailable. */
  median_cost_usd: number | null;
  cost_samples: number;
  verified_samples: number;
  passes: number;
  /** null when no task was verified. */
  pass_rate: number | null;
  last_finished_at: number;
};

export type OutcomeSuggestion = {
  model_id: string;
  name: string;
  median_cost_usd: number;
  pass_rate: number;
  passes: number;
  samples: number;
  reason: string;
};

export type ModelOutcomes = {
  workspace: string;
  /** `routing.suggest_from_history`: the opt-in for suggestions. */
  suggest_from_history: boolean;
  models: ModelOutcomeStats[];
  suggestion: OutcomeSuggestion | null;
};

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "unavailable";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatCost(usd: number | null): string {
  if (usd == null || !Number.isFinite(usd)) return "cost unavailable";
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

export function formatPassRate(stats: ModelOutcomeStats): string {
  if (stats.pass_rate == null || stats.verified_samples === 0)
    return "not verified";
  return `${stats.passes}/${stats.verified_samples} passed`;
}

/** The compact one-line history for a picker row. */
export function compactHistory(stats: ModelOutcomeStats): string {
  return [
    formatDuration(stats.median_seconds),
    formatCost(stats.median_cost_usd),
    formatPassRate(stats),
    `${stats.samples} ${stats.samples === 1 ? "task" : "tasks"}`,
  ].join(" · ");
}

export function statsFor(
  outcomes: ModelOutcomes | null | undefined,
  id: string,
): ModelOutcomeStats | undefined {
  return outcomes?.models.find((m) => m.model_id === id);
}
