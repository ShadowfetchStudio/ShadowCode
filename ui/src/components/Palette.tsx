import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FolderOpen, MessageSquare } from "lucide-react";
import { Dialog } from "./Dialog";
import { fuzzyRank, matchSegments } from "../lib/fuzzy";
import { readStore, writeStore } from "../lib/storage";

export type PaletteItem = {
  id: string;
  label: string;
  /** Secondary text after the label, such as a conversation's project. */
  detail?: string;
  hint?: string;
  run: () => void;
};

type GroupId = "recent" | "commands" | "conversations" | "projects";
export type PaletteEntry = {
  item: PaletteItem;
  score: number;
  /** Matched characters of the label, shown emphasised. */
  indices: number[];
};
export type PaletteGroup = {
  id: GroupId;
  label: string;
  entries: PaletteEntry[];
};

const RECENT_KEY = "shadow:palette-recent";
const RECENT_LIMIT = 5;
const CONVERSATION_LIMIT = 8;
const PROJECT_LIMIT = 5;
// Matches scoring well below the best one are letters scattered across
// unrelated words ("set" in "Workspace health"): left out, they would bury
// what was meant. Any run of letters at a word start stays above this.
const CLOSE_TO_BEST = 0.6;
const NONE: PaletteItem[] = [];

/** Commands last run from the palette (ids, newest first). */
export function readRecentCommands(): string[] {
  try {
    const value = JSON.parse(readStore(RECENT_KEY) || "[]");
    return Array.isArray(value)
      ? value.filter((id) => typeof id === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function noteRecentCommand(id: string) {
  const recent = [id, ...readRecentCommands().filter((r) => r !== id)];
  writeStore(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_LIMIT)));
}

/** What the palette lists. With nothing typed: the commands run last, then
 * the others in their usual order. With a query: the commands,
 * conversations and projects that match it about as well as the best match
 * does, best first, each kind in its own group; the group holding the best
 * match comes first, so Enter runs what the query fits best. */
export function paletteGroups(
  query: string,
  {
    commands,
    conversations = NONE,
    projects = NONE,
    recent = [],
  }: {
    commands: PaletteItem[];
    conversations?: PaletteItem[];
    projects?: PaletteItem[];
    recent?: string[];
  },
): PaletteGroup[] {
  const plain = (item: PaletteItem): PaletteEntry => ({
    item,
    score: 0,
    indices: [],
  });
  if (!query.trim()) {
    const first = recent
      .map((id) => commands.find((item) => item.id === id))
      .filter((item): item is PaletteItem => Boolean(item));
    const groups: PaletteGroup[] = [
      { id: "recent", label: "Recent", entries: first.map(plain) },
      {
        id: "commands",
        label: "Commands",
        entries: commands.filter((item) => !first.includes(item)).map(plain),
      },
    ];
    return groups.filter((group) => group.entries.length);
  }
  const rank = (items: PaletteItem[]) =>
    fuzzyRank(items, query, (item) => item.label);
  const matches = {
    commands: rank(commands),
    conversations: rank(conversations),
    projects: rank(projects),
  };
  const best = Math.max(
    ...Object.values(matches).map((hits) => hits[0]?.score ?? -Infinity),
  );
  const cutoff = best - Math.abs(best) * (1 - CLOSE_TO_BEST);
  const close = (hits: PaletteEntry[], limit?: number) =>
    hits.filter((hit) => hit.score >= cutoff).slice(0, limit);
  const groups: PaletteGroup[] = [
    { id: "commands", label: "Commands", entries: close(matches.commands) },
    {
      id: "conversations",
      label: "Conversations",
      entries: close(matches.conversations, CONVERSATION_LIMIT),
    },
    {
      id: "projects",
      label: "Projects",
      entries: close(matches.projects, PROJECT_LIMIT),
    },
  ];
  // Stable: on equal best scores, commands come first.
  return groups
    .filter((group) => group.entries.length)
    .sort((a, b) => b.entries[0].score - a.entries[0].score);
}

/** The label with its matched characters in emphasised spans. */
function Highlighted({ text, indices }: { text: string; indices: number[] }) {
  if (!indices.length) return <>{text}</>;
  return (
    <>
      {matchSegments(text, indices).map((segment, i) =>
        segment.match ? (
          <span key={i} className="palette-match">
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/** The command palette (Ctrl+K): a combobox over a grouped listbox. Focus
 * stays in the search field; the arrow keys, Page Up/Down and Home/End move
 * the active option (aria-activedescendant), Enter runs it and Escape
 * closes. */
export function Palette({
  items,
  conversations = NONE,
  projects = NONE,
  onClose,
}: {
  /** Commands, in display order. */
  items: PaletteItem[];
  /** Conversations to open, listed once something is typed. */
  conversations?: PaletteItem[];
  /** Projects to open, listed once something is typed. */
  projects?: PaletteItem[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  // Read once: running a command closes the palette.
  const [recent] = useState(readRecentCommands);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, "");
  const listId = `${uid}-list`;
  const optionId = (n: number) => `${uid}-option-${n}`;
  const groupId = (id: GroupId) => `${uid}-${id}`;
  const groups = useMemo(
    () =>
      paletteGroups(query, {
        commands: items,
        conversations,
        projects,
        recent,
      }),
    [query, items, conversations, projects, recent],
  );
  const rows = groups.flatMap((group) =>
    group.entries.map((entry, i) => ({ entry, group: group.id, first: !i })),
  );
  const active = Math.min(index, rows.length - 1);

  useEffect(() => {
    const row = rows[active];
    if (!row) return;
    // The first option of a group brings its heading into view too.
    if (row.first)
      document
        .getElementById(groupId(row.group))
        ?.scrollIntoView?.({ block: "nearest" });
    document
      .getElementById(optionId(active))
      ?.scrollIntoView?.({ block: "nearest" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, query]);

  function choose({ item }: PaletteEntry, group: GroupId) {
    // Only commands are remembered; conversations and projects are places.
    if (group === "recent" || group === "commands") noteRecentCommand(item.id);
    onClose();
    item.run();
  }

  /** Options that fit in the list, less one so the move keeps context. */
  function pageSize() {
    const box = list.current;
    const option = box?.querySelector<HTMLElement>('[role="option"]');
    return box && option?.offsetHeight
      ? Math.max(1, Math.floor(box.clientHeight / option.offsetHeight) - 1)
      : 8;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const last = rows.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowDown":
        next = active + 1;
        break;
      case "ArrowUp":
        next = active - 1;
        break;
      case "PageDown":
        next = active + pageSize();
        break;
      case "PageUp":
        next = active - pageSize();
        break;
      // Shift+Home/End still select text in the field.
      case "Home":
        if (event.shiftKey) return;
        next = 0;
        break;
      case "End":
        if (event.shiftKey) return;
        next = last;
        break;
      case "Enter":
        if (rows[active]) {
          event.preventDefault();
          choose(rows[active].entry, rows[active].group);
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    if (last >= 0) setIndex(Math.max(0, Math.min(last, next)));
  }

  let position = 0;
  return (
    <Dialog label="Command palette" className="palette" onClose={onClose}>
      <input
        autoFocus
        value={query}
        role="combobox"
        aria-label="Search commands"
        aria-autocomplete="list"
        aria-expanded={rows.length > 0}
        aria-controls={rows.length ? listId : undefined}
        aria-activedescendant={rows.length ? optionId(active) : undefined}
        placeholder="Type a command…"
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      {rows.length > 0 && (
        <div
          ref={list}
          id={listId}
          className="palette-list"
          role="listbox"
          aria-label="Results"
          // Clicking an option keeps focus (and the caret) in the field.
          onMouseDown={(e) => e.preventDefault()}
        >
          {groups.map((group) => (
            <div
              key={group.id}
              className="palette-group"
              role="group"
              aria-labelledby={groupId(group.id)}
            >
              <div
                id={groupId(group.id)}
                className="palette-group-label"
                role="presentation"
              >
                {group.label}
              </div>
              {group.entries.map((entry) => {
                const n = position++;
                const id = optionId(n);
                const { item } = entry;
                const described = [
                  item.detail && `${id}-detail`,
                  item.hint && `${id}-hint`,
                ].filter(Boolean);
                return (
                  <div
                    key={`${group.id}:${item.id}`}
                    id={id}
                    role="option"
                    aria-selected={n === active}
                    // Named by the label alone: the emphasised letters split
                    // it into runs that some readers would space apart.
                    aria-label={item.label}
                    aria-describedby={described.join(" ") || undefined}
                    className={`hit ${n === active ? "on" : ""}`}
                    onMouseMove={() => {
                      if (n !== active) setIndex(n);
                    }}
                    onClick={() => choose(entry, group.id)}
                  >
                    {group.id === "conversations" && (
                      <MessageSquare size={14} aria-hidden="true" />
                    )}
                    {group.id === "projects" && (
                      <FolderOpen size={14} aria-hidden="true" />
                    )}
                    <span className="palette-label">
                      <Highlighted text={item.label} indices={entry.indices} />
                    </span>
                    {item.detail && (
                      <span id={`${id}-detail`} className="palette-detail">
                        {item.detail}
                      </span>
                    )}
                    {item.hint && (
                      <span id={`${id}-hint`} className="kbd">
                        {item.hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <div className="palette-empty" role="status">
        {!rows.length && query.trim()
          ? `Nothing matches “${query.trim()}”.`
          : ""}
      </div>
    </Dialog>
  );
}
