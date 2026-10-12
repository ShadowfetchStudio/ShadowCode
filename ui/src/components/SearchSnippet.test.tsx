import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchSnippet } from "./SearchSnippet";

describe("SearchSnippet", () => {
  it("marks the match by character, not UTF-16 unit", () => {
    // "🦀" is one character but two UTF-16 units; the engine counts
    // characters.
    const { container } = render(
      <SearchSnippet
        match={{
          field: "answer",
          snippet: "…🦀 Größe changed in parser.rs",
          start: 3,
          end: 8,
        }}
      />,
    );
    expect(container.querySelector("mark")?.textContent).toBe("Größe");
    expect(container.textContent).toBe(
      "Answer · …🦀 Größe changed in parser.rs",
    );
  });

  it("names a prompt match as yours", () => {
    const { container } = render(
      <SearchSnippet
        match={{ field: "prompt", snippet: "Fix the bug", start: 8, end: 11 }}
      />,
    );
    expect(container.textContent).toBe("You · Fix the bug");
    expect(container.querySelector("mark")?.textContent).toBe("bug");
  });
});
