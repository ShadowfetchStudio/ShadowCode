import { useEffect, useLayoutEffect, useRef } from "react";
import { ChevronDown, ChevronUp, LoaderCircle, Search, X } from "lucide-react";
import "../../find.css";

/** Keys inside a terminal, a dialog or a code editor (its own F3) are not
 * find's. */
const OWNED = '[data-terminal], [aria-modal="true"], .cm-editor';

/** The Find in conversation bar (Ctrl+F): the query, "3 of 12", previous,
 * next and close. Enter / Shift+Enter and F3 / Shift+F3 step through the
 * matches; Escape closes and puts focus back where it was. */
export function FindBar({
  query,
  onQuery,
  label,
  total,
  searching,
  error,
  focusRequest,
  onNext,
  onPrevious,
  onClose,
}: {
  query: string;
  onQuery: (query: string) => void;
  /** "3 of 12", "No matches"; empty before a query. */
  label: string;
  total: number;
  /** Saved pages are still being read. */
  searching: boolean;
  /** Saved pages could not be read. */
  error: string;
  /** Changes on each Ctrl+F: focus and select the query again. */
  focusRequest: number;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Where focus was when find opened (read after a closing command palette
  // has put it back); it returns there when find closes from inside.
  const before = useRef<HTMLElement | null>(null);
  useEffect(() => {
    before.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, []);
  useLayoutEffect(() => {
    const container = bar.current;
    return () => {
      const previous = before.current;
      if (previous?.isConnected && container?.contains(document.activeElement))
        previous.focus();
    };
  }, []);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusRequest]);
  const steps = useRef({ onNext, onPrevious });
  steps.current = { onNext, onPrevious };
  // F3 steps through matches wherever focus is, while the bar is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F3" || e.defaultPrevented || e.ctrlKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(OWNED)) return;
      e.preventDefault();
      if (e.shiftKey) steps.current.onPrevious();
      else steps.current.onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div
      ref={bar}
      className="find-bar"
      role="search"
      aria-label="Find in conversation"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <Search size={14} className="find-icon" aria-hidden="true" />
      <input
        ref={input}
        className="find-input"
        type="text"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label="Find in conversation"
        placeholder="Find in conversation"
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="search"
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          if (e.shiftKey) onPrevious();
          else onNext();
        }}
      />
      <span
        className="find-count"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {label}
        {searching && label && label !== "Searching…" && (
          <span className="sr-only">, searching older messages</span>
        )}
      </span>
      {searching && (
        <LoaderCircle
          size={13}
          className="spin find-searching"
          aria-hidden="true"
        />
      )}
      {error && (
        <span className="find-error" role="alert" title={error}>
          Older messages unavailable
        </span>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label="Previous match"
        title="Previous match (Shift+Enter)"
        disabled={!total}
        onClick={onPrevious}
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Next match"
        title="Next match (Enter)"
        disabled={!total}
        onClick={onNext}
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label="Close find"
        title="Close (Esc)"
        onClick={onClose}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
