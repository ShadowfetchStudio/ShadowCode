import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../api", () => ({
  api: { sessions: vi.fn(async () => ({ sessions: [] })) },
}));

import { Drawer, type DrawerTab } from "./Drawer";
import { emptyDrawerMemory } from "../hooks/useDrawerMemory";

afterEach(cleanup);

function renderDrawer(tab: DrawerTab, onTab = vi.fn()) {
  render(
    <Drawer
      tab={tab}
      onTab={onTab}
      onClose={() => undefined}
      workspace="/work/demo"
      sessions={[]}
      sessionId=""
      onOpenSession={() => undefined}
      onNewSession={() => undefined}
      onRefreshSessions={async () => undefined}
      diffPath=""
      onDiffPath={() => undefined}
      busy={false}
      toast={() => undefined}
      memory={{ ...emptyDrawerMemory(), toolsView: "issues" }}
      onMemory={() => undefined}
      onDiscardFileDraft={async () => undefined}
      onResolveFileDraftConflict={async () => undefined}
    />,
  );
  return onTab;
}

const tab = (name: string) => screen.getByRole("tab", { name });

it("is a tab list whose selected tab labels the panel", () => {
  renderDrawer("sessions");
  const list = screen.getByRole("tablist", { name: "Panels" });
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual([
    "Changes",
    "Git",
    "Terminal",
    "Preview",
    "Files",
    "Tasks",
    "Tools",
  ]);
  expect(tabs.every((t) => list.contains(t))).toBe(true);
  expect(tab("Tasks").getAttribute("aria-selected")).toBe("true");
  expect(tab("Git").getAttribute("aria-selected")).toBe("false");
  // One tab stop: the selected tab.
  expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([tab("Tasks")]);
  const panel = screen.getByRole("tabpanel", { name: "Tasks" });
  expect(tabs.every((t) => t.getAttribute("aria-controls") === panel.id)).toBe(
    true,
  );
  expect(panel.querySelector("[aria-pressed]")).toBeNull();
  expect(list.querySelector("[aria-pressed]")).toBeNull();
});

it("selects Tools for any tool view", () => {
  renderDrawer("automations");
  expect(tab("Tools").getAttribute("aria-selected")).toBe("true");
  expect(tab("Tools").tabIndex).toBe(0);
  expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
    tab("Tools").id,
  );
});

it("moves focus with the arrows, Home and End; Enter or a click opens", () => {
  const onTab = renderDrawer("sessions");
  tab("Tasks").focus();
  fireEvent.keyDown(tab("Tasks"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(tab("Tools"));
  fireEvent.keyDown(tab("Tools"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(tab("Changes"));
  fireEvent.keyDown(tab("Changes"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(tab("Tools"));
  fireEvent.keyDown(tab("Tools"), { key: "Home" });
  expect(document.activeElement).toBe(tab("Changes"));
  fireEvent.keyDown(tab("Changes"), { key: "End" });
  expect(document.activeElement).toBe(tab("Tools"));
  // Moving focus does not open a tab (a terminal would start).
  expect(onTab).not.toHaveBeenCalled();
  fireEvent.keyDown(tab("Tools"), { key: "ArrowLeft" });
  fireEvent.keyDown(tab("Tasks"), { key: "ArrowLeft" });
  expect(document.activeElement).toBe(tab("Files"));
  fireEvent.click(tab("Files"));
  expect(onTab).toHaveBeenCalledWith("files");
  // Tools opens the view it showed last.
  fireEvent.click(tab("Tools"));
  expect(onTab).toHaveBeenLastCalledWith("issues");
});
