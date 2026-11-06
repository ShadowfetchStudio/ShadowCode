import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  api,
  type AgentInstall,
  type LoginProgress,
  type OpenRouterStatus,
  type VendorStatus,
} from "../api";
import { preferKeyring } from "../lib/keyring";
import { listen } from "../lib/transport";
import { LoginLine } from "./settings/AccountsPage";

export const PROVIDERS = [
  {
    id: "codex",
    label: "Codex",
    detail: "ChatGPT / Codex CLI",
  },
  {
    id: "claude",
    label: "Claude Code",
    detail: "Anthropic subscription",
  },
  {
    id: "cursor",
    label: "Cursor",
    detail: "Cursor agent CLI",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    detail: "Google agent",
  },
  {
    id: "grok",
    label: "Grok",
    detail: "xAI Grok CLI",
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

type Login = {
  vendor: string;
  attempt: number;
  state:
    | "running"
    | "stopping"
    | "done"
    | "unconfirmed"
    | "failed"
    | "unsupported";
  lines: string[];
  detail?: string;
};

const vendorId = (key: string) => key.replace(/^cli[-:]/, "");

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One-click sign-in for Codex, Claude, Cursor, Antigravity, Grok, plus an
 * OpenRouter API key field. Used on first run and the empty conversation so
 * Settings is not required to start. */
export function ProviderConnect({
  onReady,
  onOpenSettings,
}: {
  /** A vendor signed in or a key was saved: reload the picker. */
  onReady?: () => void;
  onOpenSettings?: () => void;
}) {
  const [vendors, setVendors] = useState<Record<string, VendorStatus> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [logins, setLogins] = useState<Record<string, Login>>({});
  const loginSequence = useRef<Record<string, number>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const result = await api.accountsCached();
      if (!mounted.current) return;
      const next: Record<string, VendorStatus> = {};
      for (const [key, value] of Object.entries(result.vendors || {}))
        next[vendorId(key)] = value;
      setVendors(next);
      setError("");
    } catch (e) {
      if (mounted.current) setError(message(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const runningKey = JSON.stringify(
    Object.values(logins)
      .filter(
        (login) => login.state === "running" || login.state === "stopping",
      )
      .map(({ vendor, attempt }) => ({ vendor, attempt })),
  );
  useEffect(() => {
    const running = JSON.parse(runningKey) as {
      vendor: string;
      attempt: number;
    }[];
    if (!running.length) return;
    let live = true;
    async function read(vendor: string, attempt: number) {
      if (!live) return;
      try {
        const progress: LoginProgress = await api.loginProgress(vendor);
        if (!live || (loginSequence.current[vendor] || 0) !== attempt) return;
        setLogins((current) => {
          const login = current[vendor];
          if (!login || login.attempt !== attempt) return current;
          return {
            ...current,
            [vendor]: {
              ...login,
              lines: progress.lines?.length ? progress.lines : login.lines,
              state: progress.done
                ? progress.done.ok
                  ? progress.done.availability === "ready"
                    ? "done"
                    : "unconfirmed"
                  : "failed"
                : progress.cancellation_requested
                  ? "stopping"
                  : login.state,
              detail: progress.done?.detail || login.detail,
            },
          };
        });
        if (progress.done) {
          void load();
          if (progress.done.ok && progress.done.availability === "ready")
            onReady?.();
        }
      } catch {
        // Keep known instructions and try again.
      }
    }
    const readAll = () => {
      for (const { vendor, attempt } of running) void read(vendor, attempt);
    };
    let stop: (() => void) | undefined;
    void listen("shadowcode:events", readAll)
      .then((unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      })
      .catch(() => undefined);
    const timer = setInterval(readAll, 1500);
    readAll();
    return () => {
      live = false;
      clearInterval(timer);
      stop?.();
    };
  }, [runningKey, load, onReady]);

  async function connect(vendor: string) {
    const attempt = (loginSequence.current[vendor] || 0) + 1;
    loginSequence.current[vendor] = attempt;
    setBusy((b) => ({ ...b, [vendor]: true }));
    try {
      const result = await api.connectAccount(vendor);
      if (!mounted.current || attempt !== loginSequence.current[vendor]) return;
      setLogins((current) => ({
        ...current,
        [vendor]: {
          vendor,
          attempt,
          state: result.state === "unsupported" ? "unsupported" : "running",
          lines: result.lines || [],
          detail:
            result.state === "unsupported"
              ? result.hint || result.note || "Sign in with the vendor's own app."
              : result.note,
        },
      }));
    } catch (e) {
      if (mounted.current && attempt === loginSequence.current[vendor])
        setError(message(e));
    } finally {
      if (mounted.current) setBusy((b) => ({ ...b, [vendor]: false }));
    }
  }

  async function cancelLogin(vendor: string) {
    const login = logins[vendor];
    if (!login || login.state !== "running") return;
    try {
      await api.cancelLogin(vendor);
    } catch (e) {
      setError(message(e));
    }
  }

  async function installAgent() {
    setBusy((b) => ({ ...b, antigravity: true }));
    try {
      await api.installAntigravity();
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      if (mounted.current) setBusy((b) => ({ ...b, antigravity: false }));
    }
  }

  return (
    <div className="provider-connect">
      <p className="provider-connect-lead">
        Sign in to a subscription you already pay for. ShadowCode opens the
        vendor&apos;s own page and never asks for a password.
      </p>
      {error && (
        <p className="health-bad" role="alert">
          {error}
        </p>
      )}
      <ul className="provider-grid">
        {PROVIDERS.map((provider) => {
          const status = vendors?.[provider.id];
          const ready = status?.state === "ready";
          const install = provider.id === "antigravity" ? status?.install : null;
          const needsInstall = Boolean(install && !install.installed);
          const setup =
            status?.availability === "setup_required" ||
            status?.state === "not_installed";
          const login = logins[provider.id];
          const loginActive =
            login?.state === "running" || login?.state === "stopping";
          return (
            <li key={provider.id} className="provider-tile">
              <div>
                <strong>{status?.product || provider.label}</strong>
                <small>
                  {ready
                    ? status?.account?.email || "Connected"
                    : needsInstall
                      ? "Install once, then sign in with Google"
                      : setup
                        ? status?.fix || provider.detail
                        : provider.detail}
                </small>
              </div>
              {needsInstall ? (
                <InstallButton
                  install={install!}
                  busy={Boolean(busy[provider.id])}
                  onInstall={() => void installAgent()}
                />
              ) : (
                <button
                  type="button"
                  className={ready ? "ghost" : "primary"}
                  aria-label={
                    ready
                      ? `Connected ${provider.label}`
                      : setup
                        ? `${provider.label} is not installed`
                        : `Connect ${provider.label}`
                  }
                  disabled={
                    ready ||
                    Boolean(busy[provider.id]) ||
                    loginActive ||
                    (setup && provider.id !== "antigravity")
                  }
                  onClick={() => void connect(provider.id)}
                >
                  {ready
                    ? "Connected"
                    : login?.state === "stopping"
                      ? "Stopping…"
                      : loginActive
                        ? "Signing in…"
                        : setup
                          ? "Not installed"
                          : "Connect"}
                </button>
              )}
              {login && (
                <LoginStatus
                  login={login}
                  onCancel={() => void cancelLogin(provider.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <ApiKeyQuickAdd onReady={onReady} />
      {onOpenSettings && (
        <p className="hint">
          Usage, disconnect and extra API endpoints live in{" "}
          <button type="button" className="link" onClick={onOpenSettings}>
            Settings › Accounts
          </button>
          .
        </p>
      )}
    </div>
  );
}

function InstallButton({
  install,
  busy,
  onInstall,
}: {
  install: AgentInstall;
  busy: boolean;
  onInstall: () => void;
}) {
  if (install.busy) {
    return (
      <button type="button" className="primary" disabled>
        Installing…
      </button>
    );
  }
  return (
    <button
      type="button"
      className="primary"
      disabled={busy}
      aria-label={
        install.state === "error"
          ? "Try installing Antigravity again"
          : "Install Antigravity and connect"
      }
      onClick={onInstall}
    >
      {install.state === "error" ? "Try again" : "Install & connect"}
    </button>
  );
}

function LoginStatus({
  login,
  onCancel,
}: {
  login: Login;
  onCancel: () => void;
}) {
  return (
    <div className="login-panel" role="status" aria-live="polite">
      {login.state === "running" && (
        <p>Finish signing in on the page the vendor opened.</p>
      )}
      {login.state === "done" && <p className="health-ok">Signed in.</p>}
      {login.state === "failed" && (
        <p className="health-bad">{login.detail || "Sign-in did not finish."}</p>
      )}
      {login.lines.length > 0 && (
        <pre className="login-lines">
          {login.lines.map((line, i) => (
            <div key={i}>
              <LoginLine line={line} />
            </div>
          ))}
        </pre>
      )}
      {(login.state === "running" || login.state === "stopping") && (
        <button
          type="button"
          className="mini ghost"
          disabled={login.state === "stopping"}
          onClick={onCancel}
        >
          Cancel sign-in
        </button>
      )}
    </div>
  );
}

const API_KEYS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-…",
  },
  {
    id: "grok",
    label: "xAI (Grok)",
    placeholder: "xai-…",
    provider: "grok" as const,
    endpoint: "https://api.x.ai/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    placeholder: "sk-…",
    provider: "openai_compatible" as const,
    endpoint: "https://api.openai.com/v1",
  },
] as const;

type ApiKeyKind = (typeof API_KEYS)[number]["id"];

function ApiKeyQuickAdd({ onReady }: { onReady?: () => void }) {
  const uid = useId().replace(/:/g, "");
  const [kind, setKind] = useState<ApiKeyKind>("openrouter");
  const [status, setStatus] = useState<OpenRouterStatus | null>(null);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const chosen = API_KEYS.find((item) => item.id === kind)!;

  useEffect(() => {
    let live = true;
    api
      .openrouterStatus()
      .then((next) => live && setStatus(next))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "openrouter") {
        const next = await api.setOpenrouterKey(key);
        await preferKeyring("OPENROUTER_API_KEY");
        setStatus(next);
        setSaved("OpenRouter API key saved.");
      } else {
        const direct = API_KEYS.find(
          (
            item,
          ): item is Extract<(typeof API_KEYS)[number], { provider: string }> =>
            item.id === kind && "provider" in item,
        );
        if (!direct) throw new Error("Choose OpenRouter, xAI or OpenAI.");
        const listed = await api.endpointModels({
          provider: direct.provider,
          endpoint: direct.endpoint,
          api_key: key.trim(),
        });
        const models = listed.models.slice(0, 12).map((model) => model.id);
        if (!models.length)
          throw new Error("That server listed no models for this key.");
        await api.addEndpointModels({
          provider: direct.provider,
          endpoint: listed.endpoint || direct.endpoint,
          api_key: key.trim(),
          api_key_env: listed.api_key_env,
          models,
        });
        await preferKeyring(listed.api_key_env);
        setSaved(`${direct.label} key saved. Models are in the picker.`);
      }
      setKey("");
      onReady?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (kind === "openrouter" && status?.key_set && !saved) {
    return (
      <p className="health-ok">
        OpenRouter API key saved
        {status.key?.label ? ` (${status.key.label})` : ""}.
      </p>
    );
  }

  return (
    <form className="api-key-quick" onSubmit={(e) => void save(e)}>
      <label htmlFor={`${uid}-kind`}>Or paste an API key</label>
      <div className="field-row">
        <select
          id={`${uid}-kind`}
          aria-label="API key provider"
          value={kind}
          disabled={busy}
          onChange={(e) => {
            setKind(e.target.value as ApiKeyKind);
            setSaved("");
            if (error) setError("");
          }}
        >
          {API_KEYS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <input
          id={`${uid}-key`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={`${chosen.label} API key`}
          value={key}
          placeholder={chosen.placeholder}
          disabled={busy || (kind === "openrouter" && Boolean(status?.offline))}
          onChange={(e) => {
            setKey(e.target.value);
            setSaved("");
            if (error) setError("");
          }}
        />
        <button
          type="submit"
          className="primary"
          disabled={
            busy ||
            !key.trim() ||
            (kind === "openrouter" && Boolean(status?.offline))
          }
        >
          {busy ? "Saving…" : "Save key"}
        </button>
      </div>
      <p className="hint">
        Stored on this computer (macOS Keychain when available). OpenRouter
        covers Claude, GPT, Grok and others; xAI and OpenAI keys talk to those
        APIs directly.
      </p>
      {saved && (
        <p className="health-ok" role="status">
          {saved}
        </p>
      )}
      {error && (
        <p className="health-bad" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
