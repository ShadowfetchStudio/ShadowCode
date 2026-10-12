/** Settings › Agent: the `agent`, `subagents`, `checkpoints` and
 * `verification` configuration groups. Defaults, types and ranges mirror the
 * engine (native/core/src/config.rs, subagents.rs, checkpoint.rs and
 * verification.rs); config.example.yaml documents the same keys. */

export type AgentGroup = "agent" | "subagents" | "checkpoints";

type Base = {
  group: AgentGroup;
  key: string;
  label: string;
  /** One friendly line; the range and default are added after it. */
  hint: string;
};
export type NumberField = Base & {
  kind: "int" | "float";
  min: number;
  max: number;
  default: number;
  /** Shown after the range, such as "seconds" or "bytes". */
  unit?: string;
  /** Replace the generated range and default text where words help. */
  range?: string;
  defaultLabel?: string;
  /** The arrow-key step of a decimal field. */
  step?: number;
};
export type BoolField = Base & { kind: "bool"; default: boolean };
export type ChoiceField = Base & {
  kind: "choice";
  default: string;
  options: { value: string; label: string }[];
};
export type AgentField = NumberField | BoolField | ChoiceField;
export type AgentSection = {
  id: string;
  title: string;
  intro?: string;
  fields: AgentField[];
};

/** Profiles that cap the token budget (autonomy.rs `caps_for`). Unlimited
 * and custom use the configured budget as it is. */
export const PROFILE_TOKEN_CAPS: Record<string, number> = {
  conservative: 64_000,
  normal: 1_000_000,
  extended: 4_000_000,
};

const PROFILE_LABELS: Record<string, string> = {
  normal: "Normal",
  conservative: "Conservative",
  extended: "Extended",
  unlimited: "Unlimited",
  custom: "Custom",
};

export const formatNumber = (value: number) => value.toLocaleString("en-US");

export const AGENT_SECTIONS: AgentSection[] = [
  {
    id: "limits",
    title: "Limits",
    fields: [
      {
        kind: "int",
        group: "agent",
        key: "max_steps",
        label: "Steps per task",
        hint: "Model turns one task may take. At the limit the task stops so you can review its changes and continue.",
        min: 1,
        max: 1000,
        default: 64,
      },
      {
        kind: "int",
        group: "agent",
        key: "max_task_tokens",
        label: "Token budget per task",
        hint: "Tokens one task may use before it stops. Changes it made are kept for review.",
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
        range: "At least 1",
        default: 1_000_000,
      },
      {
        kind: "choice",
        group: "agent",
        key: "autonomy_profile",
        label: "Autonomy profile",
        hint: "A profile can lower the token budget, never raise it.",
        default: "normal",
        options: Object.keys(PROFILE_LABELS).map((value) => ({
          value,
          label:
            value in PROFILE_TOKEN_CAPS
              ? `${PROFILE_LABELS[value]} · stops at ${formatNumber(PROFILE_TOKEN_CAPS[value])} tokens`
              : `${PROFILE_LABELS[value]} · uses the token budget`,
        })),
      },
      {
        kind: "int",
        group: "agent",
        key: "tool_timeout_sec",
        label: "Tool time limit",
        hint: "Longest one tool call, such as a shell command, may run before it is stopped.",
        min: 1,
        max: 3600,
        unit: "seconds",
        default: 60,
      },
      {
        kind: "int",
        group: "agent",
        key: "max_output_bytes",
        label: "Tool output kept per call",
        hint: "Output of one tool call the agent gets to read; anything longer is cut.",
        min: 4096,
        max: 4_000_000,
        unit: "bytes",
        default: 256_000,
      },
      {
        kind: "bool",
        group: "agent",
        key: "parallel_reads",
        label: "Run read-only tools of one turn together",
        hint: "Reads and searches the model asks for in the same turn run at the same time.",
        default: true,
      },
    ],
  },
  {
    id: "context",
    title: "Long conversations",
    fields: [
      {
        kind: "float",
        group: "agent",
        key: "compact_ratio",
        label: "Shorten history at this share of the context",
        hint: "When a conversation fills this share of the model's context, its oldest steps are removed. 0.7 is 70%.",
        min: 0.2,
        max: 0.95,
        default: 0.7,
        step: 0.05,
      },
      {
        kind: "bool",
        group: "agent",
        key: "summary_compaction",
        label: "Summarize removed steps with the model",
        hint: "The same model writes a short summary of what was removed. Off, or when it fails, a built-in digest is used.",
        default: true,
      },
      {
        kind: "int",
        group: "agent",
        key: "summary_timeout_sec",
        label: "Longest wait for the summary",
        hint: "After this, the built-in digest is used instead.",
        min: 5,
        max: 600,
        unit: "seconds",
        default: 60,
      },
    ],
  },
  {
    id: "recovery",
    title: "Recovery",
    fields: [
      {
        kind: "int",
        group: "agent",
        key: "model_retries",
        label: "Provider retries",
        hint: "Times a request is sent again when the provider is busy or failing, or the connection drops mid-answer.",
        min: 0,
        max: 10,
        default: 3,
      },
      {
        kind: "float",
        group: "agent",
        key: "retry_backoff_sec",
        label: "First retry wait",
        hint: "Each later wait doubles, with a little randomness. A wait the provider asks for wins.",
        min: 0,
        max: 30,
        unit: "seconds",
        default: 1,
        step: 0.5,
      },
      {
        kind: "int",
        group: "agent",
        key: "max_fix_retries",
        label: "Fix attempts per task",
        hint: "Times a task is sent back when it stopped without doing or checking the work, or a completion check failed. When none are left, the task fails.",
        min: 0,
        max: 10,
        default: 3,
      },
      {
        kind: "bool",
        group: "agent",
        key: "stuck_check",
        label: "Pause and ask when the agent seems stuck",
        hint: "The same command failing the same way three times, or a file changed back and forth, pauses the task.",
        default: true,
      },
    ],
  },
  {
    id: "subagents",
    title: "Subagents",
    intro:
      "Helpers the agent starts for focused work, such as searching, planning or reviewing. Plan → Implement → Review runs its roles either way.",
    fields: [
      {
        kind: "bool",
        group: "subagents",
        key: "enabled",
        label: "Let the agent start subagents",
        hint: "Offers the agent its spawn_agent tool.",
        default: true,
      },
      {
        kind: "int",
        group: "subagents",
        key: "max_parallel",
        label: "Running at once",
        hint: "Subagents of one task that run at the same time.",
        min: 1,
        max: 8,
        default: 4,
      },
      {
        kind: "int",
        group: "subagents",
        key: "max_depth",
        label: "Nesting depth",
        hint: "1 lets subagents run but not start their own; 0 turns them off.",
        min: 0,
        max: 3,
        default: 1,
      },
      {
        kind: "int",
        group: "subagents",
        key: "max_turns",
        label: "Steps per subagent",
        hint: "For a subagent whose definition sets none. Never more than Steps per task.",
        min: 1,
        max: 200,
        default: 24,
      },
      {
        kind: "int",
        group: "subagents",
        key: "max_per_task",
        label: "Subagents per task",
        hint: "Subagents one task may start in total.",
        min: 1,
        max: 64,
        default: 16,
      },
    ],
  },
  {
    id: "checkpoints",
    title: "Checkpoints",
    intro:
      "Snapshots of the project that let Rewind undo what commands and subscriptions changed.",
    fields: [
      {
        kind: "bool",
        group: "checkpoints",
        key: "shell",
        label: "Before shell commands",
        hint: "Before each command the agent runs that can change files.",
        default: true,
      },
      {
        kind: "bool",
        group: "checkpoints",
        key: "vendor",
        label: "Before subscription turns",
        hint: "Before each turn of Codex, Claude Code and the other subscriptions.",
        default: true,
      },
      {
        kind: "int",
        group: "checkpoints",
        key: "keep",
        label: "Checkpoints kept per repository",
        hint: "Hidden Git checkpoints kept under refs/shadowcode/checkpoints.",
        min: 1,
        max: 10_000,
        default: 200,
      },
      {
        kind: "int",
        group: "checkpoints",
        key: "max_copy_files",
        label: "Files copied in a folder without Git",
        hint: "Without Git the folder is copied; a folder with more files is not covered.",
        min: 0,
        max: 200_000,
        unit: "files",
        default: 5000,
      },
      {
        kind: "int",
        group: "checkpoints",
        key: "max_copy_bytes",
        label: "Bytes copied in a folder without Git",
        hint: "A folder without Git that is larger is not covered.",
        min: 0,
        max: 1024 * 1024 * 1024,
        unit: "bytes",
        range: "0–1,073,741,824 bytes (1 GiB)",
        default: 64 * 1024 * 1024,
        defaultLabel: "67,108,864 (64 MiB)",
      },
    ],
  },
];

export const AGENT_FIELDS: AgentField[] = AGENT_SECTIONS.flatMap(
  (s) => s.fields,
);
export const fieldId = (f: { group: string; key: string }) =>
  `${f.group}.${f.key}`;

/** `verification.commands` (verification.rs `CheckConfig::validate`). */
export const MAX_CHECKS = 64;
export const MAX_CHECK_BYTES = 64_000;

/** "1–1,000 seconds · default 60" */
export function rangeText(field: AgentField): string {
  if (field.kind === "bool")
    return field.default ? "On by default." : "Off by default.";
  if (field.kind === "choice") {
    const label = field.options
      .find((o) => o.value === field.default)
      ?.label.split(" · ")[0];
    return `Default: ${label}.`;
  }
  const range =
    field.range ??
    `${formatNumber(field.min)}–${formatNumber(field.max)}${field.unit ? ` ${field.unit}` : ""}`;
  return `${range} · default ${field.defaultLabel ?? formatNumber(field.default)}.`;
}

export type Draft = Record<string, string | boolean>;

const groupOf = (cfg: Record<string, unknown>, group: string) => {
  const value = cfg[group];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

/** The value the engine uses now: the saved one, else the default (a group
 * missing from the configuration, such as `subagents`, uses defaults). */
function current(cfg: Record<string, unknown>, field: AgentField) {
  const value = groupOf(cfg, field.group)[field.key];
  return value === undefined || value === null ? field.default : value;
}

export function draftFrom(cfg: Record<string, unknown>): Draft {
  const draft: Draft = {};
  for (const field of AGENT_FIELDS) {
    const value = current(cfg, field);
    draft[fieldId(field)] =
      field.kind === "bool" ? value === true : String(value);
  }
  return draft;
}

export function defaultDraft(): Draft {
  const draft: Draft = {};
  for (const field of AGENT_FIELDS)
    draft[fieldId(field)] =
      field.kind === "bool" ? field.default : String(field.default);
  return draft;
}

export function checksFrom(cfg: Record<string, unknown>): string[] {
  const commands = groupOf(cfg, "verification").commands;
  return Array.isArray(commands) ? commands.map(String) : [];
}

/** Blank rows are dropped; the engine compares trimmed commands. */
export const normalizeChecks = (rows: string[]) =>
  rows.map((row) => row.trim()).filter(Boolean);

/** The error for one field's draft, or "" when the engine would accept it. */
export function fieldError(field: AgentField, raw: string | boolean): string {
  if (field.kind === "bool") return "";
  if (field.kind === "choice")
    return field.options.some((o) => o.value === raw)
      ? ""
      : `Choose one of ${field.options.map((o) => PROFILE_LABELS[o.value] ?? o.value).join(", ")}.`;
  const text = String(raw).trim();
  const value = Number(text);
  const whole = field.kind === "int";
  const span =
    field.max === Number.MAX_SAFE_INTEGER
      ? `of at least ${formatNumber(field.min)}`
      : `from ${formatNumber(field.min)} to ${formatNumber(field.max)}`;
  const expected = `Enter a ${whole ? "whole number" : "number"} ${span}${field.unit ? ` ${field.unit}` : ""}.`;
  if (!text || !Number.isFinite(value)) return expected;
  if (whole && !Number.isInteger(value)) return expected;
  if (value < field.min || value > field.max) return expected;
  return "";
}

/** Errors for the check commands, by row, plus one for the list. */
export function checkErrors(rows: string[]): {
  rows: string[];
  list: string;
} {
  const encoder = new TextEncoder();
  return {
    rows: rows.map((row) =>
      row.includes("\0")
        ? "A command cannot contain a NUL character."
        : encoder.encode(row).length > MAX_CHECK_BYTES
          ? `A command can be at most ${formatNumber(MAX_CHECK_BYTES)} bytes.`
          : "",
    ),
    list:
      normalizeChecks(rows).length > MAX_CHECKS
        ? `Keep at most ${MAX_CHECKS} checks.`
        : "",
  };
}

export function parsed(field: AgentField, raw: string | boolean) {
  if (field.kind === "bool") return raw === true;
  if (field.kind === "choice") return String(raw);
  return Number(String(raw).trim());
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Only the keys that differ from what is in use now. The engine deep-merges
 * a partial save into the profile, and GET /api/config includes a trusted
 * project's own `agent` values, so unchanged keys are never written back:
 * they would copy that project's choices into every project. */
export function agentPatch(
  cfg: Record<string, unknown>,
  draft: Draft,
  checks: string[],
): Record<string, Record<string, unknown>> {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const field of AGENT_FIELDS) {
    const next = parsed(field, draft[fieldId(field)]);
    const before = current(cfg, field);
    if (next === before) continue;
    (patch[field.group] ??= {})[field.key] = next;
  }
  const commands = normalizeChecks(checks);
  if (!sameList(commands, normalizeChecks(checksFrom(cfg))))
    patch.verification = { commands };
  return patch;
}

/** The field a refused save names (`agent.max_steps must be …`). */
export function fieldNamedIn(message: string): string | null {
  for (const field of AGENT_FIELDS)
    if (new RegExp(`\\b${fieldId(field).replace(".", "\\.")}\\b`).test(message))
      return fieldId(field);
  return /\bverification\.commands\b/.test(message)
    ? "verification.commands"
    : null;
}

/** The token cap a named profile puts on a larger budget, if any. */
export function profileCapNote(draft: Draft): string {
  const profile = String(draft["agent.autonomy_profile"]);
  const cap = PROFILE_TOKEN_CAPS[profile];
  const budget = Number(String(draft["agent.max_task_tokens"]).trim());
  if (!cap || !Number.isFinite(budget) || budget <= cap) return "";
  const enough = Object.keys(PROFILE_LABELS).filter(
    (p) => !(p in PROFILE_TOKEN_CAPS) || PROFILE_TOKEN_CAPS[p] >= budget,
  );
  const names = enough.map((p) => PROFILE_LABELS[p]);
  const choices = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `With the ${PROFILE_LABELS[profile]} profile a task still stops at ${formatNumber(cap)} tokens. Choose ${choices} to use more.`;
}
