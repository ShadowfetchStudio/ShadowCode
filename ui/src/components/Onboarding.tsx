import { useEffect, useState } from "react";
import { api, type PickerResponse } from "../api";
import { Dialog } from "./Dialog";
import { isReady } from "../lib/picker";
import { canPickFiles, pickDirectory } from "../lib/transport";

/** Where the window goes after the first run: straight to work, to
 * Settings › Accounts for an OpenRouter key or a subscription, or to
 * Settings › Local models for the other free models. */
export type OnboardingNext =
  "openrouter" | "subscription" | "local" | undefined;

/** How long the first run waits for the account check before deciding that
 * no model is ready (the local rows and cached accounts answer at once). */
export const READY_CHECK_MS = 6000;

/** Whether any model can run a task right now (a signed-in subscription, an
 * OpenRouter key, or a local model that fits). */
export async function anyModelReady(timeoutMs = READY_CHECK_MS) {
  const ready = (r: PickerResponse) => (r.targets || []).some(isReady);
  const full = api.picker().then(ready);
  const cached = api
    .pickerCached()
    .then(ready)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) =>
    setTimeout(() => void cached.then(resolve), timeoutMs),
  );
  // Ready as soon as either answer says so; otherwise the full answer, or
  // the cached one if the full check takes too long or fails.
  return Promise.race([
    cached.then((yes) => (yes ? true : new Promise<boolean>(() => undefined))),
    full.catch(() => cached),
    timeout,
  ]);
}

/** First run: choose the project folder and start. Permission mode defaults
 * to ask-first (change it in the composer). If no model is ready yet, the
 * empty conversation offers sign-in, an API key, or a free local model. */
export function Onboarding({
  onDone,
}: {
  onDone: (next?: OnboardingNext) => void;
}) {
  const [workspace, setWorkspace] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string }>({
    busy: false,
    error: "",
  });

  useEffect(() => {
    api
      .onboarding()
      .then((data) => setWorkspace((w) => w || data.suggested_workspace || ""))
      .catch(() => undefined);
  }, []);

  async function start() {
    setState({ busy: true, error: "" });
    try {
      await api.completeOnboarding({
        workspace: workspace.trim(),
        permission_level: "workspace",
        permission_mode: "ask",
        theme: "system",
      });
      await api
        .saveConfig({ permissions: { mode: "ask" } })
        .catch(() => undefined);
      onDone();
    } catch (err) {
      setState({ busy: false, error: String(err) });
    }
  }

  return (
    <Dialog
      label="Welcome to ShadowCode"
      className="wizard"
      onClose={() => undefined}
    >
      <img src="/icon-192.png" alt="" className="welcome-mark" />
      <h2 id="onboarding-title">Welcome to ShadowCode</h2>
      <p className="hint">An open-source project by Shadowfetch</p>
      <p className="hint">
        Open a project, pick an agent, send a message. Ask-first approvals are
        on; switch to allow-edits in the composer when you want fewer prompts.
      </p>
      <div className="field">
        <label htmlFor="onboarding-folder">Project folder</label>
        <div className="input-action">
          <input
            id="onboarding-folder"
            value={workspace}
            onChange={(e) => setWorkspace(e.target.value)}
            placeholder="/path/to/project"
          />
          {canPickFiles() && (
            <button
              type="button"
              className="ghost"
              disabled={state.busy}
              onClick={() =>
                void pickDirectory()
                  .then((path) => {
                    if (path) setWorkspace(path);
                  })
                  .catch((error) =>
                    setState({ busy: false, error: String(error) }),
                  )
              }
            >
              Browse…
            </button>
          )}
        </div>
      </div>
      <p className="hint">
        Opening trusts this folder: the agent may read it. File edits and
        commands still wait for your approval until you change that.
      </p>
      {state.error && (
        <p className="health-bad" role="alert">
          {state.error}
        </p>
      )}
      <div className="row end">
        <button
          type="button"
          className="primary"
          disabled={state.busy || !workspace.trim()}
          onClick={() => void start()}
        >
          {state.busy ? "Opening…" : "Open project"}
        </button>
      </div>
    </Dialog>
  );
}
