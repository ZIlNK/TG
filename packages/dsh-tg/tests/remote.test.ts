import { test } from "node:test";
import assert from "node:assert/strict";
import { gameApi, remoteContribution, type GameWireRemote } from "../src/rpc";
test("client unwraps official RemoteResult success and displays gateway failure", async () => {
  const api = gameApi({
    models: async () => ({
      ok: true,
      value: [{ provider: "test", model: "a", label: "测试" }],
    }),
    listGames: async () => ({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "连接断开" },
    }),
  } as unknown as GameWireRemote);
  assert.equal((await api.models({}))[0].model, "a");
  await assert.rejects(api.listGames({}), /连接断开/);
});

test("desktop and legacy Remote codecs both validate action revisions and save slots", () => {
  for (const [method, valid, invalid] of [
    [
      "submitAction",
      { gameId: "g", requestId: "r", expectedRevision: 0, input: "等待5分钟" },
      { gameId: "g", requestId: "r", expectedRevision: -1 },
    ],
    ["exportSave", { slot: 7 }, { slot: 8 }],
  ] as const) {
    const descriptor = remoteContribution.descriptors.find(
      (d) => d.method === method,
    )!;
    const codec = descriptor.parameters[0].codec;
    assert.equal(codec.mode, "strict");
    if (codec.mode !== "strict") throw new Error("Expected strict boundary");
    const legacy = codec as typeof codec & {
      schema: { parse(value: unknown): unknown };
    };
    assert.deepEqual(codec.create().parse(valid), legacy.schema.parse(valid));
    assert.throws(() => codec.create().parse(invalid));
    assert.throws(() => legacy.schema.parse(invalid));
  }
});
