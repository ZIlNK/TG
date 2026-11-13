import { test, after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { PromptStore } from "../src/host/prompts/loader";
import assert from "node:assert/strict";
import type { Context } from "@deepseek-ai/cordis";
import { HarnessRunner } from "../src/host/model";
import { createGame } from "../src/core/world";

type Handler = (...args: any[]) => Promise<any>;
const promptDirectory = mkdtempSync(join(tmpdir(), "tg-model-prompts-"));
after(() => {
  if (!resolve(promptDirectory).startsWith(resolve(tmpdir()) + sep))
    throw new Error("Unexpected temporary directory");
  rmSync(promptDirectory, { recursive: true });
});
// Simulate only the public Host seams, not a second model/tool loop.
function host(
  script: (
    hooks: Record<string, Handler>,
    tools: Record<string, { execute: Handler }>,
  ) => Promise<void>,
  terminal = "completed",
) {
  const hooks: Record<string, Handler> = {},
    tools: Record<string, { execute: Handler }> = {};
  const observed = {
    disposed: false,
    cancelled: false,
    restriction: null as unknown,
    section: null as unknown,
    message: null as unknown,
  };
  const agent = {
    followup: (value: unknown) => {
      observed.message = value;
    },
    cancel: () => {
      observed.cancelled = true;
    },
    whenIdle: () => script(hooks, tools),
    session: {
      snapshotEvents: () => [
        { type: "turn/end", data: { reason: { kind: terminal } } },
      ],
    },
  };
  const scoped = {
    on: (name: string, fn: Handler) => {
      hooks[name] = fn;
    },
    tools: {
      restrict: (value: unknown) => {
        observed.restriction = value;
      },
      register: (tool: { name: string; execute: Handler }) => {
        tools[tool.name] = tool;
      },
    },
    systemPrompt: {
      section: (value: unknown) => {
        observed.section = value;
      },
    },
  };
  const ctx = {
    agents: {
      create: async (options: {
        setup: (ctx: unknown, agent: unknown) => void;
      }) => {
        options.setup(scoped, agent);
        return {
          agent,
          dispose: async () => {
            observed.disposed = true;
          },
        };
      },
    },
  } as unknown as Context;
  return {
    runner: new HarnessRunner(ctx, undefined, new PromptStore(promptDirectory)),
    observed,
  };
}
const g = createGame("stage-test", "旅人", { provider: "test", model: "test" });
const scene = JSON.stringify({
  description: "现场",
  options: [
    { label: "等待", input: "等待5分钟" },
    { label: "调查", input: "调查现场" },
  ],
});
test("actual runner and context tool use the stage projection rather than full world", async () => {
  const snapshot = structuredClone(g);
  snapshot.world.npcs.linwanqing.profile = "DO_NOT_EXPOSE_PRIVATE_PROFILE";
  snapshot.world.events.push({
    minute: 0,
    text: "DO_NOT_EXPOSE_WORLD_LOG",
    actionId: "old",
  });
  const { runner } = host(async (_hooks, tools) => {
    for (const args of [{}, { query: "晚晴" }]) {
      const value = String(await tools.tg_read_context.execute(args));
      assert.ok(!value.includes("DO_NOT_EXPOSE"));
      assert.ok(!value.includes('"world":'));
    }
    await tools.tg_propose_result.execute({ json: scene });
  });
  await runner.run("scene", snapshot, {}, new AbortController().signal);
});
test("native model stage isolates tools/prompts, stages valid output, and disposes context", async () => {
  const { runner, observed } = host(async (hooks, tools) => {
    const assembly = await hooks["system-prompt/assemble"](
      {},
      {},
      async () => ({ contexts: ["编程指令"], sections: [] }),
    );
    assert.deepEqual(assembly.contexts, []);
    assert.match(
      await tools.tg_propose_result.execute({ json: scene }),
      /STAGED/,
    );
  });
  const before = structuredClone(g);
  await runner.run("scene", g, {}, new AbortController().signal);
  assert.deepEqual(observed.restriction, { allow: [] });
  assert.equal((observed.section as { complete: boolean }).complete, true);
  const prompt = (observed.section as { text: string }).text;
  assert.match(prompt, /必须调用 tg_propose_result/);
  assert.match(prompt, /普通回复中写 JSON 不算提交/);
  assert.match(prompt, /必须以当前游戏时间为准/);
  assert.ok(!prompt.includes("currentEvents"));
  assert.ok(!prompt.includes("previousScene"));
  assert.ok(prompt.includes(g.world.locations[g.world.location].description));
  assert.deepEqual(
    observed.message && (observed.message as { content: unknown }).content,
    [
      {
        type: "text",
        text: "请依据系统提示中的游戏资料，生成当前现场和下一轮选项。",
      },
    ],
  );
  assert.equal(observed.disposed, true);
  assert.deepEqual(g, before);
});
test("sixth model request fails even after a valid proposal", async () => {
  const { runner, observed } = host(async (hooks, tools) => {
    await tools.tg_propose_result.execute({ json: scene });
    for (let i = 0; i < 6; i++)
      await hooks["agent/request"]({}, async () => ({}));
  });
  await assert.rejects(
    runner.run("scene", g, {}, new AbortController().signal),
    /5 次/,
  );
  assert.equal(observed.disposed, true);
});
test("thirteenth tool call cancels stage and does not return an earlier proposal", async () => {
  const { runner, observed } = host(async (_hooks, tools) => {
    for (let i = 0; i < 13; i++) await tools.tg_read_context.execute({});
  });
  await assert.rejects(
    runner.run("scene", g, {}, new AbortController().signal),
    /12 次/,
  );
  assert.equal(observed.cancelled, true);
  assert.equal(observed.disposed, true);
});
test("a valid staged proposal is discarded if the native turn ultimately failed", async () => {
  const { runner, observed } = host(async (_hooks, tools) => {
    await tools.tg_propose_result.execute({ json: scene });
  }, "failed");
  await assert.rejects(
    runner.run("scene", g, {}, new AbortController().signal),
    /未正常完成/,
  );
  assert.equal(observed.disposed, true);
});

test("understanding model stages dialogue entry through its dedicated scoped tool", async () => {
  const snapshot = structuredClone(g);
  snapshot.world.location = "Park/park_entrance";
  snapshot.scene.options = [
    { id: "chat", label: "与晚晴交谈", input: "与晚晴交谈" },
  ];
  snapshot.run = {
    id: "entry",
    input: "与晚晴交谈",
    optionId: "chat",
    kind: "action",
    stage: "plan",
    status: "running",
    error: "",
    result: "",
    npcIds: [],
    replied: [],
    playerCommitted: false,
  };
  const before = structuredClone(snapshot);
  const { runner, observed } = host(async (_hooks, tools) => {
    assert.ok(tools.tg_enter_dialogue);
    assert.match(
      await tools.tg_propose_result.execute({
        json: JSON.stringify({
          decision: "act",
          message: "",
          groups: [[{ kind: "talk", target: "linwanqing", text: "你好" }]],
        }),
      }),
      /tg_enter_dialogue/,
    );
    assert.match(
      await tools.tg_enter_dialogue.execute({ npcId: "absent" }),
      /REJECTED/,
    );
    assert.match(
      await tools.tg_enter_dialogue.execute({ npcId: "linwanqing" }),
      /STAGED/,
    );
    assert.match(
      await tools.tg_propose_result.execute({ json: scene }),
      /已有有效提议/,
    );
  });
  const result = await runner.run(
    "plan",
    snapshot,
    {},
    new AbortController().signal,
  );
  assert.deepEqual(result, { decision: "enter_dialogue", npcId: "linwanqing" });
  assert.deepEqual(snapshot, before);
  assert.match((observed.section as { text: string }).text, /交谈模式协议/);
  const other = host(async (_hooks, tools) => {
    assert.equal(tools.tg_enter_dialogue, undefined);
    await tools.tg_propose_result.execute({ json: scene });
  });
  await other.runner.run("scene", snapshot, {}, new AbortController().signal);
});
