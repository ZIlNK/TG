import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { PromptStore } from "../src/host/prompts/loader";
import { buildStageMessages, type StagePromptInput } from "../src/host/prompts";
import { buildSceneContext, buildNpcContext } from "../src/core/context";
import { createGame } from "../src/core/world";

test("saved templates reload next call, preserve snapshots, fall back visibly, and survive store recreation", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "tg-prompt-reload-"));
  t.after(() => {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unexpected temporary directory");
    rmSync(directory, { recursive: true });
  });
  const store = new PromptStore(directory);
  const g = createGame("reload", "测试", { provider: "test", model: "test" });
  const request: StagePromptInput = {
    stage: "scene",
    context: buildSceneContext(g),
  };
  const initial = buildStageMessages(request, store);
  const file = join(directory, "scene.system.md");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, "修改后，现在是{day} {time}，天气{weather}。", "utf8");
  const updated = buildStageMessages(request, store);
  assert.match(updated.system, /^修改后，现在是第 1 天/);
  assert.ok(!initial.system.startsWith("修改后"));
  writeFileSync(file, "{npc.secret}", "utf8");
  const fallback = buildStageMessages(request, store);
  assert.equal(fallback.system, updated.system);
  assert.match(fallback.warning!, /未知.*npc.secret/);
  // First use after a restart has no in-memory last-good version.
  const restarted = buildStageMessages(request, new PromptStore(directory));
  assert.match(restarted.warning!, /内置默认/);
  assert.equal(readFileSync(file, "utf8"), "{npc.secret}");
  writeFileSync(file, "", "utf8");
  assert.match(buildStageMessages(request, store).warning!, /不能为空/);
  writeFileSync(file, original + "\n已修复", "utf8");
  const repaired = buildStageMessages(request, store);
  assert.equal(repaired.warning, undefined);
  assert.ok(repaired.system.endsWith("已修复"));
  assert.equal(
    buildStageMessages(request, new PromptStore(directory)).system,
    repaired.system,
  );
  g.world.location = "Park/park_entrance";
  assert.equal(
    buildStageMessages(
      { stage: "reply", context: buildNpcContext(g, "linwanqing") },
      store,
    ).warning,
    undefined,
  );
});
