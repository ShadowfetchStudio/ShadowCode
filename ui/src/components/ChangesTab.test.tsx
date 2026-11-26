import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { api } from "../api";
import { emptyDrawerMemory } from "../hooks/useDrawerMemory";
import { ChangesTab } from "./ChangesTab";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps a late diff from replacing the selected change or its hunk actions", async () => {
  vi.spyOn(api, "git").mockResolvedValue({
    repo: true,
    status: "",
    log: "",
    diff: "",
    files: [
      { path: "a.ts", label: "M" },
      { path: "b.ts", label: "M" },
    ],
  });
  const diff = (text: string) => ({
    diff: "",
    staged: "",
    hunks: [{ header: "@@ -1 +1 @@", lines: [{ kind: "add", text }] }],
    staged_hunks: [],
    binary: false,
    truncated: false,
    untracked: false,
  });
  let finish!: (value: ReturnType<typeof diff>) => void;
  const read = vi.spyOn(api, "gitDiff").mockImplementation((path) =>
    path === "a.ts"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(diff("second")),
  );
  const ask = vi.fn();
  render(
    <ChangesTab
      path=""
      busy={false}
      toast={vi.fn()}
      onAskAgent={ask}
      memory={emptyDrawerMemory()}
      onMemory={vi.fn()}
    />,
  );
  await waitFor(() => expect(read).toHaveBeenCalledWith("a.ts"));
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Filter changed files" }),
    { target: { value: "B.TS" } },
  );
  expect(await screen.findByText("second")).toBeVisible();
  await act(async () => finish(diff("obsolete")));
  expect(screen.queryByText("obsolete")).toBeNull();
  expect(screen.getByLabelText("1 added lines")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ask agent" }));
  expect(ask).toHaveBeenCalledWith(expect.stringContaining("b.ts:"));
});
