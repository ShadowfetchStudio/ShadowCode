import type { Project, Session } from "../../api";
import type { PaletteItem } from "../Palette";
import { projectOf } from "../../lib/badges";

const folderName = (path: string) => path.split("/").pop() || path;

/** Conversations the command palette can open, found by title, with the
 * project the sidebar lists them under beside it. Untitled conversations
 * have no name to type, so they are left out. */
export function conversationItems(
  sessions: Session[],
  open: (id: string) => void,
): PaletteItem[] {
  return sessions.flatMap((session) => {
    const title = session.title?.trim();
    if (!title) return [];
    return [
      {
        id: `conversation:${session.id}`,
        label: title,
        detail: folderName(projectOf(session)),
        run: () => open(session.id),
      },
    ];
  });
}

/** Recent projects the command palette can open, by name. */
export function projectItems(
  projects: Project[],
  open: (path: string) => void,
): PaletteItem[] {
  return projects.map((project) => ({
    id: `project:${project.path}`,
    label: project.name || folderName(project.path),
    detail: project.path,
    run: () => open(project.path),
  }));
}
