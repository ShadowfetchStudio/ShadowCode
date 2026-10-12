import { expect, it } from "vitest";
import type { EventRow } from "../api";
import { replay } from "./transcript";
import { compactStreamRows } from "./jobEvents";

const event = (
  id: number,
  ts: number,
  type: string,
  payload: Record<string, unknown> = {},
  task_id = "one",
): EventRow => ({ id, ts, type, payload, task_id });

const messages = (rows: EventRow[]) =>
  replay(rows).items.filter(
    (item) => item.kind === "user" || item.kind === "agent",
  );

it("prompts and answers keep the time their events were recorded", () => {
  const items = messages([
    event(1, 1_790_000_000.5, "user.message", { text: "Fix add" }),
    event(2, 1_790_000_001, "agent.started", { task: "Fix add" }),
    event(3, 1_790_000_030, "model.stream", { text: "Fix", message_id: "m" }),
    event(4, 1_790_000_031, "model.stream", { text: "ed", message_id: "m" }),
    // The final reply replaces the streamed text: the answer's time.
    event(5, 1_790_000_032, "model.delta", { text: "Fixed", message_id: "m" }),
    event(6, 1_790_000_033, "model.stream_end", { message_id: "m" }),
    event(7, 1_790_000_040, "agent.completed", {
      summary: "Tests fail",
      success: false,
    }),
  ]);
  expect(items).toMatchObject([
    { kind: "user", text: "Fix add", ts: 1_790_000_000.5 },
    { kind: "agent", text: "Fixed", ts: 1_790_000_032 },
    { kind: "agent", text: "Tests fail", ts: 1_790_000_040 },
  ]);
});

it("a streamed answer reads the same from merged fragments", () => {
  const rows = [
    event(1, 1_790_000_010, "model.stream", { text: "Fix", message_id: "m" }),
    event(2, 1_790_000_012, "model.stream", { text: "ed", message_id: "m" }),
  ];
  const [answer] = messages(rows);
  const [merged] = messages(compactStreamRows(rows, 0));
  expect(answer).toMatchObject({ text: "Fixed", ts: 1_790_000_012 });
  expect(merged).toEqual(answer);
});

it("a prompt recorded only by agent.started takes that event's time", () => {
  const [prompt] = messages([
    event(1, 1_790_000_100, "agent.started", { task: "Older record" }),
  ]);
  expect(prompt).toMatchObject({ kind: "user", ts: 1_790_000_100 });
});

it("an event without a usable time gives its message none", () => {
  const items = messages([
    event(1, 0, "user.message", { text: "No time" }),
    event(2, Number.NaN, "model.delta", { text: "Answer", message_id: "a" }),
  ]);
  expect(items.map((item) => "ts" in item && item.ts)).toEqual([
    undefined,
    undefined,
  ]);
});
