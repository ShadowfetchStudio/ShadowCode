import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  api,
  type EndpointModels,
  type EndpointProvider,
  type ModelTest,
} from "../../api";
import type { PickerTarget } from "../../lib/picker";
import { Dialog } from "../Dialog";

/** The servers ShadowCode talks to with the OpenAI chat API, and where each
 * usually listens (the engine's `models::preset`). */
export const ENDPOINT_PRESETS: {
  id: EndpointProvider;
  label: string;
  endpoint: string;
  /** Usually runs on this computer, so a key is optional. */
  local: boolean;
}[] = [
  {
    id: "ollama",
    label: "Ollama",
    endpoint: "http://127.0.0.1:11434/v1",
    local: true,
  },
  {
    id: "local",
    label: "LM Studio",
    endpoint: "http://127.0.0.1:1234/v1",
    local: true,
  },
  {
    id: "llamacpp",
    label: "llama.cpp server",
    endpoint: "http://127.0.0.1:8080/v1",
    local: true,
  },
  {
    id: "vllm",
    label: "vLLM",
    endpoint: "http://127.0.0.1:8000/v1",
    local: true,
  },
  {
    id: "grok",
    label: "xAI (Grok)",
    endpoint: "https://api.x.ai/v1",
    local: false,
  },
  {
    id: "openai_compatible",
    label: "OpenAI or another compatible API",
    endpoint: "https://api.openai.com/v1",
    local: false,
  },
];

export const isEndpointProvider = (key?: string): key is EndpointProvider =>
  ENDPOINT_PRESETS.some((preset) => preset.id === key);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Models shown at once before the list asks for a filter. */
const LIST_LIMIT = 12;

/** Settings › Accounts › Your own endpoints: connect an OpenAI-compatible
 * server, choose which of its models the picker lists, test and remove
 * them. A typed key is saved on this computer only when models are added. */
export function EndpointsCard({
  focus,
  offline,
  onChanged,
  onToast,
}: {
  /** Opened from a picker row that needs its key: scroll here and focus. */
  focus: boolean;
  offline: boolean;
  onChanged: () => void;
  onToast: (text: string, kind: "ok" | "err" | "info") => void;
}) {
  const uid = useId().replace(/:/g, "");
  const card = useRef<HTMLElement>(null);
  const server = useRef<HTMLSelectElement>(null);
  const [rows, setRows] = useState<PickerTarget[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<EndpointProvider>("ollama");
  const [endpoint, setEndpoint] = useState(ENDPOINT_PRESETS[0].endpoint);
  const [key, setKey] = useState("");
  const [keyName, setKeyName] = useState("");
  const [vision, setVision] = useState(false);
  const [found, setFound] = useState<EndpointModels | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [manual, setManual] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "find" | "add">("");
  const [tests, setTests] = useState<Record<string, ModelTest | "running">>({});
  const [confirm, setConfirm] = useState<PickerTarget | null>(null);
  const preset = ENDPOINT_PRESETS.find((p) => p.id === provider)!;

  async function reload() {
    try {
      const picker = await api.pickerCached();
      setRows(picker.targets.filter((target) => target.custom));
      setLoadError("");
    } catch (e) {
      setLoadError(message(e));
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!focus || !rows) return;
    card.current?.scrollIntoView?.({ block: "nearest" });
    card.current?.querySelector<HTMLElement>("[data-primary]")?.focus();
  }, [focus, rows]);

  // The "Add an endpoint…" button goes away as the form opens; focus moves
  // to the form's first control instead of being lost.
  useEffect(() => {
    if (open) server.current?.focus();
  }, [open]);

  function choose(next: EndpointProvider) {
    const nextPreset = ENDPOINT_PRESETS.find((p) => p.id === next)!;
    setProvider(next);
    // Keep an address the user typed; replace one that was a preset's.
    if (ENDPOINT_PRESETS.some((p) => p.endpoint === endpoint) || !endpoint)
      setEndpoint(nextPreset.endpoint);
    setFound(null);
    setChosen([]);
    setError("");
  }

  const request = () => ({
    provider,
    endpoint: endpoint.trim(),
    api_key: key.trim() || undefined,
    api_key_env: keyName.trim() || undefined,
  });

  async function find(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setBusy("find");
    setError("");
    setFound(null);
    try {
      const next = await api.endpointModels(request());
      setFound(next);
      setEndpoint(next.endpoint);
      const added = new Set((rows || []).map((row) => row.model));
      setChosen(
        next.models.length === 1 && !added.has(next.models[0].id)
          ? [next.models[0].id]
          : [],
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  async function add(models: string[]) {
    if (!models.length || busy) return;
    setBusy("add");
    setError("");
    try {
      const result = await api.addEndpointModels({
        ...request(),
        endpoint: found?.endpoint || endpoint.trim(),
        api_key_env: keyName.trim() || found?.api_key_env || undefined,
        models,
        vision: vision || undefined,
      });
      const count = result.models.length;
      onToast(
        `Added ${count} model${count === 1 ? "" : "s"} to the model picker.`,
        "ok",
      );
      setKey("");
      setFound(null);
      setChosen([]);
      setManual("");
      setOpen(false);
      await reload();
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy("");
    }
  }

  async function test(row: PickerTarget) {
    setTests((all) => ({ ...all, [row.id]: "running" }));
    let result: ModelTest;
    try {
      result = await api.testModel(row.id);
    } catch (e) {
      result = { ok: false, error: message(e), latency_ms: 0 };
    }
    setTests((all) => ({ ...all, [row.id]: result }));
  }

  async function remove(row: PickerTarget) {
    setConfirm(null);
    try {
      await api.removeEndpointModel(row.id);
      onToast(`Removed ${row.model || row.name} from the model picker.`, "ok");
      await reload();
      onChanged();
    } catch (e) {
      onToast(message(e), "err");
    }
  }

  const added = new Set((rows || []).map((row) => row.model));
  const listed = (found?.models || []).filter(
    (model) =>
      !filter.trim() ||
      model.id.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <article
      className="account-card endpoints-card"
      ref={card}
      aria-labelledby={`${uid}-title`}
    >
      <header>
        <h4 id={`${uid}-title`}>Your own endpoints</h4>
        <span className="cap-badge">OpenAI-compatible</span>
      </header>
      <p>
        Use Ollama, LM Studio, a llama.cpp or vLLM server, xAI, OpenAI or any
        OpenAI-compatible API. The models you add appear in the model picker and
        run with ShadowCode's own agent.
      </p>
      {loadError && <p className="health-bad">{loadError}</p>}
      {rows && rows.length > 0 && (
        <ul className="endpoint-rows" aria-label="Added models">
          {rows.map((row) => {
            const result = tests[row.id];
            return (
              <li key={row.id}>
                <span className="endpoint-row-name">
                  <strong>{row.model || row.name}</strong>
                  <small>{row.subtitle}</small>
                </span>
                <span className={`avail avail-${row.availability}`}>
                  {row.availability_label || row.availability}
                </span>
                <span className="row endpoint-row-actions">
                  <button
                    type="button"
                    className="ghost mini"
                    disabled={result === "running"}
                    aria-label={`Test ${row.model || row.name}`}
                    onClick={() => void test(row)}
                  >
                    {result === "running" ? "Testing…" : "Test"}
                  </button>
                  <button
                    type="button"
                    className="ghost mini danger-text"
                    aria-label={`Remove ${row.model || row.name}`}
                    onClick={() => setConfirm(row)}
                  >
                    Remove
                  </button>
                </span>
                {row.reason && <p className="hint">{row.reason}</p>}
                {result && result !== "running" && (
                  <p
                    className={result.ok ? "endpoint-test-ok" : "health-bad"}
                    role="status"
                  >
                    {result.ok
                      ? `Answered in ${(result.latency_ms / 1000).toFixed(1)} s`
                      : result.error || "No answer"}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows && rows.length === 0 && !open && (
        <p className="hint">No endpoints added yet.</p>
      )}
      {!open && (
        <div className="row">
          <button
            type="button"
            className="ghost"
            data-primary
            onClick={() => setOpen(true)}
          >
            Add an endpoint…
          </button>
        </div>
      )}
      {open && (
        <form
          className="endpoint-form"
          aria-labelledby={`${uid}-form-title`}
          onSubmit={(e) => void find(e)}
        >
          <h5 id={`${uid}-form-title`}>Add an endpoint</h5>
          <div className="field">
            <label htmlFor={`${uid}-provider`}>Server</label>
            <select
              id={`${uid}-provider`}
              ref={server}
              data-primary
              value={provider}
              onChange={(e) => choose(e.target.value as EndpointProvider)}
            >
              {ENDPOINT_PRESETS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${uid}-endpoint`}>Address</label>
            <input
              id={`${uid}-endpoint`}
              inputMode="url"
              spellCheck={false}
              autoComplete="off"
              value={endpoint}
              placeholder={preset.endpoint}
              onChange={(e) => {
                setEndpoint(e.target.value);
                setFound(null);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-key`}>
              API key{preset.local ? " (if the server needs one)" : ""}
            </label>
            <input
              id={`${uid}-key`}
              type="password"
              spellCheck={false}
              autoComplete="off"
              value={key}
              aria-describedby={`${uid}-key-hint`}
              onChange={(e) => setKey(e.target.value)}
            />
            <small className="hint" id={`${uid}-key-hint`}>
              {found?.key_saved && !key
                ? `A key is already saved as ${found.api_key_env}; it is used unless you type a new one.`
                : "Saved only on this computer, and only when you add models."}
            </small>
          </div>
          <details className="endpoint-advanced">
            <summary>More options</summary>
            <div className="field">
              <label htmlFor={`${uid}-key-name`}>Save the key as</label>
              <input
                id={`${uid}-key-name`}
                spellCheck={false}
                autoComplete="off"
                value={keyName}
                placeholder={found?.api_key_env || "Chosen for this address"}
                aria-describedby={`${uid}-key-name-hint`}
                onChange={(e) => setKeyName(e.target.value)}
              />
              <small className="hint" id={`${uid}-key-name-hint`}>
                Letters, digits and _. Two services with different keys need
                different names.
              </small>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={vision}
                onChange={(e) => setVision(e.target.checked)}
              />
              These models can read images
            </label>
          </details>
          {offline && !preset.local && (
            <p className="warn-text">
              Offline mode: only servers on this computer can be reached.
            </p>
          )}
          {error && (
            <p className="health-bad" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button
              type="submit"
              className="primary"
              disabled={Boolean(busy) || !endpoint.trim()}
            >
              {busy === "find" ? "Connecting…" : "Find models"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setOpen(false);
                setFound(null);
                setError("");
              }}
            >
              Cancel
            </button>
          </div>
          {found && (
            <fieldset className="endpoint-models">
              <legend>
                {found.models.length
                  ? `${found.label} lists ${found.models.length} model${found.models.length === 1 ? "" : "s"}`
                  : `${found.label} lists no models`}
              </legend>
              {found.models.length > LIST_LIMIT && (
                <div className="field">
                  <label htmlFor={`${uid}-filter`}>Filter models</label>
                  <input
                    id={`${uid}-filter`}
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
              )}
              {listed
                .slice(0, filter.trim() ? 200 : LIST_LIMIT)
                .map((model) => (
                  <label className="check" key={model.id}>
                    <input
                      type="checkbox"
                      checked={chosen.includes(model.id) || added.has(model.id)}
                      disabled={added.has(model.id)}
                      onChange={(e) =>
                        setChosen((all) =>
                          e.target.checked
                            ? [...all, model.id]
                            : all.filter((id) => id !== model.id),
                        )
                      }
                    />
                    {model.id}
                    {model.detail && (
                      <span className="dim"> · {model.detail}</span>
                    )}
                    {added.has(model.id) && (
                      <span className="dim"> · added</span>
                    )}
                  </label>
                ))}
              {!filter.trim() && listed.length > LIST_LIMIT && (
                <p className="hint">
                  {listed.length - LIST_LIMIT} more · filter to find them
                </p>
              )}
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={!chosen.length || Boolean(busy)}
                  onClick={() => void add(chosen)}
                >
                  {busy === "add"
                    ? "Adding…"
                    : chosen.length
                      ? `Add ${chosen.length} to the picker`
                      : "Add to the picker"}
                </button>
              </div>
            </fieldset>
          )}
          {(error || (found && !found.models.length)) && (
            <div className="field endpoint-manual">
              <label htmlFor={`${uid}-manual`}>
                Or add a model by its exact name
              </label>
              <div className="row">
                <input
                  id={`${uid}-manual`}
                  spellCheck={false}
                  autoComplete="off"
                  value={manual}
                  placeholder="gpt-5.1, qwen3-coder:30b…"
                  onChange={(e) => setManual(e.target.value)}
                />
                <button
                  type="button"
                  className="ghost"
                  disabled={!manual.trim() || Boolean(busy)}
                  onClick={() => void add([manual.trim()])}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </form>
      )}
      {confirm && (
        <Dialog
          label={`Remove ${confirm.model || confirm.name}`}
          className="modal modal-sm"
          onClose={() => setConfirm(null)}
        >
          <h2>Remove {confirm.model || confirm.name}?</h2>
          <p>
            It disappears from the model picker. Conversations that used it need
            another model. A saved API key stays on this computer.
          </p>
          <div className="row end">
            <button
              type="button"
              className="ghost"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary danger"
              onClick={() => void remove(confirm)}
            >
              Remove
            </button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
