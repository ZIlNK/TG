import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { Attempt } from "../src/core/trace";
import { ModelSchema, validateGame } from "../src/core/schema";
import { createGame } from "../src/core/world";
import { HarnessRunner } from "../src/host/model";
import { currentDefaultModel, resolveModel } from "../src/host/model-choice";
import { PromptStore } from "../src/host/prompts/loader";
import { TraceService } from "../src/host/trace";

const promptDirectory = mkdtempSync(join(tmpdir(), "tg-follow-prompts-"));
after(() => {
  if (!resolve(promptDirectory).startsWith(resolve(tmpdir()) + sep))
    throw new Error("Unexpected temporary directory");
  rmSync(promptDirectory, { recursive: true });
});
type Selection = { provider: string; model: string; reasoningEffort?: string };
const selection = (value: Selection | undefined) =>
  value ? { currentSelection: () => value } : undefined;
const hostContext = (
  value: Selection | undefined,
  capture: (options: unknown) => void,
  proposal: string,
) => {
  const tools: Record<string, { execute: (args: unknown) => Promise<unknown> }> =
    {};
  const agent = {
    followup: () => undefined,
    cancel: () => undefined,
    whenIdle: async () => {
      await tools.tg_propose_result.execute({ json: proposal });
    },
    session: {
      snapshotEvents: () => [
        { type: "turn/end", data: { reason: { kind: "completed" } } },
      ],
    },
  };
  const scoped = {
    on: () => undefined,
    tools: {
      restrict: () => undefined,
      register: (tool: {
        name: string;
        execute: (args: unknown) => Promise<unknown>;
      }) => {
        tools[tool.name] = tool;
      },
    },
    systemPrompt: { section: () => undefined },
  };
  return {
    get: (name: string) =>
      name === "agentDefaultModel" ? selection(value) : undefined,
    agents: {
      create: async (options: {
        agentOptions: unknown;
        setup: (ctx: unknown, agent: unknown) => void;
      }) => {
        capture(options.agentOptions);
        options.setup(scoped, agent);
        return { agent, dispose: async () => undefined };
      },
    },
  } as unknown as Context;
};
const scene = JSON.stringify({
  description: "现场",
  options: [
    { label: "等待", input: "等待5分钟" },
    { label: "调查", input: "调查现场" },
  ],
});
const runScene = async (
  runner: HarnessRunner,
  game: ReturnType<typeof createGame>,
) => runner.run("scene", game, {}, new AbortController().signal);

test("follow is an additive flag: older saves and fixed routes keep parsing", () => {
  assert.equal(
    ModelSchema.parse({ provider: "p", model: "m" }).follow,
    undefined,
  );
  assert.equal(ModelSchema.parse({ provider: "p", model: "m", follow: true }).follow, true);
  const game = createGame("follow-schema", "旅人", {
    provider: "snapshot-provider",
    model: "snapshot-model",
    follow: true,
  });
  assert.equal(validateGame(game).model.follow, true);
  const restored = validateGame(JSON.parse(JSON.stringify(game)));
  assert.deepEqual(restored.model, {
    provider: "snapshot-provider",
    model: "snapshot-model",
    follow: true,
  });
});

test("the Host default model is read live and only for follow routes", () => {
  const defaults = { provider: "qwen-token-plan-cn", model: "deepseek-v4" };
  const ctx = hostContext(defaults, () => undefined, scene);
  assert.deepEqual(currentDefaultModel(ctx), defaults);
  assert.deepEqual(
    resolveModel(ctx, { provider: "fixed", model: "m", follow: true }),
    defaults,
  );
  assert.deepEqual(
    resolveModel(ctx, { provider: "fixed", model: "m" }),
    { provider: "fixed", model: "m" },
  );
  assert.equal(
    currentDefaultModel(hostContext(undefined, () => undefined, scene)),
    undefined,
  );
  assert.throws(
    () => resolveModel(hostContext(undefined, () => undefined, scene), {
      provider: "fixed",
      model: "m",
      follow: true,
    }),
    /没有可用的默认模型配置/,
  );
});

test("each stage calls the current DSH model while the save keeps its snapshot", async () => {
  const attempts = new Map<string, Attempt>();
  const trace = new TraceService({} as Context, {
    all: () => [...attempts.values()],
    get: (id) => attempts.get(id),
    put: async (attempt) => {
      attempts.set(attempt.sessionId, attempt);
    },
  });
  const current: Selection = {
    provider: "qwen-token-plan-cn",
    model: "deepseek-v4.1-flash-1017",
    reasoningEffort: "high",
  };
  const calls: unknown[] = [];
  const runner = new HarnessRunner(
    hostContext(current, (options) => calls.push(options), scene),
    trace,
    new PromptStore(promptDirectory),
  );
  const game = createGame("follow-run", "旅人", {
    provider: "snapshot-provider",
    model: "snapshot-model",
    follow: true,
  });
  await runScene(runner, game);
  assert.deepEqual(calls[0], {
    provider: "qwen-token-plan-cn",
    model: "deepseek-v4.1-flash-1017",
    maxTokens: 4096,
    reasoningEffort: "high",
  });
  const attempt = [...attempts.values()][0];
  assert.equal(attempt.provider, "qwen-token-plan-cn");
  assert.equal(attempt.model, "deepseek-v4.1-flash-1017");
  assert.equal(attempt.status, "completed");
  assert.deepEqual(game.model, {
    provider: "snapshot-provider",
    model: "snapshot-model",
    follow: true,
  });
  // A DSH switch applies to the next stage, not to an in-flight one.
  current.provider = "xiaomi-token-plan-cn";
  current.model = "next-model";
  delete current.reasoningEffort;
  await runScene(runner, game);
  assert.deepEqual(calls[1], {
    provider: "xiaomi-token-plan-cn",
    model: "next-model",
    maxTokens: 4096,
  });
  assert.equal([...attempts.values()][1].model, "next-model");
});