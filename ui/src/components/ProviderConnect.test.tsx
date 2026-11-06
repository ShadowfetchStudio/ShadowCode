import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installFakeBackend } from "../../e2e/fakeBackend";
import { ProviderConnect } from "./ProviderConnect";

let fake: ReturnType<typeof installFakeBackend>;
beforeEach(() => {
  vi.stubEnv("VITE_SHADOW_TEST_TRANSPORT", "1");
  fake = installFakeBackend({ stepMs: 5, firstRun: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete window.__SHADOW_TEST_TRANSPORT__;
});

it("connects Codex from the one-click picker", async () => {
  const onReady = vi.fn();
  render(<ProviderConnect onReady={onReady} />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Codex" }));
  await waitFor(() =>
    expect(
      fake.log.some(
        (r) => r.method === "POST" && r.path === "/api/accounts/codex/connect",
      ),
    ).toBe(true),
  );
});

it("saves an OpenRouter key and asks the keyring to keep it", async () => {
  const onReady = vi.fn();
  render(<ProviderConnect onReady={onReady} />);
  fireEvent.change(await screen.findByLabelText("OpenRouter API key"), {
    target: { value: "sk-or-valid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await waitFor(() =>
    expect(screen.getByText(/OpenRouter API key saved/)).toBeTruthy(),
  );
  expect(onReady).toHaveBeenCalled();
  expect(fake.state.openrouter.key).toBe("sk-or-valid");
  expect(fake.state.keysInKeyring).toContain("OPENROUTER_API_KEY");
});

it("saves an xAI key as a Grok endpoint", async () => {
  const onReady = vi.fn();
  render(<ProviderConnect onReady={onReady} />);
  fireEvent.change(await screen.findByLabelText("API key provider"), {
    target: { value: "grok" },
  });
  fireEvent.change(screen.getByLabelText("xAI (Grok) API key"), {
    target: { value: "xai-example-good" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save key" }));
  await waitFor(() =>
    expect(
      screen.getByText(/xAI \(Grok\) key saved/),
    ).toBeTruthy(),
  );
  expect(onReady).toHaveBeenCalled();
  expect(fake.state.endpointKeys.XAI_API_KEY).toBe("xai-example-good");
  expect(fake.state.keysInKeyring).toContain("XAI_API_KEY");
});
