import type { SessionMatch } from "../api";

/** Where a task search matched a conversation: an excerpt of the prompt or
 * the agent's answer with the words marked (GET /api/sessions?q=). */
export function SearchSnippet({ match }: { match: SessionMatch }) {
  // The engine counts characters (code points), as Array.from does.
  const chars = Array.from(match.snippet);
  return (
    <small className="search-snippet">
      <span className="search-snippet-field">
        {match.field === "answer" ? "Answer" : "You"} ·{" "}
      </span>
      {chars.slice(0, match.start).join("")}
      <mark>{chars.slice(match.start, match.end).join("")}</mark>
      {chars.slice(match.end).join("")}
    </small>
  );
}
