import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import {
  GameService,
  type ModelRunner,
  type Stage,
  type Store,
} from "../src/core/service";
import {
  PlanSchema,
  validateGame,
  type Game,
  type Save,
} from "../src/core/schema";
import { createGame, photoQuest } from "../src/core/world";
import { applyPlan, applyReply, copy, npcContext } from "../src/core/rules";
import { ambientOpportunity } from "../src/core/rules";

const model = { provider: "test", model: "controlled" };
const scene = {
  description: "当前现场",
  options: [
    { label: "调查", input: "调查现场" },
    { label: "等待", input: "等待5分钟" },
  ],
};
const reply = { text: "谢谢，我记住了。", relationship: 1, offers: [] };
const plan = (groups: unknown[][]) =>
  PlanSchema.parse({ decision: "act", message: "", groups });
const initial = (): Game => createGame("test-game", "测试旅人", model);
class MemoryStore implements Store {
  records = new Map<string, Game>();
  slots = new Map<number, Save>();
  failNext = false;
  games(): Game[] {
    return [...this.records.values()].map(copy);
  }
  get(id: string): Game | undefined {
    const g = this.records.get(id);
    return g && copy(g);
  }
  async put(game: Game): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("disk failure");
    }
    this.records.set(game.id, copy(game));
  }
  saves(): Save[] {
    return [...this.slots.values()].map(copy);
  }
  async save(value: Save): Promise<void> {
    this.slots.set(value.slot, copy(value));
  }
}
function fixture(
  handler: ModelRunner["run"],
  game = initial(),
): { service: GameService; store: MemoryStore } {
  const store = new MemoryStore();
  store.records.set(game.id, copy(game));
  return { store, service: new GameService(store, { run: handler }) };
}
async function submit(
  service: GameService,
  id = "a",
  input = "调查现场",
  optionId?: string,
): Promise<Game> {
  const g = service.getGame("test-game");
  await service.submitAction({
    gameId: g.id,
    requestId: id,
    expectedRevision: g.revision,
    input,
    optionId,
  });
  await service.whenIdle(g.id);
  return service.getGame(g.id);
}
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await pause(2);
  }
  throw new Error("test timeout");
}
function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((r) => {
      resolve = r;
    }),
    resolve,
  };
}

test("all migrated locations and NPCs form a valid initial world", () => {
  const g = validateGame(initial());
  assert.equal(Object.keys(g.world.locations).length, 12);
  assert.ok(g.world.npcs.hunter);
  assert.ok(g.world.npcs.linwanqing);
});
test("23:55 + 15 minutes retains location and investigation across midnight; no free healing", () => {
  const g = initial();
  g.world.minute = 1435;
  g.world.location = "Park/park_path";
  g.world.stats.stamina = 35;
  g.world.investigations[g.world.location] = ["已有线索"];
  const result = applyPlan(
    g,
    plan([[{ kind: "investigate", minutes: 15, text: "查看长椅" }]]),
    "a",
  );
  assert.equal(result.world.minute, 1450);
  assert.equal(result.world.location, g.world.location);
  assert.equal(result.world.stats.stamina, 35);
  assert.equal(result.world.investigations[g.world.location].length, 2);
  assert.equal(result.world.inventory.photo, 1);
  validateGame({ ...g, world: result.world });
});
test("simultaneous delivery and explanation cost max duration, sequential steps sum", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world.inventory.photo = 1;
  const steps = [
    { kind: "deliver", target: "linwanqing", item: "photo" },
    { kind: "talk", target: "linwanqing", text: "我在长椅旁找到的。" },
  ];
  assert.equal(applyPlan(g, plan([steps]), "a").minutes, 1);
  assert.equal(applyPlan(g, plan(steps.map((s) => [s])), "a").minutes, 2);
  assert.equal(g.world.inventory.photo, 1, "pure core must not mutate input");
});
test("missing item rejects entire action, including earlier tentative draft effects", () => {
  const g = initial();
  const before = copy(g);
  assert.throws(() =>
    applyPlan(
      g,
      plan([
        [{ kind: "move", target: "Street/street_main" }],
        [{ kind: "use", item: "meal" }],
      ]),
      "a",
    ),
  );
  assert.deepEqual(g, before);
});
test("failed real investigation consumes time; clarification and impossible action do not", async () => {
  const { service } = fixture(async (stage, g) =>
    stage === "scene"
      ? scene
      : g.run!.input === "不明确"
        ? { decision: "clarify", message: "请说清目标。", groups: [] }
        : plan([
            [
              {
                kind: g.run!.input === "非法移动" ? "move" : "investigate",
                target: g.run!.input === "非法移动" ? "Park/park_path" : "",
                minutes: 15,
              },
            ],
          ]),
  );
  assert.equal((await submit(service, "a", "不明确")).world.minute, 480);
  assert.equal((await submit(service, "b", "非法移动")).world.minute, 480);
  const attempted = await submit(service, "c");
  assert.equal(attempted.world.minute, 495);
  assert.equal(Object.keys(attempted.world.inventory).length, 0);
  await service.close();
});
test("a generated location is registered without teleporting, then uses validated route time", () => {
  const g = initial();
  const added = applyPlan(
    g,
    plan([
      [
        {
          kind: "discover",
          location: {
            id: "Bedroom/balcony",
            name: "阳台",
            region: "Bedroom",
            description: "小阳台",
          },
        },
      ],
    ]),
    "a",
  );
  assert.equal(added.world.location, g.world.location);
  assert.equal(
    added.world.locations["Bedroom/balcony"].routes[g.world.location],
    5,
  );
  const moved = applyPlan(
    { ...g, world: added.world },
    plan([[{ kind: "move", target: "Bedroom/balcony" }]]),
    "b",
  );
  assert.equal(moved.minutes, 5);
  assert.equal(moved.world.location, "Bedroom/balcony");
});
test("sleep restores proportionally and clamps, other midnight transitions do not restore", () => {
  const g = initial();
  g.world.stats.stamina = 20;
  g.world.stats.stress = 30;
  const w = applyPlan(g, plan([[{ kind: "sleep", minutes: 90 }]]), "a").world;
  assert.equal(w.stats.stamina, 35);
  assert.equal(w.stats.stress, 26.25);
  assert.equal(
    applyPlan(g, plan([[{ kind: "sleep", minutes: 480 }]]), "b").world.stats
      .stamina,
    80,
  );
  assert.throws(() =>
    applyPlan(g, plan([[{ kind: "rest", minutes: 123 }]]), "c"),
  );
});
test("gift and quest offers require a separate acceptance; duplicate acceptance cannot award twice", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world = applyReply(
    g,
    "linwanqing",
    {
      ...reply,
      offers: [
        {
          kind: "gift",
          message: "送你纸",
          item: "blank-paper",
          quantity: 1,
          quest: null,
        },
        {
          kind: "quest",
          message: "帮我找照片",
          item: "",
          quantity: 1,
          quest: photoQuest(),
        },
      ],
    },
    "a",
  );
  assert.deepEqual(g.world.inventory, {});
  assert.deepEqual(g.world.quests, {});
  g.world = applyPlan(
    g,
    plan([[{ kind: "accept", target: "a:linwanqing:0" }]]),
    "b",
  ).world;
  assert.equal(g.world.inventory["blank-paper"], 1);
  assert.equal(g.world.npcs.linwanqing.items["blank-paper"], 2);
  assert.throws(() =>
    applyPlan(g, plan([[{ kind: "accept", target: "a:linwanqing:0" }]]), "c"),
  );
  g.world = applyPlan(
    g,
    plan([[{ kind: "accept", target: "a:linwanqing:1" }]]),
    "d",
  ).world;
  assert.equal(g.world.quests["linwanqing-photo"].status, "active");
});
test("NPC context excludes private inventory, other NPC history and unreported quest progress", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world.facts.push("私密事实");
  g.world.npcs.hunter.history.push("秘密交谈");
  g.world.inventory.photo = 1;
  g.world.quests["linwanqing-photo"] = photoQuest();
  g.world.quests["linwanqing-photo"].goals[0].done = true;
  const context = JSON.stringify(npcContext(g, "linwanqing"));
  assert.ok(!context.includes("私密事实"));
  assert.ok(!context.includes("秘密交谈"));
  assert.ok(!context.includes('"done":true'));
  assert.ok(!context.includes('"inventory"'));
});
test("equivalent option and free text share the action pipeline; stale options rejected", async () => {
  const g = initial();
  g.scene.options = [{ id: "option", label: "调查", input: "调查现场" }];
  const run: ModelRunner["run"] = async (stage) =>
    stage === "plan" ? plan([[{ kind: "investigate" }]]) : scene;
  const a = fixture(run, g),
    b = fixture(run, g);
  const ga = await submit(a.service),
    gb = await submit(b.service, "a", "", "option");
  assert.deepEqual(ga.world, gb.world);
  await assert.rejects(submit(b.service, "b", "", "option"), /失效/);
  await a.service.close();
  await b.service.close();
});
test("duplicate requests and simultaneous tabs settle exactly once", async () => {
  const gate = pending<unknown>();
  const { service } = fixture(async (stage) =>
    stage === "plan" ? gate.promise : scene,
  );
  const request = {
    gameId: "test-game",
    requestId: "a",
    expectedRevision: 0,
    input: "等待",
  };
  await Promise.all([
    service.submitAction(request),
    service.submitAction(request),
  ]);
  await assert.rejects(
    service.submitAction({ ...request, requestId: "b" }),
    /刷新/,
  );
  gate.resolve(plan([[{ kind: "wait", minutes: 5 }]]));
  await service.whenIdle("test-game");
  const after = await service.submitAction(request);
  assert.equal(after.world.minute, 485);
  assert.equal(after.world.events.length, 1);
  assert.equal(after.world.memories?.length, 1);
  assert.equal(after.settlements?.filter((s) => s.changes.length).length, 1);
  await service.close();
});
test("response failure and retry never repeat photo delivery or time", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world.inventory.photo = 1;
  let fail = true;
  const { service } = fixture(async (stage) => {
    if (stage === "plan")
      return plan([[{ kind: "deliver", target: "linwanqing", item: "photo" }]]);
    if (stage === "reply") {
      if (fail) throw new Error("model failed");
      return reply;
    }
    return scene;
  }, g);
  let after = await submit(service);
  assert.equal(after.run?.stage, "reply");
  assert.equal(after.run?.status, "failed");
  assert.equal(after.world.minute, 481);
  assert.equal(after.world.inventory.photo, undefined);
  fail = false;
  await service.retryOutput(g.id, after.revision);
  await service.whenIdle(g.id);
  after = service.getGame(g.id);
  assert.equal(after.run?.status, "completed");
  assert.equal(after.world.minute, 481);
  assert.equal(after.world.npcs.linwanqing.items.photo, 1);
  assert.equal(after.world.npcs.linwanqing.relationship, 1);
  assert.equal(after.settlements?.filter((s) => s.stage === "plan").length, 1);
  assert.equal(after.settlements?.filter((s) => s.stage === "reply").length, 1);
  assert.equal(
    after.world.memories?.filter((m) => m.speakerId === "linwanqing").length,
    1,
  );
  await service.close();
});
test("scene failure retries scene only, preserving one NPC response commit", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  let fail = true;
  let replies = 0;
  const { service } = fixture(async (stage) => {
    if (stage === "plan")
      return plan([[{ kind: "talk", target: "linwanqing", text: "你好" }]]);
    if (stage === "reply") {
      replies++;
      return reply;
    }
    if (fail) throw new Error("scene unavailable");
    return scene;
  }, g);
  let after = await submit(service);
  assert.equal(after.run?.stage, "scene");
  fail = false;
  await service.retryOutput(g.id, after.revision);
  await service.whenIdle(g.id);
  after = service.getGame(g.id);
  assert.equal(replies, 1);
  assert.equal(after.world.npcs.linwanqing.relationship, 1);
  assert.equal(after.world.minute, 481);
  await service.close();
});
test("cancel then a new action ignores even an abort-unaware late reply", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  const gate = pending<unknown>();
  let replying = false;
  const { service } = fixture(async (stage, snapshot) => {
    if (stage === "plan")
      return plan([
        [
          snapshot.run!.id === "a"
            ? { kind: "talk", target: "linwanqing", text: "你好" }
            : { kind: "wait", minutes: 5 },
        ],
      ]);
    if (stage === "reply") {
      replying = true;
      return gate.promise;
    }
    return scene;
  }, g);
  await service.submitAction({
    gameId: g.id,
    requestId: "a",
    expectedRevision: 0,
    input: "你好",
  });
  await until(() => replying);
  await service.cancelAction(g.id);
  const newer = await submit(service, "b");
  gate.resolve(reply);
  await pause(15);
  assert.deepEqual(service.getGame(g.id), newer);
  assert.equal(newer.world.minute, 486);
  assert.equal(newer.world.npcs.linwanqing.relationship, 0);
  await service.close();
});
test("save/load and import/export preserve receipts and invalidate old generation", async () => {
  const { service } = fixture(async (stage) =>
    stage === "plan" ? plan([[{ kind: "wait", minutes: 5 }]]) : scene,
  );
  const first = await submit(service);
  await service.saveGame(first.id, 0, "测试");
  const exported = JSON.parse(JSON.stringify(service.exportSave(0)));
  await service.importSave(exported, 7);
  await submit(service, "b");
  const restored = await service.loadGame(first.id, 7);
  assert.deepEqual(restored.world, first.world);
  assert.ok(restored.generation > first.generation);
  assert.ok(restored.settlements?.some((s) => s.actionId === "b"));
  assert.equal(restored.settlements?.at(-1)?.stage, "restore");
  const repeated = await service.submitAction({
    gameId: first.id,
    requestId: "a",
    expectedRevision: 0,
    input: "调查现场",
  });
  assert.equal(repeated.world.minute, 485);
  await assert.rejects(
    service.importSave(
      {
        ...exported,
        game: {
          ...exported.game,
          world: { ...exported.game.world, location: "missing" },
        },
      },
      1,
    ),
  );
  await service.close();
});
test("plugin reload marks interruption and resumes uncommitted stage without replay", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world.inventory.photo = 1;
  const first = fixture(async (stage) => {
    if (stage === "plan")
      return plan([[{ kind: "deliver", target: "linwanqing", item: "photo" }]]);
    throw new Error("interrupted");
  }, g);
  const committed = await submit(first.service);
  await first.service.close();
  committed.run!.status = "running";
  first.store.records.set(g.id, committed);
  const restored = new GameService(first.store, {
    run: async (stage) => (stage === "reply" ? reply : scene),
  });
  await restored.recover();
  const now = restored.getGame(g.id);
  assert.equal(now.run?.status, "failed");
  await restored.retryOutput(g.id, now.revision);
  await restored.whenIdle(g.id);
  assert.equal(restored.getGame(g.id).world.npcs.linwanqing.items.photo, 1);
  assert.equal(restored.getGame(g.id).world.minute, 481);
  await restored.close();
});
test("failed durable write cannot partially apply player effects or receipt", async () => {
  const { service, store } = fixture(async (stage) => {
    if (stage === "plan") {
      store.failNext = true;
      return plan([[{ kind: "wait", minutes: 15 }]]);
    }
    return scene;
  });
  const after = await submit(service);
  assert.equal(after.world.minute, 480);
  assert.equal(after.receipts.a.committed, false);
  assert.equal(after.settlements?.length ?? 0, 0);
  assert.equal(after.world.memories?.length ?? 0, 0);
  assert.equal(after.run?.status, "failed");
  await service.close();
});
test("ambient event is committed with the player action and cannot reroll on scene retry", async () => {
  const g = initial();
  while (!ambientOpportunity(g)) g.world.seed++;
  let scenes = 0;
  const p = {
    ...plan([[{ kind: "wait", minutes: 5 }]]),
    ambient: { text: "雨声令人放松。", effects: { stress: -2 } },
  };
  const { service } = fixture(async (stage) => {
    if (stage === "plan") return p;
    if (++scenes === 1) throw new Error("scene failed");
    return scene;
  }, g);
  const first = await submit(service);
  assert.equal(first.world.stats.stress, 8);
  await service.retryOutput(g.id, first.revision);
  await service.whenIdle(g.id);
  assert.deepEqual(service.getGame(g.id).world, first.world);
  await service.close();
});
test("generated NPC is registered at the current location with no invented shared history", () => {
  const g = initial();
  const result = applyPlan(
    g,
    plan([
      [
        {
          kind: "meet",
          npc: { id: "visitor", name: "访客", profile: "一位画家。" },
        },
      ],
    ]),
    "a",
  );
  assert.equal(result.world.location, g.world.location);
  assert.equal(result.world.npcs.visitor.location, g.world.location);
  assert.deepEqual(result.world.npcs.visitor.history, []);
  assert.deepEqual(result.npcIds, ["visitor"]);
});
test("money gifts debit NPC resources only when accepted", () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.world = applyReply(
    g,
    "linwanqing",
    {
      ...reply,
      offers: [
        {
          kind: "gift",
          message: "赠予10元",
          item: "money",
          quantity: 10,
          quest: null,
        },
      ],
    },
    "a",
  );
  assert.equal(g.world.stats.money, 25);
  assert.equal(g.world.npcs.linwanqing.money, 35);
  const result = applyPlan(
    g,
    plan([[{ kind: "accept", target: "a:linwanqing:0" }]]),
    "b",
  );
  assert.equal(result.world.stats.money, 35);
  assert.equal(result.world.npcs.linwanqing.money, 25);
});
test("shopping, eating, exercise and learning settle through the same rules", () => {
  let g = initial();
  g.world.location = "Street/food_stall";
  g.world.stats.stamina = 40;
  g.world.stats.hunger = 40;
  g.world = applyPlan(g, plan([[{ kind: "buy", item: "pancake" }]]), "a").world;
  assert.equal(g.world.stats.money, 19);
  assert.equal(g.world.inventory.pancake, 1);
  g.world = applyPlan(
    g,
    plan([
      [{ kind: "use", item: "pancake" }],
      [{ kind: "exercise", minutes: 15 }],
      [{ kind: "study", minutes: 15 }],
    ]),
    "b",
  ).world;
  assert.equal(g.world.inventory.pancake, undefined);
  assert.equal(g.world.skills.运动, 3);
  assert.equal(g.world.skills.学识, 1);
  assert.equal(g.world.minute, 512);
});
test("invalid import cannot put a settled action back into plan stage", () => {
  const g = initial();
  g.run = {
    id: "a",
    input: "交付",
    stage: "plan",
    status: "failed",
    error: "",
    result: "",
    playerCommitted: true,
    npcIds: [],
    replied: [],
  };
  assert.throws(() => validateGame(g), /已结算/);
});

test("dialogue entry, two messages and exit call only plan/reply/reply/scene", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.scene.options = [
    { id: "chat", label: "与晚晴交谈", input: "与林晚晴交谈" },
  ];
  const stages: Stage[] = [];
  const { service } = fixture(async (stage) => {
    stages.push(stage);
    return stage === "plan"
      ? { decision: "enter_dialogue", npcId: "linwanqing" }
      : stage === "reply"
        ? reply
        : scene;
  }, g);
  let current = await submit(service, "enter", "", "chat");
  assert.equal(current.dialogue?.npcId, "linwanqing");
  assert.equal(current.world.minute, g.world.minute);
  assert.equal(current.scene.options.length, 0);
  await assert.rejects(
    service.submitAction({
      gameId: g.id,
      requestId: "move",
      expectedRevision: current.revision,
      input: "离开",
    }),
    /退出对话/,
  );
  for (const id of ["line1", "line2"]) {
    const request = {
      gameId: g.id,
      requestId: id,
      expectedRevision: current.revision,
      input: "我想把照片交给你，然后去街道",
    };
    await service.submitAction(request, "dialogue");
    await service.submitAction(request, "dialogue"); // Retried transport never charges twice.
    await service.whenIdle(g.id);
    current = service.getGame(g.id);
    assert.equal(current.run!.status, "completed");
    assert.equal(current.run!.stage, "done");
    assert.equal(current.world.location, g.world.location);
  }
  assert.equal(current.world.minute, g.world.minute + 2);
  assert.equal(
    current.world.memories!.filter((m) => m.speakerId === "player").length,
    2,
  );
  const exit = {
    gameId: g.id,
    requestId: "exit",
    expectedRevision: current.revision,
  };
  await service.submitAction(exit, "exitDialogue");
  await service.submitAction(exit, "exitDialogue");
  await service.whenIdle(g.id);
  current = service.getGame(g.id);
  assert.equal(current.dialogue, null);
  assert.equal(current.scene.description, scene.description);
  assert.equal(current.scene.options.length, 2);
  assert.deepEqual(stages, ["plan", "reply", "reply", "scene"]);
});

test("dialogue cannot enter from free text or target an absent NPC", async () => {
  for (const option of [false, true]) {
    const g = initial();
    g.scene.options = [{ id: "chat", label: "交谈", input: "交谈" }];
    const { service } = fixture(
      async () => ({ decision: "enter_dialogue", npcId: "linwanqing" }),
      g,
    );
    const current = await submit(
      service,
      "bad",
      "交谈",
      option ? "chat" : undefined,
    );
    assert.equal(current.run!.status, "failed");
    assert.equal(current.dialogue, undefined);
    assert.equal(current.world.minute, g.world.minute);
  }
});

test("dialogue reply retry and save restore preserve committed speech without replay", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.dialogue = { npcId: "linwanqing", locationId: g.world.location };
  let failed = true;
  const stages: Stage[] = [];
  const { service } = fixture(async (stage) => {
    stages.push(stage);
    if (failed) throw new Error("test failure");
    return reply;
  }, g);
  await service.submitAction(
    {
      gameId: g.id,
      requestId: "chat",
      expectedRevision: g.revision,
      input: "你好",
    },
    "dialogue",
  );
  await service.whenIdle(g.id);
  let current = service.getGame(g.id);
  assert.equal(current.run!.status, "failed");
  const minute = current.world.minute;
  await service.saveGame(g.id, 0, "对话中");
  current = await service.loadGame(g.id, 0);
  assert.equal(current.dialogue?.npcId, "linwanqing");
  failed = false;
  await service.retryOutput(g.id, current.revision);
  await service.whenIdle(g.id);
  current = service.getGame(g.id);
  assert.equal(current.world.minute, minute);
  assert.equal(
    current.world.memories!.filter((m) => m.speakerId === "player").length,
    1,
  );
  assert.deepEqual(stages, ["reply", "reply"]);
  assert.equal(current.run!.stage, "done");
});

test("exit cancels pending dialogue response and rejects its delayed state changes", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.dialogue = { npcId: "linwanqing", locationId: g.world.location };
  let release!: (value: unknown) => void;
  let started = false;
  const { service } = fixture(async (stage) => {
    if (stage === "scene") return scene;
    started = true;
    return new Promise((resolve) => {
      release = resolve;
    });
  }, g);
  await service.submitAction(
    {
      gameId: g.id,
      requestId: "chat",
      expectedRevision: g.revision,
      input: "你好",
    },
    "dialogue",
  );
  await until(() => started);
  const oldJob = service.whenIdle(g.id);
  const current = service.getGame(g.id);
  await service.submitAction(
    { gameId: g.id, requestId: "exit", expectedRevision: current.revision },
    "exitDialogue",
  );
  await service.whenIdle(g.id);
  release(reply);
  await oldJob;
  const after = service.getGame(g.id);
  assert.equal(after.dialogue, null);
  assert.equal(after.scene.description, scene.description);
  assert.equal(after.world.npcs.linwanqing.relationship, 0);
  assert.equal(
    after.world.memories!.filter((m) => m.speakerId === "linwanqing").length,
    0,
  );
  assert.equal(after.world.minute, g.world.minute + 1);
});

test("exit generation failure retries only scene and dialogue stale submissions are rejected", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.dialogue = { npcId: "linwanqing", locationId: g.world.location };
  let fail = true;
  const stages: Stage[] = [];
  const { service } = fixture(async (stage) => {
    stages.push(stage);
    if (fail) throw new Error("scene unavailable");
    return scene;
  }, g);
  await assert.rejects(
    service.submitAction(
      { gameId: g.id, requestId: "old", expectedRevision: 999, input: "你好" },
      "dialogue",
    ),
    /刷新/,
  );
  await service.submitAction(
    { gameId: g.id, requestId: "exit", expectedRevision: g.revision },
    "exitDialogue",
  );
  await service.whenIdle(g.id);
  let current = service.getGame(g.id);
  assert.equal(current.dialogue, null);
  assert.equal(current.run!.status, "failed");
  fail = false;
  await service.retryOutput(g.id, current.revision);
  await service.whenIdle(g.id);
  current = service.getGame(g.id);
  assert.equal(current.run!.status, "completed");
  assert.deepEqual(stages, ["scene", "scene"]);
});

test("failed exit persistence does not cancel the pending NPC reply", async () => {
  const g = initial();
  g.world.location = "Park/park_entrance";
  g.dialogue = { npcId: "linwanqing", locationId: g.world.location };
  let release!: (value: unknown) => void;
  let started = false;
  const { service, store } = fixture(async () => {
    started = true;
    return new Promise((resolve) => {
      release = resolve;
    });
  }, g);
  await service.submitAction(
    {
      gameId: g.id,
      requestId: "chat",
      expectedRevision: g.revision,
      input: "你好",
    },
    "dialogue",
  );
  await until(() => started);
  store.failNext = true;
  await assert.rejects(
    service.submitAction(
      {
        gameId: g.id,
        requestId: "exit",
        expectedRevision: service.getGame(g.id).revision,
      },
      "exitDialogue",
    ),
    /disk failure/,
  );
  release(reply);
  await service.whenIdle(g.id);
  const current = service.getGame(g.id);
  assert.equal(current.dialogue?.npcId, "linwanqing");
  assert.equal(current.run!.status, "completed");
  assert.equal(current.world.npcs.linwanqing.relationship, 1);
});
