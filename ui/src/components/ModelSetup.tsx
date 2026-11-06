import { useId, useState } from "react";
import type { DownloadModel } from "../api";
import type { ModelDownloads } from "../hooks/useModelDownloads";
import {
  FIT_LABEL,
  blockedReason,
  downloadEstimate,
  formatSize,
  hardwareSummary,
  inProgress,
  noRecommendationReason,
  offered,
  recommendedModel,
} from "../lib/downloads";
import { DownloadRow } from "./ModelDownloads";
import { ProviderConnect } from "./ProviderConnect";

export type SetupChoice = "download" | "openrouter" | "subscription";

/** "No model yet": sign in to a subscription, paste an API key, or download
 * a free local model. Nothing downloads until the button is pressed. */
export function ModelSetup({
  downloads,
  onStarted,
  onOpenRouter,
  onSubscription,
  onBrowse,
  onSkip,
  onConnected,
  skipLabel = "Skip for now",
}: {
  downloads: ModelDownloads;
  onStarted: (model: DownloadModel) => void;
  onOpenRouter: () => void;
  onSubscription: () => void;
  /** Settings › Local models: every free model, with sizes. */
  onBrowse: () => void;
  onSkip?: () => void;
  /** A subscription or API key became ready: reload the picker. */
  onConnected?: () => void;
  skipLabel?: string;
}) {
  const uid = useId();
  const catalog = downloads.catalog;
  const recommended = recommendedModel(catalog);
  const options = offered(catalog);
  const chosen = recommended || options[0];
  const blocked =
    chosen && catalog && chosen.state !== "installed"
      ? blockedReason(chosen, catalog)
      : "";
  const canDownload = Boolean(chosen && catalog && !blocked);
  const [picked, setChoice] = useState<SetupChoice | "">("");
  // The download is preselected once the catalog shows one that fits; an
  // explicit choice always wins (derived, so a late catalog can't undo it).
  const choice: SetupChoice | "" =
    picked || (catalog && recommended && !catalog.offline ? "download" : "");
  const starting = Boolean(
    chosen && downloads.pending === `start:${chosen.id}`,
  );

  async function go() {
    if (choice === "openrouter") return onOpenRouter();
    if (choice === "subscription") return onSubscription();
    if (choice !== "download" || !chosen) return;
    if (chosen.state === "installed" || (await downloads.start(chosen.id)))
      onStarted(chosen);
  }

  const downloadDetail = !catalog
    ? downloads.loadError || "Checking what this computer can run…"
    : !chosen
      ? noRecommendationReason(catalog)
      : `${chosen.name} by ${chosen.publisher}: ${formatSize(chosen.bytes)}, ${downloadEstimate(chosen.bytes)}. ${FIT_LABEL[chosen.fit]}.`;

  return (
    <div className="model-setup">
      <ProviderConnect
        onReady={onConnected}
        onOpenSettings={onSubscription}
      />
      <fieldset className="mode-options">
        <legend>Or run a free model on this computer</legend>
        <label
          className={`mode-option ${!chosen || catalog?.offline ? "is-disabled" : ""}`}
        >
          <input
            type="radio"
            name={`${uid}-choice`}
            checked={choice === "download"}
            disabled={!chosen || Boolean(catalog?.offline)}
            onChange={() => setChoice("download")}
          />
          <span>
            <strong>
              Download a free model to run on this computer
              {recommended && (
                <span className="cap-badge download-recommended">
                  Recommended
                </span>
              )}
            </strong>
            <small>
              Free and private: no account, and your code stays on this
              computer.
            </small>
            <small className="model-setup-detail">{downloadDetail}</small>
            {catalog && chosen && hardwareSummary(catalog) && (
              <small>
                Picked for this computer: {hardwareSummary(catalog)}.
              </small>
            )}
            {catalog?.offline && (
              <small className="warn-text">
                Offline mode is on. Switch to Online in Settings › Permissions
                &amp; network to download.
              </small>
            )}
            {chosen && blocked && !catalog?.offline && (
              <small className="warn-text">{blocked}</small>
            )}
          </span>
        </label>
        {catalog && catalog.models.length > 1 && (
          <p className="model-setup-pick">
            <button type="button" className="link" onClick={onBrowse}>
              See other free models
            </button>
          </p>
        )}
      </fieldset>
      <div className="row end">
        {onSkip && (
          <button type="button" className="ghost" onClick={onSkip}>
            {skipLabel}
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={
            choice !== "download" ||
            starting ||
            !canDownload ||
            !chosen
          }
          onClick={() => void go()}
        >
          {choice === "download" && chosen
            ? starting
              ? "Starting…"
              : chosen.state === "installed"
                ? `Use ${chosen.name}`
                : chosen.state === "paused" || chosen.state === "failed"
                  ? `Resume ${chosen.name}`
                  : `Download ${chosen.name}`
            : "Continue"}
        </button>
      </div>
    </div>
  );
}

/** The empty conversation when no model is selected: a download in
 * progress, or (with nothing ready at all) sign-in plus a free local model,
 * or the usual "Choose a model" when something is ready. */
export function ModelSetupPanel({
  downloads,
  hasReadyModel,
  onChooseModel,
  onOpenRouter,
  onSubscription,
  onBrowse,
  onConnected,
}: {
  downloads: ModelDownloads;
  hasReadyModel: boolean;
  onChooseModel: () => void;
  onOpenRouter: () => void;
  onSubscription: () => void;
  onBrowse: () => void;
  onConnected?: () => void;
}) {
  const catalog = downloads.catalog;
  const active = catalog?.models.find(inProgress);
  if (active && catalog)
    return (
      <div className="model-setup-panel">
        <p>
          {active.state === "downloading" || active.state === "checking"
            ? `Downloading ${active.name}. It is selected here as soon as it is ready.`
            : `${active.name} isn't finished downloading yet.`}
        </p>
        <DownloadRow model={active} catalog={catalog} downloads={downloads} />
        <p className="hint">
          Meanwhile you can{" "}
          <button type="button" className="link" onClick={onOpenRouter}>
            use an OpenRouter key
          </button>{" "}
          or{" "}
          <button type="button" className="link" onClick={onSubscription}>
            sign in to a subscription
          </button>
          {hasReadyModel ? (
            <>
              , or{" "}
              <button type="button" className="link" onClick={onChooseModel}>
                choose a model you already have
              </button>
            </>
          ) : null}
          .
        </p>
      </div>
    );
  if (hasReadyModel)
    return (
      <div className="model-setup-panel is-short">
        <p>Choose a coding agent or local model to start.</p>
        <button type="button" className="primary" onClick={onChooseModel}>
          Choose a model
        </button>
      </div>
    );
  return (
    <div className="model-setup-panel">
      <p>Open a project, pick an agent, send a message.</p>
      <ModelSetup
        downloads={downloads}
        onStarted={() => undefined}
        onOpenRouter={onOpenRouter}
        onSubscription={onSubscription}
        onBrowse={onBrowse}
        onConnected={onConnected}
      />
    </div>
  );
}
