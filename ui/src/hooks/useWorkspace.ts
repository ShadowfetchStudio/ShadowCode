import { useCallback, useState } from "react";
import { api, type Health, type Job, type Project, type Session } from "../api";

export type WorkspaceStatus = Awaited<ReturnType<typeof api.status>>;
export type GitSummary = { branch: string; count: number; repo: boolean };

/** Engine state the whole window shows: the open project, health, config,
 * conversations, projects, the project's status and its Git summary. */
export function useWorkspace(setJobs: (jobs: Job[]) => void) {
  const [workspace, setWorkspace] = useState("");
  const [health, setHealth] = useState<Health | null>(null);
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [git, setGit] = useState<GitSummary>({
    branch: "",
    count: 0,
    repo: false,
  });

  const refreshIfCurrent = useCallback(
    async (current: () => boolean) => {
      const [s, p, active, state] = await Promise.all([
        api.sessions(),
        api.projects(),
        api.jobs(),
        api.status(),
      ]);
      if (!current()) return;
      setSessions(s.sessions);
      setProjects(p.projects);
      setJobs(active.jobs);
      setStatus(state);
      try {
        const g = await api.git();
        if (!current()) return;
        setGit({
          branch: g.repo
            ? g.status
                .split("\n")[0]
                .replace(/^##\s*/, "")
                .split("...")[0]
            : "",
          count: g.files?.length || 0,
          repo: Boolean(g.repo),
        });
      } catch {
        /* status is optional outside git */
      }
    },
    [setJobs],
  );

  const reloadConfigIfCurrent = useCallback(async (current: () => boolean) => {
    const [config, state] = await Promise.all([api.config(), api.status()]);
    if (!current()) return;
    setCfg(config);
    setStatus(state);
  }, []);

  // Public callbacks also run as Promise handlers and event callbacks. Ignore
  // their arguments; navigation supplies ownership only to the explicit helpers.
  const refresh = useCallback(
    () => refreshIfCurrent(() => true),
    [refreshIfCurrent],
  );
  const reloadConfig = useCallback(
    () => reloadConfigIfCurrent(() => true),
    [reloadConfigIfCurrent],
  );

  return {
    workspace,
    setWorkspace,
    health,
    setHealth,
    cfg,
    status,
    setStatus,
    sessions,
    projects,
    git,
    refresh,
    reloadConfig,
    refreshIfCurrent,
    reloadConfigIfCurrent,
    /** The config has been read at least once. */
    configLoaded: Object.keys(cfg).length > 0,
  };
}
