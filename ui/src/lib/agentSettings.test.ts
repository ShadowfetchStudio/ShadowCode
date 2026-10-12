import { describe, expect, it } from "vitest";
import {
  AGENT_FIELDS,
  agentPatch,
  checkErrors,
  defaultDraft,
  draftFrom,
  fieldError,
  fieldId,
  fieldNamedIn,
  profileCapNote,
  rangeText,
  type AgentField,
  type NumberField,
} from "./agentSettings";

const field = (id: string) =>
  AGENT_FIELDS.find((f) => fieldId(f) === id) as AgentField;

describe("Settings › Agent fields mirror the engine", () => {
  it("has the engine's defaults (config.rs, subagents.rs, checkpoint.rs)", () => {
    expect(defaultDraft()).toEqual({
      "agent.max_steps": "64",
      "agent.max_task_tokens": "1000000",
      "agent.autonomy_profile": "normal",
      "agent.tool_timeout_sec": "60",
      "agent.max_output_bytes": "256000",
      "agent.parallel_reads": true,
      "agent.compact_ratio": "0.7",
      "agent.summary_compaction": true,
      "agent.summary_timeout_sec": "60",
      "agent.model_retries": "3",
      "agent.retry_backoff_sec": "1",
      "agent.max_fix_retries": "3",
      "agent.stuck_check": true,
      "subagents.enabled": true,
      "subagents.max_parallel": "4",
      "subagents.max_depth": "1",
      "subagents.max_turns": "24",
      "subagents.max_per_task": "16",
      "checkpoints.shell": true,
      "checkpoints.vendor": true,
      "checkpoints.keep": "200",
      "checkpoints.max_copy_files": "5000",
      "checkpoints.max_copy_bytes": "67108864",
    });
  });

  it("has the engine's ranges and number types", () => {
    const ranges = Object.fromEntries(
      AGENT_FIELDS.filter(
        (f): f is NumberField => f.kind === "int" || f.kind === "float",
      ).map((f) => [fieldId(f), [f.kind, f.min, f.max]]),
    );
    expect(ranges).toEqual({
      "agent.max_steps": ["int", 1, 1000],
      "agent.max_task_tokens": ["int", 1, Number.MAX_SAFE_INTEGER],
      "agent.tool_timeout_sec": ["int", 1, 3600],
      "agent.max_output_bytes": ["int", 4096, 4_000_000],
      "agent.compact_ratio": ["float", 0.2, 0.95],
      "agent.summary_timeout_sec": ["int", 5, 600],
      "agent.model_retries": ["int", 0, 10],
      "agent.retry_backoff_sec": ["float", 0, 30],
      "agent.max_fix_retries": ["int", 0, 10],
      "subagents.max_parallel": ["int", 1, 8],
      "subagents.max_depth": ["int", 0, 3],
      "subagents.max_turns": ["int", 1, 200],
      "subagents.max_per_task": ["int", 1, 64],
      "checkpoints.keep": ["int", 1, 10_000],
      "checkpoints.max_copy_files": ["int", 0, 200_000],
      "checkpoints.max_copy_bytes": ["int", 0, 1_073_741_824],
    });
    const profile = field("agent.autonomy_profile");
    expect(
      profile.kind === "choice" && profile.options.map((o) => o.value),
    ).toEqual(["normal", "conservative", "extended", "unlimited", "custom"]);
  });

  it("accepts each range's ends and refuses just outside them", () => {
    for (const f of AGENT_FIELDS) {
      if (f.kind !== "int" && f.kind !== "float") continue;
      const step = f.kind === "int" ? 1 : 0.01;
      expect(fieldError(f, String(f.min)), fieldId(f)).toBe("");
      expect(fieldError(f, String(f.max)), fieldId(f)).toBe("");
      expect(fieldError(f, String(f.default)), fieldId(f)).toBe("");
      expect(fieldError(f, String(f.min - step)), fieldId(f)).not.toBe("");
      if (f.max < Number.MAX_SAFE_INTEGER)
        expect(fieldError(f, String(f.max + step)), fieldId(f)).not.toBe("");
      expect(fieldError(f, ""), fieldId(f)).not.toBe("");
    }
    expect(fieldError(field("agent.max_steps"), "1.5")).toBe(
      "Enter a whole number from 1 to 1,000.",
    );
    expect(fieldError(field("agent.tool_timeout_sec"), "0")).toBe(
      "Enter a whole number from 1 to 3,600 seconds.",
    );
    expect(fieldError(field("agent.compact_ratio"), "0.96")).toBe(
      "Enter a number from 0.2 to 0.95.",
    );
    expect(fieldError(field("agent.compact_ratio"), "0.725")).toBe("");
    expect(fieldError(field("agent.max_task_tokens"), "0")).toBe(
      "Enter a whole number of at least 1.",
    );
    expect(fieldError(field("agent.autonomy_profile"), "wild")).toMatch(
      /^Choose one of Normal, Conservative/,
    );
  });

  it("shows each range and default in words", () => {
    expect(rangeText(field("agent.max_steps"))).toBe("1–1,000 · default 64.");
    expect(rangeText(field("agent.tool_timeout_sec"))).toBe(
      "1–3,600 seconds · default 60.",
    );
    expect(rangeText(field("agent.max_task_tokens"))).toBe(
      "At least 1 · default 1,000,000.",
    );
    expect(rangeText(field("checkpoints.max_copy_bytes"))).toBe(
      "0–1,073,741,824 bytes (1 GiB) · default 67,108,864 (64 MiB).",
    );
    expect(rangeText(field("agent.stuck_check"))).toBe("On by default.");
    expect(rangeText(field("agent.autonomy_profile"))).toBe("Default: Normal.");
  });
});

describe("saving", () => {
  const cfg = {
    agent: { max_steps: 64, compact_ratio: 0.7, stuck_check: true },
    checkpoints: { keep: 200 },
    verification: { commands: ["cargo test"] },
  };

  it("sends nothing when nothing changed, and only changed keys otherwise", () => {
    expect(agentPatch(cfg, draftFrom(cfg), ["cargo test"])).toEqual({});
    const draft = {
      ...draftFrom(cfg),
      "agent.max_steps": "120",
      "agent.compact_ratio": "0.80",
      "agent.stuck_check": false,
      "subagents.max_parallel": "6",
    };
    expect(agentPatch(cfg, draft, ["cargo test", "  npm test ", ""])).toEqual({
      agent: { max_steps: 120, compact_ratio: 0.8, stuck_check: false },
      subagents: { max_parallel: 6 },
      verification: { commands: ["cargo test", "npm test"] },
    });
  });

  it("uses the defaults for a group the configuration leaves out", () => {
    const draft = draftFrom({});
    expect(draft["subagents.max_depth"]).toBe("1");
    expect(draft["checkpoints.shell"]).toBe(true);
    expect(agentPatch({}, draft, [])).toEqual({});
  });

  it("finds the setting a refused save names", () => {
    expect(
      fieldNamedIn("agent.max_steps must be between 1 and 1000; found 0"),
    ).toBe("agent.max_steps");
    expect(fieldNamedIn("checkpoints.keep must be between 1 and 10000")).toBe(
      "checkpoints.keep",
    );
    expect(
      fieldNamedIn("`subagents.max_turns` has a value ShadowCode can't read"),
    ).toBe("subagents.max_turns");
    expect(
      fieldNamedIn("verification.commands holds at most 64 commands"),
    ).toBe("verification.commands");
    expect(fieldNamedIn("Configuration exceeds 1 MB")).toBeNull();
  });

  it("explains when a profile caps a larger token budget", () => {
    const draft = defaultDraft();
    expect(profileCapNote(draft)).toBe("");
    expect(
      profileCapNote({ ...draft, "agent.max_task_tokens": "2000000" }),
    ).toBe(
      "With the Normal profile a task still stops at 1,000,000 tokens. Choose Extended, Unlimited or Custom to use more.",
    );
    expect(
      profileCapNote({
        ...draft,
        "agent.autonomy_profile": "extended",
        "agent.max_task_tokens": "5000000",
      }),
    ).toBe(
      "With the Extended profile a task still stops at 4,000,000 tokens. Choose Unlimited or Custom to use more.",
    );
    expect(
      profileCapNote({
        ...draft,
        "agent.autonomy_profile": "custom",
        "agent.max_task_tokens": "5000000",
      }),
    ).toBe("");
  });

  it("checks commands the way the engine does", () => {
    expect(checkErrors(["cargo test", ""])).toEqual({
      rows: ["", ""],
      list: "",
    });
    // 64,000 bytes, not characters: "é" is two bytes.
    expect(checkErrors(["é".repeat(32_000)]).rows[0]).toBe("");
    expect(checkErrors(["é".repeat(32_001)]).rows[0]).toBe(
      "A command can be at most 64,000 bytes.",
    );
    expect(checkErrors(["echo a\0b"]).rows[0]).toBe(
      "A command cannot contain a NUL character.",
    );
    expect(
      checkErrors(Array.from({ length: 65 }, (_, i) => `check ${i}`)).list,
    ).toBe("Keep at most 64 checks.");
  });
});
