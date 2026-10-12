import { useId, useState } from "react";
import { readableError } from "../../lib/transport";
import {
  AGENT_FIELDS,
  AGENT_SECTIONS,
  MAX_CHECKS,
  agentPatch,
  checkErrors,
  checksFrom,
  defaultDraft,
  draftFrom,
  fieldError,
  fieldId,
  fieldNamedIn,
  formatNumber,
  parsed,
  profileCapNote,
  profileView,
  projectNote,
  rangeText,
  type AgentField,
  type Draft,
} from "../../lib/agentSettings";
import type { SaveOptions } from "../Settings";
import "./AgentPage.css";

type Save = (
  values: Record<string, unknown>,
  options?: SaveOptions,
) => Promise<void>;

const CHECKS_ID = "verification.commands";

/** Settings › Agent: how ShadowCode's own agent works (limits, long
 * conversations, recovery), its subagents, project checkpoints and the
 * commands that count as checks. Saves only the keys changed in the agent,
 * subagents, checkpoints and verification groups. */
export function AgentPage({
  cfg,
  onSave,
}: {
  cfg: Record<string, unknown>;
  onSave: Save;
}) {
  const uid = useId().replace(/:/g, "");
  // Show and save the profile's values; a project's own ones are noted.
  const saved = profileView(cfg);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved));
  const [checks, setChecks] = useState<string[]>(() => checksFrom(saved));
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState("");
  const [refusedField, setRefusedField] = useState<string | null>(null);

  const domId = (id: string) => `${uid}-${id.replace(".", "-")}`;
  const saveErrorId = `${uid}-save-error`;
  const errors = Object.fromEntries(
    AGENT_FIELDS.map((f) => [fieldId(f), fieldError(f, draft[fieldId(f)])]),
  );
  const checkProblems = checkErrors(checks);
  const problems =
    Object.values(errors).filter(Boolean).length +
    checkProblems.rows.filter(Boolean).length +
    (checkProblems.list ? 1 : 0);
  const patch = agentPatch(saved, draft, checks);
  const changed = Object.keys(patch).length > 0;
  const defaults = defaultDraft();
  const atDefaults =
    AGENT_FIELDS.every(
      (f) => parsed(f, draft[fieldId(f)]) === parsed(f, defaults[fieldId(f)]),
    ) && checks.every((row) => !row.trim());

  const edited = () => {
    setRefused("");
    setRefusedField(null);
  };
  const set = (id: string, value: string | boolean) => {
    setDraft((d) => ({ ...d, [id]: value }));
    edited();
  };
  const reset = (field: AgentField) => {
    const id = fieldId(field);
    set(id, defaults[id]);
    document.getElementById(domId(id))?.focus();
  };
  const setCheck = (index: number, value: string) => {
    setChecks((rows) => rows.map((row, i) => (i === index ? value : row)));
    edited();
  };
  const removeCheck = (index: number) => {
    setChecks((rows) => rows.filter((_, i) => i !== index));
    edited();
    // Keep focus in the list: the next row, the previous one, or Add.
    window.setTimeout(() => {
      const rows = document.querySelectorAll<HTMLInputElement>(
        `[data-check-row="${uid}"]`,
      );
      (
        rows[Math.min(index, rows.length - 1)] ??
        document.getElementById(`${uid}-add-check`)
      )?.focus();
    });
  };
  const addCheck = () => {
    setChecks((rows) => [...rows, ""]);
    edited();
    window.setTimeout(() => {
      const rows = document.querySelectorAll<HTMLInputElement>(
        `[data-check-row="${uid}"]`,
      );
      rows[rows.length - 1]?.focus();
    });
  };

  async function save() {
    setSaving(true);
    setRefused("");
    setRefusedField(null);
    try {
      await onSave(patch, { rethrow: true });
    } catch (e) {
      const text = readableError(e) || "ShadowCode could not save these.";
      setRefused(text);
      setRefusedField(fieldNamedIn(text));
    } finally {
      setSaving(false);
    }
  }

  const capNote = profileCapNote(draft);
  return (
    <section className="settings-page agent-page">
      <h3>Agent</h3>
      <p className="hint">
        How ShadowCode&apos;s own agent works with models on this computer, API
        and OpenRouter models. Subscriptions such as Codex and Claude Code run
        their own agent and use only the checkpoint settings here.
      </p>
      <p className="hint">
        These apply to every project. A trusted project can change Limits, Long
        conversations and Recovery for itself in{" "}
        <code>.shadow/config/config.yaml</code>.
      </p>
      {AGENT_SECTIONS.map((section) => (
        <fieldset className="agent-group" key={section.id}>
          <legend>{section.title}</legend>
          {section.intro && <p className="hint">{section.intro}</p>}
          {section.fields.map((field) => {
            const id = fieldId(field);
            const note = [
              id === "agent.max_task_tokens" ? capNote : "",
              projectNote(cfg, field),
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <FieldRow
                key={id}
                field={field}
                inputId={domId(id)}
                value={draft[id]}
                error={errors[id]}
                note={note}
                refusedBy={refusedField === id ? saveErrorId : ""}
                atDefault={
                  parsed(field, draft[id]) === parsed(field, defaults[id])
                }
                onChange={(value) => set(id, value)}
                onReset={() => reset(field)}
              />
            );
          })}
        </fieldset>
      ))}
      <fieldset className="agent-group" aria-describedby={`${uid}-checks-hint`}>
        <legend>Checks</legend>
        <p className="hint" id={`${uid}-checks-hint`}>
          Commands that count as checks of a task&apos;s work when they run
          exactly as written in the project folder, such as{" "}
          <code>cargo test --offline</code>. They ask for approval like any
          command, and ShadowCode never runs them on its own. Commands found in
          the project&apos;s manifests, such as <code>npm test</code>, already
          count. Up to {MAX_CHECKS} · none by default.
        </p>
        {checks.length > 0 && (
          <ol className="agent-checks">
            {checks.map((row, index) => {
              const rowError = checkProblems.rows[index];
              const errorId = `${uid}-check-${index}-error`;
              const describedBy = [
                rowError ? errorId : "",
                refusedField === CHECKS_ID ? saveErrorId : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <li key={index}>
                  <div className="agent-input-row">
                    <input
                      type="text"
                      data-check-row={uid}
                      aria-label={`Check ${index + 1}`}
                      spellCheck={false}
                      autoComplete="off"
                      value={row}
                      placeholder="cargo test --offline"
                      aria-invalid={
                        rowError || refusedField === CHECKS_ID
                          ? true
                          : undefined
                      }
                      aria-describedby={describedBy || undefined}
                      onChange={(e) => setCheck(index, e.target.value)}
                    />
                    <button
                      type="button"
                      className="mini ghost"
                      aria-label={`Remove check ${index + 1}`}
                      onClick={() => removeCheck(index)}
                    >
                      Remove
                    </button>
                  </div>
                  {rowError && (
                    <p className="health-bad agent-error" id={errorId}>
                      {rowError}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {checkProblems.list && (
          <p className="health-bad agent-error" role="alert">
            {checkProblems.list}
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="ghost"
            id={`${uid}-add-check`}
            disabled={checks.length >= MAX_CHECKS}
            onClick={addCheck}
          >
            Add a check
          </button>
        </div>
      </fieldset>
      {refused && (
        <p className="health-bad" id={saveErrorId} role="alert">
          {refused}
        </p>
      )}
      <div className="row end settings-foot">
        {problems > 0 && (
          <p className="hint agent-foot-note" role="status">
            {problems === 1
              ? "Fix the setting marked above to save."
              : `Fix the ${formatNumber(problems)} settings marked above to save.`}
          </p>
        )}
        <button
          type="button"
          className="ghost"
          disabled={saving || atDefaults}
          onClick={() => {
            setDraft(defaultDraft());
            setChecks([]);
            edited();
            // This button is now disabled: keep focus nearby, on Save.
            window.setTimeout(() => {
              const next = document.getElementById(`${uid}-save`);
              if (next && !(next as HTMLButtonElement).disabled) next.focus();
            });
          }}
        >
          Reset all to defaults
        </button>
        <button
          type="button"
          id={`${uid}-save`}
          className="primary"
          disabled={saving || problems > 0 || !changed}
          aria-describedby={refused ? saveErrorId : undefined}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

/** One setting: its control, what it does, its range and default, a Reset
 * when it differs from the default, and its error. */
function FieldRow({
  field,
  inputId,
  value,
  error,
  note,
  refusedBy,
  atDefault,
  onChange,
  onReset,
}: {
  field: AgentField;
  inputId: string;
  value: string | boolean;
  error: string;
  note: string;
  /** The id of a refused save's message that names this setting. */
  refusedBy: string;
  atDefault: boolean;
  onChange: (value: string | boolean) => void;
  onReset: () => void;
}) {
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const noteId = `${inputId}-note`;
  const describedBy = [
    hintId,
    error ? errorId : "",
    note ? noteId : "",
    refusedBy,
  ]
    .filter(Boolean)
    .join(" ");
  const invalid = error || refusedBy ? true : undefined;
  const resetButton = !atDefault && (
    <button
      type="button"
      className="mini ghost agent-reset"
      aria-label={`Reset ${field.label} to its default`}
      onClick={onReset}
    >
      Reset
    </button>
  );
  const hint = (
    <p className="hint" id={hintId}>
      {field.hint} {rangeText(field)}
    </p>
  );
  if (field.kind === "bool")
    return (
      <div className="agent-field">
        <div className="agent-input-row">
          <label className="check">
            <input
              type="checkbox"
              id={inputId}
              checked={value === true}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => onChange(e.target.checked)}
            />{" "}
            {field.label}
          </label>
          {resetButton}
        </div>
        {hint}
        {note && (
          <p className="warn-text agent-error" id={noteId}>
            {note}
          </p>
        )}
      </div>
    );
  return (
    <div className="field agent-field">
      <label htmlFor={inputId}>{field.label}</label>
      <div className="agent-input-row">
        {field.kind === "choice" ? (
          <select
            id={inputId}
            value={String(value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          >
            {!field.options.some((o) => o.value === value) && (
              <option value={String(value)}>{String(value)}</option>
            )}
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            type="number"
            inputMode={field.kind === "int" ? "numeric" : "decimal"}
            min={field.min}
            max={field.max === Number.MAX_SAFE_INTEGER ? undefined : field.max}
            step={field.step ?? 1}
            value={String(value)}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {field.kind !== "choice" && field.unit && (
          <span className="agent-unit" aria-hidden="true">
            {field.unit}
          </span>
        )}
        {resetButton}
      </div>
      {hint}
      {error && (
        <p className="health-bad agent-error" id={errorId}>
          {error}
        </p>
      )}
      {note && (
        <p className="warn-text agent-error" id={noteId}>
          {note}
        </p>
      )}
    </div>
  );
}
