import {
  ChevronRight,
  FolderOpen,
  GitCompareArrows,
  GitPullRequest,
  LayoutGrid,
  PanelLeft,
  Search,
  Files,
  Terminal,
  PanelTop,
} from "lucide-react";
import type { DrawerTab } from "../Drawer";
import { shortcutHint } from "../../lib/shortcuts";

/** Project crumb, conversation title and the Comparisons, Changes and
 * command palette buttons. */
export function TopBar({
  sidebar,
  onShowSidebar,
  projectPath,
  onProject,
  title,
  comparing,
  onComparisons,
  mission = false,
  onMission,
  missionCount = 0,
  changesOpen,
  onChanges,
  changeCount,
  onPalette,
  panel,
  terminalVisible,
  onPanel,
}: {
  sidebar: boolean;
  onShowSidebar: () => void;
  projectPath: string;
  onProject: () => void;
  title: string;
  comparing: boolean;
  onComparisons: () => void;
  mission?: boolean;
  onMission?: () => void;
  missionCount?: number;
  changesOpen: boolean;
  onChanges: () => void;
  changeCount: number;
  onPalette: () => void;
  panel?: DrawerTab | null;
  terminalVisible?: boolean;
  onPanel?: (panel: DrawerTab) => void;
}) {
  return (
    <header className="top">
      {!sidebar && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Show sidebar"
          title={`Show sidebar (${shortcutHint("B")})`}
          onClick={onShowSidebar}
        >
          <PanelLeft size={18} aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="project-crumb"
        title={projectPath || "Open project"}
        onClick={onProject}
      >
        <FolderOpen size={15} aria-hidden="true" />
        <span>{projectPath.split("/").pop() || "Open project"}</span>
      </button>
      <ChevronRight size={13} className="dim" aria-hidden="true" />
      {/* The page's one level-one heading: the open task (or Comparisons / Mission Control). */}
      <h1 className="top-title" title={title}>
        {mission ? "Mission Control" : comparing ? "Comparisons" : title}
      </h1>
      <div className="top-right">
        {onPanel && (
          <nav className="workspace-tools" aria-label="Workspace tools">
            {(
              [
                ["files", "Files", Files],
                ["terminal", "Terminal", Terminal],
                ["preview", "Preview", PanelTop],
              ] as const
            ).map(([id, label, Icon]) => {
              const pressed =
                id === "terminal"
                  ? (terminalVisible ?? panel === id)
                  : panel === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`top-action ${pressed ? "on" : ""}`}
                  aria-label={`Show ${label.toLowerCase()}`}
                  aria-pressed={pressed}
                  title={
                    id === "terminal"
                      ? `${label} (${shortcutHint("`")})`
                      : label
                  }
                  onClick={() => onPanel(id)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>
        )}
        {onMission && (
          <button
            type="button"
            className={`top-action mission-action ${mission ? "on" : ""}`}
            aria-label="Mission Control"
            aria-pressed={mission}
            title={`Mission Control (${shortcutHint("Shift+D")})`}
            onClick={onMission}
          >
            <LayoutGrid size={15} aria-hidden="true" />
            <span>Mission</span>
            {missionCount > 0 && <span className="count">{missionCount}</span>}
          </button>
        )}
        <button
          type="button"
          className={`top-action compare-action ${comparing ? "on" : ""}`}
          aria-label="Comparisons"
          aria-pressed={comparing}
          title="Comparisons in this project"
          onClick={onComparisons}
        >
          <GitCompareArrows size={15} aria-hidden="true" />
          <span>Comparisons</span>
        </button>
        <button
          type="button"
          className={`top-action ${changesOpen ? "on" : ""}`}
          aria-label="Review changes"
          aria-pressed={changesOpen}
          title={`Review diffs, commit, and open a pull request (${shortcutHint("Shift+B")})`}
          onClick={onChanges}
        >
          <GitPullRequest size={15} aria-hidden="true" />
          <span>Changes</span>
          {changeCount > 0 && <span className="count">{changeCount}</span>}
        </button>
        <span className="top-divider" />
        <button
          type="button"
          className="icon-btn"
          title={`Command palette (${shortcutHint("K")})`}
          aria-label="Command palette"
          onClick={onPalette}
        >
          <Search size={16} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
