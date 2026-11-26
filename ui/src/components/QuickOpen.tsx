import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, Code2, FileCode2, History, Search } from "lucide-react";
import { api } from "../api";
import {
  clearRecentFiles,
  togglePinnedFile,
  useFilePlaces,
} from "../lib/filePlaces";
import { Dialog } from "./Dialog";

type Mode = "files" | "code" | "pinned";
type Match = {
  path: string;
  line?: number;
  end?: number;
  symbols?: string;
  preview?: string;
};

export function QuickOpen({
  workspace,
  onOpenFile,
  onAttachFile,
  onClose,
}: {
  workspace: string;
  onOpenFile: (path: string, line?: number) => void;
  onAttachFile?: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("files");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const places = useFilePlaces(workspace);
  const effectiveMode = query.startsWith("#") ? "code" : mode;
  const term = (query.startsWith("#") ? query.slice(1) : query).trim();
  const target = effectiveMode !== "code" && /^(.+):([1-9]\d*)$/.exec(term);
  const line =
    target && Number.isSafeInteger(Number(target[2]))
      ? Number(target[2])
      : undefined;
  const search = target && line ? target[1] : term;
  const requestKey = JSON.stringify([workspace, effectiveMode, search]);
  const [result, setResult] = useState<{
    key: string;
    items: Match[];
    engine?: string;
    error?: string;
  }>();
  const fetchResults =
    effectiveMode === "files" || (effectiveMode === "code" && !!search);
  useEffect(() => {
    if (!fetchResults) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        try {
          let items: Match[];
          let engine: string | undefined;
          if (effectiveMode === "code") {
            const response = await api.codeSearch(search, 14);
            engine =
              response.mode === "hybrid"
                ? "Hybrid semantic + BM25"
                : "BM25 index";
            items = response.hits.map((hit) => ({
              path: hit.path,
              line: hit.start_line,
              end: hit.end_line,
              symbols: hit.symbols,
              preview: hit.preview?.split("\n")[0]?.trim(),
            }));
          } else {
            const response = await api.mentions(search, 24);
            items = response.items.filter((item) => item.kind === "file");
          }
          if (!cancelled) setResult({ key: requestKey, items, engine });
        } catch (reason) {
          if (!cancelled)
            setResult({ key: requestKey, items: [], error: String(reason) });
        }
      },
      !search ? 0 : effectiveMode === "code" ? 150 : 80,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [requestKey, fetchResults, search, effectiveMode]);

  const current = result?.key === requestKey ? result : undefined;
  const local =
    effectiveMode === "pinned"
      ? places.pinned.filter((path) =>
          path.toLowerCase().includes(search.toLowerCase()),
        )
      : effectiveMode === "files" && !search
        ? [...new Set([...places.pinned, ...places.recent])]
        : [];
  const items: Match[] = [
    ...local.map((path) => ({ path })),
    ...(current?.items ?? []).filter((item) => !local.includes(item.path)),
  ];
  const selected = Math.min(index, Math.max(0, items.length - 1));
  const itemId = (i: number) => `${listId}-${i}`;
  const activeId = items.length ? itemId(selected) : undefined;
  useEffect(() => {
    if (activeId)
      document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  function activate(item: Match | undefined, attach: boolean) {
    if (!item) return;
    if (attach && onAttachFile) onAttachFile(item.path);
    else if (item.line || line) onOpenFile(item.path, item.line || line);
    else onOpenFile(item.path);
    onClose();
  }
  const folder =
    workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace || "workspace";
  const nextMode = (value: Mode) => {
    setMode(value);
    setIndex(0);
    if (query.startsWith("#")) setQuery(query.slice(1));
    input.current?.focus();
  };
  return (
    <Dialog
      label="Quick Open"
      className="modal modal-md quick-open-modal"
      onClose={onClose}
    >
      <div className="places-heading">
        <h2>Quick Open</h2>
        <span title={workspace}>{folder}</span>
      </div>
      <div className="quick-open-input-wrap">
        <Search size={16} className="quick-open-icon" aria-hidden="true" />
        <input
          ref={input}
          autoFocus
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label="Search files or symbols"
          className="quick-open-input"
          value={query}
          placeholder={
            effectiveMode === "code"
              ? "Search symbols or code…"
              : effectiveMode === "pinned"
                ? "Filter pinned paths…"
                : "Search files, file:line or #symbol…"
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (
              items.length &&
              (e.key === "ArrowDown" || e.key === "ArrowUp")
            ) {
              e.preventDefault();
              setIndex(
                (selected + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                  items.length,
              );
            } else if (e.key === "Enter") {
              e.preventDefault();
              activate(items[selected], e.shiftKey);
            }
          }}
        />
      </div>
      <div
        className="seg quick-open-mode"
        role="group"
        aria-label="Search mode"
      >
        {(["files", "code", "pinned"] as const).map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed={effectiveMode === value}
            className={effectiveMode === value ? "on" : ""}
            onClick={() => nextMode(value)}
          >
            {value === "files"
              ? "Files"
              : value === "code"
                ? "Code & Symbols"
                : "Pinned"}
          </button>
        ))}
      </div>
      {current?.error && (
        <p className="quick-open-status error" role="alert">
          {current.error}
        </p>
      )}
      <div className="places-list">
        <div
          id={listId}
          role="listbox"
          aria-label={
            effectiveMode === "code"
              ? "Matching code and symbols"
              : "Matching files"
          }
        >
          {items.map((item, i) => {
            const parts = item.path.split(/[\\/]/);
            const name = parts.pop();
            const pinned = places.pinned.includes(item.path);
            const recent = local.includes(item.path);
            const Icon = item.line
              ? Code2
              : pinned
                ? Bookmark
                : recent
                  ? History
                  : FileCode2;
            return (
              <button
                type="button"
                role="option"
                id={itemId(i)}
                key={JSON.stringify([item.path, item.line, i])}
                aria-selected={selected === i}
                tabIndex={-1}
                className={`quick-open-item ${selected === i ? "selected" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={(e) => activate(item, e.shiftKey)}
              >
                <Icon
                  size={16}
                  className="quick-open-item-icon"
                  aria-hidden="true"
                />
                <span className="quick-open-item-text">
                  <strong>{item.line ? item.path : name}</strong>
                  {item.line ? (
                    <>
                      <span className="quick-open-lines">
                        L{item.line}–{item.end}
                      </span>
                      {item.symbols && (
                        <span className="quick-open-symbols">
                          {item.symbols}
                        </span>
                      )}
                      {item.preview && (
                        <code className="quick-open-preview">
                          {item.preview}
                        </code>
                      )}
                    </>
                  ) : (
                    parts.length > 0 && (
                      <span className="quick-open-dir">{parts.join("/")}</span>
                    )
                  )}
                </span>
                {!item.line && (pinned || recent || line) && (
                  <span className="place-label">
                    {line ? `L${line}` : pinned ? "Pinned" : "Recent"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {items.length === 0 && !current?.error && (
          <p className="quick-open-status" role="status">
            {fetchResults && !current
              ? `Searching ${folder}…`
              : effectiveMode === "pinned" && !search
                ? "Pin a file in the editor to find it here."
                : effectiveMode === "code" && !search
                  ? "Enter a symbol or phrase to search indexed code."
                  : "No matching files or symbols."}
          </p>
        )}
      </div>
      <footer className="quick-open-footer">
        <span>
          <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> open{" "}
          {onAttachFile && (
            <>
              · <kbd>Shift+Enter</kbd> attach
            </>
          )}
        </span>
        {current?.engine && (
          <span className="quick-open-engine">{current.engine}</span>
        )}
        {effectiveMode === "files" && !search && places.recent.length > 0 && (
          <button
            type="button"
            className="mini"
            onClick={() => clearRecentFiles(workspace)}
          >
            Clear recent files
          </button>
        )}
        {effectiveMode === "pinned" && items[selected] && (
          <button
            type="button"
            className="mini"
            aria-label={`Unpin ${items[selected].path}`}
            onClick={() => togglePinnedFile(workspace, items[selected].path)}
          >
            Unpin selected
          </button>
        )}
      </footer>
    </Dialog>
  );
}
