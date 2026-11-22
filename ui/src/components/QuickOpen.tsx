import { useEffect, useMemo, useRef, useState } from "react";
import { Code2, FileCode2, Folder, Search, Sparkles } from "lucide-react";
import { api, type CodeSearchHit } from "../api";
import { Dialog } from "./Dialog";

type QuickMode = "files" | "code";

type FileMatch = {
  path: string;
  kind: "file" | "dir";
};

/** Instant fuzzy file finder and hybrid BM25/semantic code search dialog. */
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
  const [mode, setMode] = useState<QuickMode>("files");
  const [files, setFiles] = useState<FileMatch[]>([]);
  const [hits, setHits] = useState<CodeSearchHit[]>([]);
  const [searchMode, setSearchMode] = useState<"hybrid" | "bm25" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const effectiveMode: QuickMode = query.startsWith("#") ? "code" : mode;
  const cleanQuery = query.startsWith("#") ? query.slice(1).trim() : query.trim();

  useEffect(() => {
    let cancelled = false;
    setError("");

    if (effectiveMode === "files") {
      setLoading(true);
      const timer = setTimeout(() => {
        void api
          .mentions(cleanQuery, 24)
          .then((res) => {
            if (cancelled) return;
            setFiles(
              (res.items || []).filter((item) => item.kind === "file"),
            );
            setIndex(0);
          })
          .catch((err) => {
            if (!cancelled) setError(String(err));
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      }, cleanQuery ? 80 : 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    if (!cleanQuery) {
      setHits([]);
      setSearchMode(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      void api
        .codeSearch(cleanQuery, 14)
        .then((res) => {
          if (cancelled) return;
          setHits(res.hits || []);
          setSearchMode(res.mode || "bm25");
          setIndex(0);
        })
        .catch((err) => {
          if (!cancelled) setError(String(err));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [effectiveMode, cleanQuery, workspace]);

  const count = effectiveMode === "files" ? files.length : hits.length;

  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const folderName = useMemo(
    () => workspace.split("/").pop() || workspace || "workspace",
    [workspace],
  );

  function activate(at: number, attachOnly = false) {
    if (effectiveMode === "files") {
      const item = files[at];
      if (!item) return;
      if (attachOnly && onAttachFile) {
        onAttachFile(item.path);
      } else {
        onOpenFile(item.path);
      }
      onClose();
      return;
    }
    const hit = hits[at];
    if (!hit) return;
    if (attachOnly && onAttachFile) {
      onAttachFile(hit.path);
    } else {
      onOpenFile(hit.path, hit.start_line);
    }
    onClose();
  }

  return (
    <Dialog
      label="Quick Open"
      className="modal modal-md quick-open-modal"
      onClose={onClose}
    >
      <div className="quick-open-header">
        <div className="quick-open-input-wrap">
          <Search size={15} className="quick-open-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="search"
            className="quick-open-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (count > 0) setIndex((i) => (i + 1) % count);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (count > 0) setIndex((i) => (i - 1 + count) % count);
              } else if (e.key === "Enter" && count > 0) {
                e.preventDefault();
                activate(index, e.shiftKey);
              }
            }}
            aria-label="Search files or symbols"
            placeholder={
              effectiveMode === "files"
                ? `Jump to file in ${folderName}… (prefix # for code & symbols)`
                : `Search symbols and code in ${folderName}…`
            }
          />
        </div>
        <div className="seg quick-open-mode" role="group" aria-label="Search mode">
          <button
            type="button"
            className={effectiveMode === "files" ? "on" : ""}
            aria-pressed={effectiveMode === "files"}
            onClick={() => {
              setMode("files");
              if (query.startsWith("#")) setQuery(query.slice(1));
              inputRef.current?.focus();
            }}
          >
            Files
          </button>
          <button
            type="button"
            className={effectiveMode === "code" ? "on" : ""}
            aria-pressed={effectiveMode === "code"}
            onClick={() => {
              setMode("code");
              inputRef.current?.focus();
            }}
          >
            Code &amp; Symbols
          </button>
        </div>
      </div>

      {error && (
        <p className="quick-open-status error" role="alert">
          {error}
        </p>
      )}

      <div
        className="quick-open-results"
        role="listbox"
        aria-label={
          effectiveMode === "files" ? "Matching files" : "Matching code and symbols"
        }
      >
        {loading && count === 0 && (
          <p className="quick-open-status" role="status">
            Searching {folderName}…
          </p>
        )}

        {!loading && effectiveMode === "files" && files.length === 0 && !error && (
          <p className="quick-open-status">
            {cleanQuery
              ? `No files matching “${cleanQuery}”.`
              : "Type a file name to jump straight into the editor."}
          </p>
        )}

        {!loading && effectiveMode === "code" && hits.length === 0 && !error && (
          <p className="quick-open-status">
            {cleanQuery
              ? `No indexed code or symbol matches for “${cleanQuery}”.`
              : "Type a function name, symbol, or phrase to search indexed code."}
          </p>
        )}

        {effectiveMode === "files" &&
          files.map((item, i) => {
            const parts = item.path.split("/");
            const name = parts.pop() || item.path;
            const dir = parts.join("/");
            const selected = i === index;
            return (
              <button
                key={item.path}
                type="button"
                role="option"
                aria-selected={selected}
                className={`quick-open-item ${selected ? "selected" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => activate(i)}
              >
                {item.kind === "dir" ? (
                  <Folder size={15} className="quick-open-item-icon" aria-hidden="true" />
                ) : (
                  <FileCode2 size={15} className="quick-open-item-icon" aria-hidden="true" />
                )}
                <span className="quick-open-item-text">
                  <strong>{name}</strong>
                  {dir && <span className="quick-open-dir">{dir}</span>}
                </span>
              </button>
            );
          })}

        {effectiveMode === "code" &&
          hits.map((hit, i) => {
            const selected = i === index;
            const firstLine = (hit.preview || "").split("\n")[0]?.trim() || "";
            return (
              <button
                key={`${hit.path}:${hit.start_line}:${i}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={`quick-open-item quick-open-hit ${selected ? "selected" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => activate(i)}
              >
                <Code2 size={15} className="quick-open-item-icon" aria-hidden="true" />
                <span className="quick-open-item-text">
                  <span className="quick-open-hit-head">
                    <strong>{hit.path}</strong>
                    <span className="quick-open-lines">
                      L{hit.start_line}–{hit.end_line}
                    </span>
                    {hit.symbols && (
                      <span className="quick-open-symbols">{hit.symbols}</span>
                    )}
                  </span>
                  {firstLine && (
                    <code className="quick-open-preview">{firstLine}</code>
                  )}
                </span>
              </button>
            );
          })}
      </div>

      <footer className="quick-open-footer">
        <span>
          <kbd>↑↓</kbd> navigate · <kbd>Enter</kbd> open
          {onAttachFile && (
            <>
              {" "}
              · <kbd>Shift+Enter</kbd> attach to chat
            </>
          )}
        </span>
        {effectiveMode === "code" && searchMode && (
          <span className="quick-open-engine">
            <Sparkles size={12} aria-hidden="true" />
            {searchMode === "hybrid" ? "Hybrid semantic + BM25" : "BM25 index"}
          </span>
        )}
      </footer>
    </Dialog>
  );
}
