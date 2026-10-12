import { useEffect, useRef, useState } from "react";
import type { Approval, Job } from "../../api";
import { approvalSummary } from "../ApprovalCard";
import { isActive } from "../../lib/jobs";

/** How long an announcement stays in the page after it is read, so browsing
 * the page later does not find a stale "Approval needed". */
export const MILESTONE_MS = 10000;

const ENDED: Record<string, string> = {
  completed: "Answer finished",
  failed: "Task failed",
  cancelled: "Task stopped",
  limit_reached: "Task stopped at the plan limit",
  interrupted: "Task interrupted",
};

/** What to say when the open conversation's task changes from `before` to
 * `after`: only as that task ends, never for a finished task that is
 * opened, and nothing while it runs. */
export function jobMilestone(before: Job | null, after: Job | null): string {
  if (!before || !after || before.id !== after.id) return "";
  if (!isActive(before) || isActive(after)) return "";
  return ENDED[after.status] ?? "";
}

/** "Approval needed: npm test", or how many when several arrive at once. */
export function approvalMilestone(fresh: readonly Approval[]): string {
  if (!fresh.length) return "";
  const first = approvalSummary(fresh[0]);
  return fresh.length === 1
    ? `Approval needed: ${first}`
    : `${fresh.length} approvals needed. First: ${first}`;
}

/** The conversation's one announcement area for screen readers. The
 * transcript itself is not live (streaming answers would be read word by
 * word); this says each milestone once: an answer finished, a task failed
 * or stopped, an action waits for approval. Each message is a new node, so
 * the same words twice are read twice. */
export function Milestones({
  job,
  approvals,
}: {
  job: Job | null;
  approvals: readonly Approval[];
}) {
  const [said, setSaid] = useState<{ key: number; text: string }[]>([]);
  const seq = useRef(0);
  const before = useRef(job);
  const announced = useRef(new Set<string>());
  const say = (text: string) => {
    if (text)
      setSaid((list) => [...list.slice(-2), { key: ++seq.current, text }]);
  };
  useEffect(() => {
    const text = jobMilestone(before.current, job);
    before.current = job;
    say(text);
  }, [job]);
  useEffect(() => {
    const fresh = approvals.filter((a) => !announced.current.has(a.id));
    fresh.forEach((a) => announced.current.add(a.id));
    say(approvalMilestone(fresh));
  }, [approvals]);
  useEffect(() => {
    if (!said.length) return;
    const timer = setTimeout(() => setSaid([]), MILESTONE_MS);
    return () => clearTimeout(timer);
  }, [said]);
  return (
    <div className="milestones sr-only" aria-live="polite">
      {said.map((m) => (
        <p key={m.key}>{m.text}</p>
      ))}
    </div>
  );
}
