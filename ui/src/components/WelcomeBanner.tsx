import type { ReactNode } from "react";
import { Compass, Bug, FlaskConical, ArrowUpRight } from "lucide-react";

export const SUGGESTIONS: { label: string; prompt: string }[] = [
  {
    label: "Explain this project",
    prompt:
      "Explore this project and explain its structure, entry points, and how to run it.",
  },
  { label: "Fix a bug", prompt: "Find and fix the bug where " },
  { label: "Add tests", prompt: "Add tests for " },
];

/** Quiet empty state: the mark, one line and three optional suggestions.
 * Without a model it also shows how to get one (`modelSetup`), or a
 * "Choose a model" button. */
export function WelcomeBanner({
  onSelect,
  needsModel = false,
  onChooseModel,
  modelSetup,
}: {
  onSelect: (prompt: string) => void;
  needsModel?: boolean;
  onChooseModel?: () => void;
  modelSetup?: ReactNode;
}) {
  const details = [
    {
      icon: Compass,
      description: "Find the entry points. Understand how it fits together.",
    },
    {
      icon: Bug,
      description: "Trace a problem, make a focused fix, and check it.",
    },
    {
      icon: FlaskConical,
      description: "Protect important behavior with meaningful coverage.",
    },
  ];
  return (
    <div className="welcome">
      <img src="/icon-192.png" alt="" className="welcome-mark" />
      <p className="welcome-eyebrow">YOUR WORKSPACE, YOUR MODELS</p>
      <h2 className="welcome-title">What should we work on?</h2>
      <p className="welcome-intro">
        A clear plan. A focused change. Work you can review.
      </p>
      {needsModel && modelSetup ? (
        <div className="welcome-model-setup is-wide">{modelSetup}</div>
      ) : (
        needsModel &&
        onChooseModel && (
          <div className="welcome-model-setup">
            <p>Choose a coding agent or local model to start.</p>
            <button type="button" className="primary" onClick={onChooseModel}>
              Choose a model
            </button>
          </div>
        )
      )}
      <div className="welcome-suggestions" aria-label="Suggestions">
        {SUGGESTIONS.map((s, index) => {
          const Icon = details[index].icon;
          return (
            <button
              type="button"
              className="welcome-chip"
              key={s.label}
              aria-label={s.label}
              aria-describedby={`starter-description-${index}`}
              onClick={() => onSelect(s.prompt)}
            >
              <Icon size={20} aria-hidden="true" />
              <strong>{s.label}</strong>
              <span id={`starter-description-${index}`}>
                {details[index].description}
              </span>
              <ArrowUpRight
                className="suggestion-arrow"
                size={15}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
