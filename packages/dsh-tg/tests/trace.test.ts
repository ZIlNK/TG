import { test } from "node:test";
import assert from "node:assert/strict";
import type { Context } from "@deepseek-ai/cordis";
import { TraceService } from "../src/host/trace";
import { type Attempt, changes } from "../src/core/trace";

const attempt: Attempt = {
  sessionId: "s",
  gameId: "g",
  actionId: "a",
  generation: 1,
  stage: "plan",
  npcId: "",
  input: "等待",
  provider: "p",
  model: "m",
  started: "2026-10-19",
  ended: "",
  status: "running",
  error: "",
};
function fixture(fail = false) {
  const rows = new Map<string, Attempt>();
  const observed = { opens: 0, closes: 0 };
  const events = Array.from({ length: 103 }, (_, seq) => ({
    seq,
    type: "tool/result",
    data: { message: "STAGED" },
  }));
  const ctx = {
    sessionPersistence: {
      open: async (id: string, mode: string) => {
        assert.equal(id, "s");
        assert.equal(mode, "read");
        observed.opens++;
        return {
          read: async (offset: number, length: number) => {
            if (fail) throw new Error("disk unavailable");
            return { events: events.slice(offset, offset + length) };
          },
          close: async () => {
            observed.closes++;
          },
        };
      },
    },
  } as unknown as Context;
  const service = new TraceService(ctx, {
    all: () => [...rows.values()],
    get: (id) => rows.get(id),
    put: async (a) => {
      rows.set(a.sessionId, structuredClone(a));
    },
  });
  return { service, observed, events, rows };
}
test("trace reads are game-scoped, paginated, read-only and close their handles", async () => {
  const { service, observed, events } = fixture();
  await service.start(attempt);
  await assert.rejects(service.events("other", "s", 0, 100), /不属于/);
  await assert.rejects(service.events("g", "s", -1, 100), /分页/);
  assert.equal(observed.opens, 0);
  const first = await service.events("g", "s", 0, 100);
  assert.equal(first.more, true);
  assert.equal(first.next, 100);
  const second = await service.events("g", "s", first.next, 100);
  assert.deepEqual([...first.events, ...second.events], events);
  assert.equal(second.more, false);
  assert.equal(observed.closes, 2);
});
test("live events use the current session, finished sessions use native persistence", async () => {
  const { service, observed } = fixture();
  await service.start(attempt);
  service.attach("s", () => [{ type: "user/message", data: "live" }]);
  assert.equal((await service.events("g", "s", 0, 100)).events.length, 1);
  assert.equal(observed.opens, 0);
  await service.finish({ ...attempt, status: "completed" });
  await service.events("g", "s", 0, 100);
  assert.equal(observed.opens, 1);
});
test("missing logs are explicit and interrupted attempts remain distinct after retry", async () => {
  const { service, observed } = fixture(true);
  await service.start(attempt);
  assert.match(
    (await service.events("g", "s", 0, 10)).error,
    /disk unavailable/,
  );
  assert.equal(observed.closes, 1);
  await service.recover();
  await service.start({ ...attempt, sessionId: "retry", generation: 2 });
  assert.equal(service.list("g").length, 2);
  assert.equal(
    service.list("g").find((a) => a.sessionId === "s")?.status,
    "interrupted",
  );
});
test("settlement diff records removed items and exact time changes without prompts", () => {
  assert.deepEqual(
    changes(
      { minute: 1435, inventory: { photo: 1 } },
      { minute: 1450, inventory: {} },
    ),
    [
      { path: "world.minute", before: 1435, after: 1450 },
      { path: "world.inventory.photo", before: 1, after: null },
    ],
  );
});
