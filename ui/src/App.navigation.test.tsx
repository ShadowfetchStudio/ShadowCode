import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./api";
import { installFakeBackend } from "../e2e/fakeBackend";

beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_SHADOW_TEST_TRANSPORT", "1");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.__SHADOW_TEST_TRANSPORT__;
});

it("keeps the user's new conversation when post-onboarding boot refresh finishes late", async () => {
  const fake = installFakeBackend({ onboarding: true });
  render(<App />);
  const open = await screen.findByRole("button", { name: "Open project" });
  await waitFor(() => expect(open).toHaveProperty("disabled", false));
  const projects = await api.projects();
  let release!: (value: typeof projects) => void;
  const held = new Promise<typeof projects>((resolve) => {
    release = resolve;
  });
  const refresh = vi.spyOn(api, "projects").mockReturnValueOnce(held);
  const activation = vi.spyOn(api, "activateSession");
  fireEvent.click(open);
  await screen.findByRole("textbox", { name: "Message ShadowCode" });
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  fireEvent.click(
    document.querySelector<HTMLButtonElement>("button.new-task")!,
  );
  await waitFor(() => expect(fake.state.activeSession).toBe("s2"));
  const selected = () =>
    document.querySelector('button[data-session-id="s2"][aria-current="page"]');
  await waitFor(() => expect(selected()).not.toBeNull());
  fireEvent.change(
    screen.getByRole("textbox", { name: "Message ShadowCode" }),
    { target: { value: "Keep my new conversation draft" } },
  );
  await act(async () => {
    release(projects);
    await held;
  });
  expect(selected()).not.toBeNull();
  expect(fake.state.activeSession).toBe("s2");
  expect(localStorage.getItem("shadow:selected")).toBe("s2");
  expect(activation.mock.calls.map(([id]) => id)).toEqual(["s2"]);
  expect(
    screen.getByRole("textbox", { name: "Message ShadowCode" }),
  ).toHaveProperty("value", "Keep my new conversation draft");
});
