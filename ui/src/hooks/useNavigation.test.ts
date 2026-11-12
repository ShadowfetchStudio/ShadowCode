import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, type SessionDetail } from "../api";
import { installFakeBackend } from "../../e2e/fakeBackend";
import { useConversation } from "./useConversation";
import { useNavigation } from "./useNavigation";
import { useWorkspace } from "./useWorkspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
let fake: ReturnType<typeof installFakeBackend>;
beforeEach(() => {
  localStorage.clear();
  vi.stubEnv("VITE_SHADOW_TEST_TRANSPORT", "1");
  fake = installFakeBackend({ onboarding: true });
  const status = api.status;
  // The service status follows the active project; the general UI fixture
  // otherwise always returns its original workspace.
  vi.spyOn(api, "status").mockImplementation(async () => ({
    ...(await status()),
    workspace: fake.state.selected,
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete window.__SHADOW_TEST_TRANSPORT__;
});
async function setup() {
  const callbacks = {
    lanes: { track: vi.fn(), showChat: vi.fn(), note: vi.fn() },
    reloadCatalog: vi.fn(),
    pin: vi.fn(),
    toast: vi.fn(),
    showProjects: vi.fn(),
    closeOverlay: vi.fn(),
    focusPrompt: vi.fn(),
    clearComposer: vi.fn(),
  };
  const jobs = vi.fn();
  const { result } = renderHook(() => {
    const ws = useWorkspace(jobs);
    const conversation = useConversation(jobs);
    const [task, setTask] = useState("");
    const taskRef = useRef(task);
    taskRef.current = task;
    const submittingRef = useRef(false);
    const nav = useNavigation({
      ws,
      conversation,
      taskRef,
      setTask,
      submittingRef,
      submitting: false,
      ...callbacks,
    });
    return { nav, ws, task, setTask };
  });
  await waitFor(() => expect(result.current.nav.ready).toBe(true));
  fake.state.onboarded = true;
  function boot() {
    let done!: Promise<void>;
    act(() => {
      done = result.current.nav.boot();
    });
    return done;
  }
  return { result, callbacks, boot };
}

it("restores the saved conversation and trust normally when no newer choice intervenes", async () => {
  const { result, callbacks, boot } = await setup();
  localStorage.setItem("shadow:selected", "s1");
  await act(async () => {
    await boot();
  });
  expect(result.current.nav.sessionId).toBe("s1");
  expect(fake.state.activeSession).toBe("s1");
  expect(result.current.nav.ready).toBe(true);
  expect(result.current.nav.needsOnboard).toBe(false);
  expect(result.current.nav.switching).toBe(false);
  expect(callbacks.reloadCatalog).toHaveBeenCalledTimes(2);
});

it("does not reactivate a user-selected conversation after an older refresh", async () => {
  const { result, boot } = await setup();
  fake.state.sessions.push({
    ...fake.state.sessions[0],
    id: "s2",
    title: "Chosen",
  });
  const snapshot = await api.projects();
  const held = deferred<typeof snapshot>();
  const projects = vi.spyOn(api, "projects").mockReturnValueOnce(held.promise);
  const activation = vi.spyOn(api, "activateSession");
  const done = boot();
  await waitFor(() => expect(projects).toHaveBeenCalledTimes(1));
  await act(async () => {
    await result.current.nav.openSession("s2");
  });
  await act(async () => {
    held.resolve(snapshot);
    await done;
  });
  expect(result.current.nav.sessionId).toBe("s2");
  expect(fake.state.activeSession).toBe("s2");
  expect(activation.mock.calls.map(([id]) => id)).toEqual(["s2"]);
});

it("rechecks ownership after the hidden-lane fallback lookup", async () => {
  const { result, boot } = await setup();
  const lane: SessionDetail = {
    ...(await api.session("s1")),
    id: "lane",
    compare_id: "comparison",
  };
  localStorage.setItem("shadow:selected", "lane");
  const held = deferred<SessionDetail>();
  const lookup = vi.spyOn(api, "session").mockReturnValueOnce(held.promise);
  const activation = vi.spyOn(api, "activateSession");
  const done = boot();
  await waitFor(() => expect(lookup).toHaveBeenCalledWith("lane"));
  await act(async () => {
    await result.current.nav.newSession();
  });
  await act(async () => {
    held.resolve(lane);
    await done;
  });
  expect(result.current.nav.sessionId).toBe("s2");
  expect(fake.state.activeSession).toBe("s2");
  expect(activation.mock.calls.map(([id]) => id)).toEqual(["s2"]);
  expect(result.current.nav.error).toBe("");
});

it("does not write old workspace or reload its catalog when boot health arrives after navigation", async () => {
  const { result, callbacks, boot } = await setup();
  const snapshot = await api.health();
  const held = deferred<typeof snapshot>();
  const health = vi.spyOn(api, "health").mockReturnValueOnce(held.promise);
  const before = callbacks.reloadCatalog.mock.calls.length;
  const done = boot();
  expect(health).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.nav.newSession({ workspace: "/work/other" });
  });
  await act(async () => {
    held.resolve(snapshot);
    await done;
  });
  expect(result.current.ws.workspace).toBe("/work/other");
  expect(result.current.ws.status?.workspace).toBe("/work/other");
  expect(fake.state.selected).toBe("/work/other");
  expect(callbacks.reloadCatalog).toHaveBeenCalledTimes(before);
  expect(result.current.nav.sessionId).toBe("s2");
});

it.each(["config", "projects"] as const)(
  "does not apply stale workspace state from boot's pending %s response",
  async (method) => {
    const { result, boot } = await setup();
    const snapshot = await api[method]();
    const held = deferred<typeof snapshot>();
    const request = vi.spyOn(api, method).mockReturnValueOnce(held.promise);
    const done = boot();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.nav.newSession({ workspace: "/work/other" });
    });
    await act(async () => {
      held.resolve(snapshot);
      await done;
    });
    expect(result.current.nav.sessionId).toBe("s2");
    expect(result.current.ws.workspace).toBe("/work/other");
    expect(result.current.ws.status?.workspace).toBe("/work/other");
    expect(result.current.ws.sessions.some((s) => s.id === "s2")).toBe(true);
    expect(fake.state.activeSession).toBe("s2");
  },
);

it("ignores a late comparison list and final trust/status response", async () => {
  const { result, callbacks, boot } = await setup();
  const snapshot = await api.status();
  const status = vi.mocked(api.status).getMockImplementation()!;
  vi.mocked(api.status).mockClear();
  const held = deferred<typeof snapshot>();
  const compares = deferred<Awaited<ReturnType<typeof api.compares>>>();
  vi.spyOn(api, "compares").mockReturnValueOnce(compares.promise);
  let calls = 0;
  const requests = vi.spyOn(api, "status").mockImplementation(() => {
    calls++;
    // config, initial refresh, restored-session refresh, final boot status
    return calls === 4 ? held.promise : status();
  });
  const done = boot();
  await waitFor(() => expect(requests).toHaveBeenCalledTimes(4));
  await act(async () => {
    await result.current.nav.newSession({ workspace: "/work/other" });
  });
  const notes = callbacks.lanes.note.mock.calls.length;
  await act(async () => {
    compares.resolve({ compares: [] });
    held.resolve({ ...snapshot, trusted: false });
    await done;
  });
  expect(result.current.ws.status?.workspace).toBe("/work/other");
  expect(result.current.nav.trust).toBeNull();
  expect(callbacks.lanes.note).toHaveBeenCalledTimes(notes);
  expect(fake.state.activeSession).toBe("s2");
});

it("a pending project choice owns navigation before its native open completes", async () => {
  const { result, boot } = await setup();
  const snapshot = await api.projects();
  const held = deferred<typeof snapshot>();
  const refresh = vi.spyOn(api, "projects").mockReturnValueOnce(held.promise);
  const project = deferred<Awaited<ReturnType<typeof api.openProject>>>();
  const opening = vi
    .spyOn(api, "openProject")
    .mockImplementationOnce(async () => {
      const opened = await project.promise;
      fake.state.sessions.push({
        ...fake.state.sessions[0],
        id: "other",
        workspace: opened.path,
      });
      fake.state.selected = opened.path;
      fake.state.activeSession = "other";
      return opened;
    });
  const activation = vi.spyOn(api, "activateSession");
  const done = boot();
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  let picked!: Promise<void>;
  act(() => {
    picked = result.current.nav.pickProject("/work/other");
  });
  await waitFor(() => expect(opening).toHaveBeenCalledTimes(1));
  await act(async () => {
    held.resolve(snapshot);
    await done;
  });
  expect(activation).not.toHaveBeenCalled();
  await act(async () => {
    project.resolve({ path: "/work/other", session_id: "other" });
    await picked;
  });
  expect(result.current.nav.sessionId).toBe("other");
  expect(result.current.ws.workspace).toBe("/work/other");
  expect(fake.state.activeSession).toBe("other");
  expect(result.current.nav.switching).toBe(false);
});

it("keeps a later conversation active in React and the service after a slow project open", async () => {
  const { result } = await setup();
  const project = deferred<Awaited<ReturnType<typeof api.openProject>>>();
  const opening = vi
    .spyOn(api, "openProject")
    .mockImplementationOnce(async () => {
      const opened = await project.promise;
      fake.state.sessions.push({
        ...fake.state.sessions[0],
        id: "other",
        workspace: opened.path,
      });
      fake.state.selected = opened.path;
      fake.state.activeSession = "other";
      return opened;
    });
  const activation = vi.spyOn(api, "activateSession");
  let picked!: Promise<void>;
  let selected!: Promise<void>;
  act(() => {
    picked = result.current.nav.pickProject("/work/other");
  });
  await waitFor(() => expect(opening).toHaveBeenCalledTimes(1));
  act(() => {
    selected = result.current.nav.openSession("s1");
  });
  // A service activation cannot overtake the project operation that itself
  // activates. No timer or transient UI observation controls completion.
  expect(activation).not.toHaveBeenCalled();
  await act(async () => {
    project.resolve({ path: "/work/other", session_id: "other" });
    await Promise.all([picked, selected]);
  });
  expect(result.current.nav.sessionId).toBe("s1");
  expect(result.current.ws.workspace).toBe("/work/demo");
  expect(fake.state.activeSession).toBe("s1");
  expect(fake.state.selected).toBe("/work/demo");
  expect(activation.mock.calls.map(([id]) => id)).toEqual(["s1"]);
  expect(result.current.nav.switching).toBe(false);
});

it("still restores a saved hidden comparison lane when boot owns navigation", async () => {
  const { result, boot } = await setup();
  fake.state.sessions.push({
    ...fake.state.sessions[0],
    id: "lane",
    compare_id: "comparison",
  });
  localStorage.setItem("shadow:selected", "lane");
  await act(async () => {
    await boot();
  });
  expect(result.current.nav.sessionId).toBe("lane");
  expect(fake.state.activeSession).toBe("lane");
  expect(result.current.nav.error).toBe("");
});

it("keeps the explicit trust prompt without activating an untrusted project", async () => {
  const { result } = await setup();
  vi.spyOn(api, "openProject").mockResolvedValueOnce({
    path: "/work/untrusted",
    session_id: "",
    needs_trust: true,
    permissions: { mode: "ask" },
  });
  const activation = vi.spyOn(api, "activateSession");
  await act(async () => {
    await result.current.nav.pickProject("/work/untrusted");
  });
  expect(result.current.nav.trust).toEqual({
    path: "/work/untrusted",
    name: undefined,
    permissions: { mode: "ask" },
  });
  expect(activation).not.toHaveBeenCalled();
  expect(result.current.nav.switching).toBe(false);
});
