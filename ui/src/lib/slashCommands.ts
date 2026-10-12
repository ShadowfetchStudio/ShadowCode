/** The composer's `/` menu: which commands fit what follows the slash. */

/** Rows the menu shows at most. */
export const SLASH_LIMIT = 8;

/** Commands for the text after `/`, best first: names that start with it,
 * then names that contain it, then descriptions that mention it, each in
 * catalogue order, so "/view" still finds /review. Case is ignored. */
export function matchSlashCommands<
  T extends { name: string; description: string },
>(commands: readonly T[], query: string, limit = SLASH_LIMIT): T[] {
  const q = query.toLowerCase();
  const prefix: T[] = [];
  const inName: T[] = [];
  const inDescription: T[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(command);
    else if (name.includes(q)) inName.push(command);
    else if (command.description.toLowerCase().includes(q))
      inDescription.push(command);
  }
  return [...prefix, ...inName, ...inDescription].slice(0, limit);
}
