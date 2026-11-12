import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  localModels: vi.fn(),
  loadLocalModel: vi.fn(),
  unloadLocalModel: vi.fn(),
}));
vi.mock("../../api", () => ({ api }));
vi.mock("../../hooks/useModelDownloads", () => ({
  useModelDownloads: () => ({ catalog: null, loadError: "", pending: "" }),
}));
vi.mock("../ModelDownloads", () => ({ DownloadList: () => null }));
import { LocalModelsPage } from "./LocalModelsPage";
const catalog = {
  runtime: { state: "ready", backend: "metal" },
  hardware: { ram_bytes: 24 * 1024 ** 3, available_bytes: 10 * 1024 ** 3 },
  models: [
    {
      id: "local:gguf:test",
      name: "Test model",
      path: "/models/test.gguf",
      compatible: true,
      bytes: 1000,
    },
  ],
  loaded: null,
};
const loadedCatalog = {
  ...catalog,
  loaded: { id: "local:gguf:test", name: "Test model", backend: "metal" },
};
let finishLoad: (value: unknown) => void;
let failLoad: (reason: Error) => void;
beforeEach(() => {
  vi.resetAllMocks();
  api.localModels.mockResolvedValue(catalog);
  api.loadLocalModel.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        finishLoad = resolve;
        failLoad = reject;
      }),
  );
  api.unloadLocalModel.mockResolvedValue({ ok: true });
});
afterEach(cleanup);
const start = async () => {
  const onToast = vi.fn();
  const onChanged = vi.fn();
  const view = render(
    <LocalModelsPage onToast={onToast} onChanged={onChanged} />,
  );
  await screen.findByRole("button", { name: "Load" });
  return { ...view, onToast, onChanged };
};
it("offers cancellation during manual loading and ignores late success", async () => {
  const { onToast, onChanged } = await start();
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel loading" }),
  );
  await waitFor(() =>
    expect(onToast).toHaveBeenCalledWith("Model loading canceled", "ok"),
  );
  await act(async () =>
    finishLoad({
      local_engine: {
        ...catalog,
        loaded: { id: "local:gguf:test", name: "Late model" },
      },
    }),
  );
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onToast).not.toHaveBeenCalledWith("Test model loaded", "ok");
  expect(screen.queryByText("Late model")).toBeNull();
  expect(api.unloadLocalModel).toHaveBeenCalledTimes(1);
});
it("reports a refused unload without claiming cancellation succeeded", async () => {
  api.unloadLocalModel.mockRejectedValue(
    new Error("A running task is using this model"),
  );
  const { onToast, onChanged } = await start();
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel loading" }),
  );
  await waitFor(() =>
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("A running task"),
      "err",
    ),
  );
  expect(onToast).not.toHaveBeenCalledWith("Model loading canceled", "ok");
  expect(
    screen.getByRole("button", { name: "Loading…" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    screen.getByRole("button", { name: "Remove" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByRole("button", { name: "Cancel loading" })).toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
  api.localModels.mockResolvedValue(loadedCatalog);
  await act(async () => finishLoad({ ok: true, loaded: loadedCatalog.loaded }));
  expect(screen.queryByText("No model loaded")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Unload Test model" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Cancel loading" })).toBeNull();
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onToast).not.toHaveBeenCalledWith("Test model loaded", "ok");
});
it("does not report a stale operation after the settings page closes", async () => {
  const { unmount, onToast, onChanged } = await start();
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  unmount();
  await act(async () => finishLoad({ ok: true }));
  expect(onToast).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
});
it("labels sampled memory and requested placement rather than promising Metal execution", async () => {
  api.localModels.mockResolvedValue({
    ...catalog,
    loaded: {
      id: "other",
      name: "Loaded model",
      backend: "metal",
      context_tokens: 8192,
      in_use: 1,
    },
  });
  await start();
  expect(
    screen.getByText(/sampled when refreshed, not an allocation guarantee/),
  ).toBeTruthy();
  expect(screen.getByText(/metal requested/)).toBeTruthy();
  expect(screen.getByText(/In use by 1 active request/)).toBeTruthy();
});

it.each([false, true])(
  "reconciles a completed load after pending cancellation settles (success: %s)",
  async (succeeds) => {
    let resolveCancel!: (value: unknown) => void;
    let rejectCancel!: (error: Error) => void;
    api.unloadLocalModel.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          resolveCancel = resolve;
          rejectCancel = reject;
        }),
    );
    const { onChanged, onToast } = await start();
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel loading" }),
    );
    api.localModels.mockResolvedValue(loadedCatalog);
    await act(async () =>
      finishLoad({ ok: true, loaded: loadedCatalog.loaded }),
    );
    expect(screen.getByText("Canceling model load…")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => {
      if (succeeds) {
        api.localModels.mockResolvedValue(catalog);
        resolveCancel({ ok: true });
      } else rejectCancel(new Error("Cancel transport failed"));
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Canceling model load…")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove" }).hasAttribute("disabled"),
    ).toBe(false);
    if (succeeds) {
      expect(screen.getByText("No model loaded")).toBeTruthy();
      expect(onToast).toHaveBeenCalledWith("Model loading canceled", "ok");
    } else {
      expect(
        screen
          .getByRole("button", { name: "Unload Test model" })
          .hasAttribute("disabled"),
      ).toBe(false);
      expect(onToast).toHaveBeenCalledWith(
        expect.stringContaining("Cancel transport failed"),
        "err",
      );
      expect(onToast).not.toHaveBeenCalledWith("Model loading canceled", "ok");
    }
    expect(onToast).not.toHaveBeenCalledWith("Test model loaded", "ok");
  },
);
it("allows cancellation retry while the original load is pending", async () => {
  api.unloadLocalModel.mockRejectedValueOnce(new Error("Temporary failure"));
  const { onChanged, onToast } = await start();
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel loading" }),
  );
  await waitFor(() =>
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Temporary failure"),
      "err",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel loading" }));
  await waitFor(() =>
    expect(onToast).toHaveBeenCalledWith("Model loading canceled", "ok"),
  );
  await act(async () => finishLoad({ local_engine: loadedCatalog }));
  expect(screen.getByText("No model loaded")).toBeTruthy();
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(api.unloadLocalModel).toHaveBeenCalledTimes(2);
});
it("settles pending controls if cancellation and the continuing load both fail", async () => {
  api.unloadLocalModel.mockRejectedValue(new Error("Cancel failed"));
  const { onToast } = await start();
  fireEvent.click(screen.getByRole("button", { name: "Load" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Cancel loading" }),
  );
  await waitFor(() =>
    expect(onToast).toHaveBeenCalledWith(
      expect.stringContaining("Cancel failed"),
      "err",
    ),
  );
  await act(async () => failLoad(new Error("Load failed")));
  expect(onToast).toHaveBeenCalledWith(
    expect.stringContaining("Load failed"),
    "err",
  );
  expect(
    screen.getByRole("button", { name: "Load" }).hasAttribute("disabled"),
  ).toBe(false);
  expect(screen.queryByRole("button", { name: "Cancel loading" })).toBeNull();
});
it.each([false, true])(
  "ignores cancel and load completion after unmount (success: %s)",
  async (succeeds) => {
    let resolveCancel!: (value: unknown) => void;
    let rejectCancel!: (error: Error) => void;
    api.unloadLocalModel.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          resolveCancel = resolve;
          rejectCancel = reject;
        }),
    );
    const { unmount, onToast, onChanged } = await start();
    fireEvent.click(screen.getByRole("button", { name: "Load" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel loading" }),
    );
    unmount();
    await act(async () => {
      finishLoad({ ok: true, loaded: loadedCatalog.loaded });
      if (succeeds) resolveCancel({ ok: true });
      else rejectCancel(new Error("Cancel failed"));
    });
    expect(onToast).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(api.localModels).toHaveBeenCalledTimes(1);
  },
);
