import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QuickOpen } from "./QuickOpen";
import { api } from "../api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("QuickOpen", () => {
  it("searches files via mentions and opens selected file on Enter", async () => {
    vi.spyOn(api, "mentions").mockResolvedValue({
      items: [
        { path: "src/App.tsx", kind: "file" },
        { path: "src/main.tsx", kind: "file" },
      ],
      truncated: false,
    });

    const onOpenFile = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickOpen
        workspace="/work/demo"
        onOpenFile={onOpenFile}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("App.tsx")).toBeInTheDocument();
    });

    const input = screen.getByRole("combobox", {
      name: "Search files or symbols",
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onOpenFile).toHaveBeenCalledWith("src/main.tsx");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("switches to hybrid code search when typing # prefix and jumps to line", async () => {
    vi.spyOn(api, "mentions").mockResolvedValue({
      items: [],
      truncated: false,
    });
    const searchSpy = vi.spyOn(api, "codeSearch").mockResolvedValue({
      ok: true,
      query: "shortcutFor",
      mode: "hybrid",
      count: 1,
      hits: [
        {
          path: "src/hooks/useShortcuts.ts",
          start_line: 41,
          end_line: 55,
          score: 0.92,
          symbols: "shortcutFor",
          preview: "export function shortcutFor(e, open) {",
        },
      ],
    });

    const onOpenFile = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickOpen
        workspace="/work/demo"
        onOpenFile={onOpenFile}
        onClose={onClose}
      />,
    );

    const input = screen.getByRole("combobox", {
      name: "Search files or symbols",
    });
    fireEvent.change(input, { target: { value: "#shortcutFor" } });

    await waitFor(() => {
      expect(searchSpy).toHaveBeenCalledWith("shortcutFor", 14);
      expect(screen.getByText("src/hooks/useShortcuts.ts")).toBeInTheDocument();
      expect(screen.getByText("L41–55")).toBeInTheDocument();
      expect(screen.getByText("Hybrid semantic + BM25")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("option"));
    expect(onOpenFile).toHaveBeenCalledWith("src/hooks/useShortcuts.ts", 41);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

it("searches the filename without its line suffix and drops stale matches while typing", async () => {
  const mentions = vi
    .spyOn(api, "mentions")
    .mockResolvedValueOnce({
      items: [{ path: "old.md", kind: "file" }],
      truncated: false,
    })
    .mockResolvedValue({
      items: [{ path: "docs/Guide.md", kind: "file" }],
      truncated: false,
    });
  const open = vi.fn();
  render(
    <QuickOpen
      workspace="C:\\work\\demo"
      onOpenFile={open}
      onClose={vi.fn()}
    />,
  );
  expect(await screen.findByText("old.md")).toBeVisible();
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "Guide:17" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).not.toHaveBeenCalled();
  expect(await screen.findByText("Guide.md")).toBeVisible();
  expect(mentions).toHaveBeenLastCalledWith("Guide", 24);
  expect(screen.getByText("demo")).toBeVisible();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).toHaveBeenCalledWith("docs/Guide.md", 17);
});
