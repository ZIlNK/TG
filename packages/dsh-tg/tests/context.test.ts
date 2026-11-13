import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame } from "../src/core/world";
import { applyPlan, applyReply } from "../src/core/rules";
import { PlanSchema, validateGame, type Game } from "../src/core/schema";
import {
  buildActionContext,
  buildNpcContext,
  buildSceneContext,
  queryContext,
} from "../src/core/context";

const initial = (): Game =>
  createGame("context-test", "测试", { provider: "test", model: "test" });
const plan = (groups: unknown[][]) =>
  PlanSchema.parse({ decision: "act", message: "", groups });
test("scene and NPC experiences have a single list and all stages use explicit game time", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world = applyPlan(
    g,
    plan([[{ kind: "talk", target: "linwanqing", text: "测试台词" }]]),
    "talk",
  ).world;
  g.world.minute = 500;
  g.scene.description = "STALE_SCENE";
  const scene = buildSceneContext(g);
  assert.equal("currentEvents" in scene, false);
  assert.equal("previousScene" in scene, false);
  assert.ok(!JSON.stringify(scene).includes("STALE_SCENE"));
  assert.equal(
    scene.memories.filter((m) => m.text.includes("测试台词")).length,
    1,
  );
  const npc = buildNpcContext(g, "linwanqing");
  assert.equal("trigger" in npc, false);
  for (const context of [scene, npc, buildActionContext(g, "等待")]) {
    assert.deepEqual(context.time, {
      label: "第 1 天 · 08:20",
      period: "上午",
    });
    assert.equal(context.minute, 500);
  }
  g.world.minute = 1435;
  g.world = applyPlan(
    g,
    plan([[{ kind: "wait", minutes: 15 }]]),
    "midnight",
  ).world;
  assert.deepEqual(buildSceneContext(g).time, {
    label: "第 2 天 · 00:10",
    period: "凌晨",
  });
});
test("investigation records private observation, delivery records observation separately from speech", () => {
  const g = initial();
  g.world.location = "Park/park_path";
  const before = structuredClone(g);
  const found = applyPlan(g, plan([[{ kind: "investigate" }]]), "find");
  assert.deepEqual(g, before); // Tool preflight is side-effect free.
  assert.deepEqual(found.world.memories?.[0].knownBy, ["player"]);
  assert.ok(found.world.memories?.[0].relatedItemIds.includes("photo"));
  g.world = found.world;
  g.world.location = "Park/park_entrance";
  assert.ok(
    !JSON.stringify(buildNpcContext(g, "linwanqing")).includes(
      "在长椅附近找到了",
    ),
  );
  g.world = applyPlan(
    g,
    plan([
      [
        {
          kind: "deliver",
          target: "linwanqing",
          item: "photo",
          text: "我听别人说这是你的。",
        },
      ],
    ]),
    "deliver",
  ).world;
  const records = g.world.memories!.filter((m) => m.actionId === "deliver");
  assert.equal(records.length, 2);
  assert.equal(records[0].kind, "action_result");
  assert.equal(records[1].kind, "dialogue");
  assert.equal(records[1].speakerId, "player");
  assert.deepEqual(records[0].knownBy, ["player", "linwanqing"]);
  assert.ok(
    JSON.stringify(buildNpcContext(g, "linwanqing")).includes(
      "已将晚晴的合影交给",
    ),
  );
  validateGame(g);
});
test("failed multi-step plans and invalid replies leave no effects or experiences", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  const before = structuredClone(g);
  assert.throws(() =>
    applyPlan(
      g,
      plan([
        [{ kind: "talk", target: "linwanqing", text: "你好" }],
        [{ kind: "deliver", target: "linwanqing", item: "photo" }],
      ]),
      "bad",
    ),
  );
  assert.deepEqual(g, before);
  assert.throws(() =>
    applyReply(
      g,
      "linwanqing",
      {
        text: "送给你",
        relationship: 1,
        offers: [
          {
            kind: "gift",
            message: "礼物",
            item: "missing",
            quantity: 1,
            quest: null,
          },
        ],
      },
      "bad-reply",
    ),
  );
  assert.deepEqual(g, before);
});
test("stages and scoped queries exclude private profiles, unrelated history and audit data", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world.npcs.linwanqing.profile = "PRIVATE_PROFILE";
  g.world.npcs.hunter.knowledge.push("OTHER_NPC_SECRET");
  g.world.events.push({ minute: 0, text: "UNRELATED_EVENT", actionId: "old" });
  g.world.facts.push("HIDDEN_FACT");
  g.world = applyReply(
    g,
    "linwanqing",
    { text: "你好，我是晚晴。", relationship: 0, offers: [] },
    "hello",
  );
  const memory = g.world.memories![0];
  g.world.memories!.push({
    ...memory,
    id: "private",
    text: "NPC_ONLY_SECRET",
    knownBy: ["linwanqing"],
  });
  for (const value of [
    buildActionContext(g, "问问她"),
    buildSceneContext(g),
    queryContext(g, "plan", "NPC_ONLY"),
    queryContext(g, "scene", "NPC_ONLY"),
  ]) {
    const text = JSON.stringify(value);
    for (const secret of [
      "PRIVATE_PROFILE",
      "OTHER_NPC_SECRET",
      "UNRELATED_EVENT",
      "HIDDEN_FACT",
      "NPC_ONLY_SECRET",
    ])
      assert.ok(!text.includes(secret), secret);
  }
  const npc = JSON.stringify(
    queryContext(g, "reply", "NPC_ONLY_SECRET", "linwanqing"),
  );
  assert.ok(npc.includes("NPC_ONLY_SECRET"));
  assert.ok(!npc.includes("OTHER_NPC_SECRET"));
  assert.throws(() => queryContext(g, "reply", "secret"), /身份/);
});
test("older permitted experiences remain queryable; old saves need no fabricated migration", () => {
  const g = initial();
  assert.equal(validateGame(g).world.memories, undefined);
  g.world = applyPlan(g, plan([[{ kind: "wait", minutes: 5 }]]), "old").world;
  const base = g.world.memories![0];
  g.world.memories = Array.from({ length: 40 }, (_, i) => ({
    ...base,
    id: `m${i}`,
    text: i === 0 ? "早期口令" : `后续经历${i}`,
  }));
  assert.equal(buildActionContext(g, "等待").memories.length, 30);
  assert.equal(
    queryContext(g, "plan", "早期口令").matchingMemories[0].text,
    "早期口令",
  );
  g.world.memories[0].knownBy = ["missing-npc"];
  assert.throws(() => validateGame(g), /经历记录/);
});
