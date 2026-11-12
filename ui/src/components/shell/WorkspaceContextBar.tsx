import { GitBranch, FileCheck2, Activity } from "lucide-react";
import { RunCheck, type RunCheckAction } from "../RunCheck";

/** Stable project identity and verification entry points, independent of
 * transcript scroll position. No success state is inferred from a completed task. */
export function WorkspaceContextBar({
  workspace,
  branch,
  runCheck,
  latestTask,
  reviewing,
  onReview,
  onConversation,
  onRuns,
}: {
  workspace: string;
  branch: string;
  runCheck: RunCheckAction;
  latestTask?: string;
  reviewing: boolean;
  onReview: (id: string) => void;
  onConversation: () => void;
  onRuns: () => void;
}) {
  return (
    <div
      className="workspace-context"
      role="group"
      aria-label="Project context and verification"
    >
      <span className="workspace-location" title={workspace}>
        {workspace || "No project open"}
      </span>
      {branch && (
        <span className="workspace-branch" title={branch}>
          <GitBranch size={12} aria-hidden="true" />
          {branch}
        </span>
      )}
      <div className="workspace-evidence">
        {reviewing ? (
          <button type="button" onClick={onConversation}>
            Conversation
          </button>
        ) : (
          latestTask && (
            <button
              type="button"
              onClick={() => onReview(latestTask)}
              title="Review the latest completed task in this conversation"
            >
              <FileCheck2 size={14} aria-hidden="true" />
              <span>Review latest task</span>
            </button>
          )
        )}
        <button
          type="button"
          onClick={onRuns}
          aria-label="Show running processes"
          title="Background processes and output"
        >
          <Activity size={14} aria-hidden="true" />
          <span>Processes</span>
        </button>
        <RunCheck action={runCheck} label="Run project check…" />
      </div>
    </div>
  );
}
