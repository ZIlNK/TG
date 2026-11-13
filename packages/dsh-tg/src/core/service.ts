import { randomUUID } from "node:crypto";
import {
  GameSchema,
  ModelSchema,
  PlanSchema,
  ReplySchema,
  SaveSchema,
  SceneSchema,
  validateGame,
  type Game,
  type ModelChoice,
  type Save,
} from "./schema";
import { applyPlan, applyReply, copy, npcContext } from "./rules";
import { createGame } from "./world";
import { changes } from "./trace";
import { EnterDialogueSchema, validateDialogueEntry } from "./dialogue";
import { npcPresent } from "./world";

export type Stage = "plan" | "reply" | "scene";
export interface ModelRunner {
  run(
    stage: Stage,
    game: Game,
    context: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface Store {
  games(): Game[];
  get(id: string): Game | undefined;
  put(game: Game): Promise<void>;
  saves(): Save[];
  save(value: Save): Promise<void>;
}
export interface Submit {
  gameId: string;
  requestId: string;
  expectedRevision: number;
  input?: string;
  optionId?: string;
}
type Job = {
  controller: AbortController;
  generation: number;
  promise: Promise<void>;
};
export class GameService {
  private queues = new Map<string, Promise<unknown>>();
  private jobs = new Map<string, Job>();
  private closed = false;
  constructor(
    private readonly store: Store,
    private readonly runner: ModelRunner,
  ) {}
  private async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) || Promise.resolve();
    const current = previous.catch(() => undefined).then(action);
    this.queues.set(id, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(id) === current) this.queues.delete(id);
    }
  }
  private read(id: string): Game {
    const game = this.store.get(id);
    if (!game) throw new Error("找不到本局游戏");
    return copy(game);
  }
  private async put(game: Game): Promise<Game> {
    game.revision++;
    await this.store.put(validateGame(game));
    return copy(game);
  }
  async recover(): Promise<void> {
    for (const stored of this.store.games()) {
      if (stored.run?.status !== "running") continue;
      const game = copy(stored);
      game.generation++;
      game.run!.status = "failed";
      game.run!.error = "上次处理被中断，可重试未完成阶段。";
      await this.put(game);
    }
  }
  listGames(): { id: string; name: string; minute: number }[] {
    return this.store
      .games()
      .map((g) => ({ id: g.id, name: g.world.name, minute: g.world.minute }));
  }
  getGame(id: string): Game {
    return this.read(id);
  }
  async createGame(
    name: string,
    model: ModelChoice,
    replaceGameId?: string,
  ): Promise<Game> {
    if (this.closed) throw new Error("插件正在关闭");
    if (replaceGameId) await this.cancelAction(replaceGameId);
    const game = createGame(
      randomUUID(),
      name.trim() || "旅人",
      ModelSchema.parse(model),
    );
    return this.put(game);
  }
  async submitAction(
    request: Submit,
    mode: "action" | "dialogue" | "exitDialogue" = "action",
  ): Promise<Game> {
    return this.serial(request.gameId, async () => {
      if (this.closed) throw new Error("插件正在关闭");
      const game = this.read(request.gameId);
      if (
        !request.requestId ||
        request.requestId.length > 120 ||
        ["__proto__", "constructor", "prototype"].includes(request.requestId)
      )
        throw new Error("无效的请求编号");
      const signature =
        mode === "exitDialogue"
          ? "exitDialogue"
          : mode === "dialogue"
            ? `dialogue:${request.input?.trim() || ""}`
            : request.optionId
              ? `option:${request.optionId}`
              : `text:${request.input?.trim() || ""}`;
      const old = game.receipts[request.requestId];
      if (old) {
        if (old.input !== signature)
          throw new Error("请求编号已被另一项行动使用");
        return game;
      }
      if (game.revision !== request.expectedRevision)
        throw new Error("现场已更新，请刷新后重试");
      if (game.run?.status === "running" && mode !== "exitDialogue")
        throw new Error("正在处理上一次行动");
      if (game.world.over && mode !== "exitDialogue")
        throw new Error("本局已经结束");
      if (mode === "action" && game.dialogue)
        throw new Error("请先退出对话，再进行现场行动");
      if (mode !== "action" && !game.dialogue)
        throw new Error("当前不在对话模式");
      if (mode === "dialogue" && game.run && game.run.stage !== "done")
        throw new Error("请先重试未完成回应，或退出对话");
      const input =
        mode === "exitDialogue"
          ? "结束对话，返回现场"
          : request.optionId
            ? game.scene.options.find((o) => o.id === request.optionId)?.input
            : request.input?.trim();
      if (!input || input.length > 6000)
        throw new Error("选项已失效或输入为空、过长");
      game.generation++;
      game.run = {
        id: request.requestId,
        input,
        stage: "plan",
        status: "running",
        error: "",
        result: "",
        npcIds: [],
        replied: [],
        playerCommitted: false,
        kind: mode,
        optionId: mode === "action" ? request.optionId : undefined,
      };
      game.receipts[request.requestId] = {
        input: signature,
        result: "",
        committed: false,
      };
      if (mode === "dialogue") {
        const npcId = game.dialogue!.npcId;
        if (!npcPresent(game.world, npcId))
          throw new Error("对方已经离开，请退出对话");
        const before = copy(game.world);
        const outcome = applyPlan(
          game,
          PlanSchema.parse({
            decision: "act",
            message: "",
            groups: [
              [{ kind: "talk", target: npcId, text: input, minutes: 1 }],
            ],
          }),
          game.run.id,
        );
        game.world = outcome.world;
        game.run.playerCommitted = true;
        game.run.result = `${outcome.result}\n耗时 1 分钟。`;
        game.run.npcIds = outcome.npcIds;
        game.run.stage = "reply";
        game.receipts[request.requestId].committed = true;
        game.receipts[request.requestId].result = game.run.result;
        (game.settlements ??= []).push({
          id: randomUUID(),
          actionId: game.run.id,
          generation: game.generation,
          revision: game.revision + 1,
          time: new Date().toISOString(),
          stage: "dialogue",
          input,
          result: game.run.result,
          changes: changes(before, game.world),
        });
      } else if (mode === "exitDialogue") {
        game.dialogue = null;
        game.scene.options = [];
        game.run.stage = "scene";
      }
      const saved = await this.put(game);
      this.jobs.get(game.id)?.controller.abort();
      this.launch(saved);
      return saved;
    });
  }
  private launch(game: Game): void {
    const job: Job = {
      controller: new AbortController(),
      generation: game.generation,
      promise: Promise.resolve(),
    };
    this.jobs.set(game.id, job);
    job.promise = Promise.resolve()
      .then(() => this.process(game.id, job))
      .finally(() => {
        if (this.jobs.get(game.id) === job) this.jobs.delete(game.id);
      });
  }
  private current(id: string, job: Job): Game {
    job.controller.signal.throwIfAborted();
    const g = this.read(id);
    if (
      this.closed ||
      this.jobs.get(id) !== job ||
      g.generation !== job.generation ||
      g.run?.status !== "running"
    )
      throw new Error("结果已过期");
    return g;
  }
  private async commit(
    id: string,
    job: Job,
    change: (g: Game) => void,
  ): Promise<Game> {
    return this.serial(id, async () => {
      const game = this.current(id, job);
      const before = copy(game.world);
      const stage = game.run!.stage;
      change(game);
      const delta = changes(before, game.world);
      if (delta.length || game.run!.stage === "done") {
        (game.settlements ??= []).push({
          id: randomUUID(),
          actionId: game.run!.id,
          generation: game.generation,
          revision: game.revision + 1,
          time: new Date().toISOString(),
          stage,
          input: game.run!.input,
          result:
            game.run!.error ||
            (stage === "reply" ? game.scene.description : game.run!.result),
          changes: delta,
        });
      }
      return this.put(game);
    });
  }
  private async process(id: string, job: Job): Promise<void> {
    try {
      let game = this.current(id, job);
      if (game.run!.stage === "plan") {
        const proposal = await this.runner.run(
          "plan",
          game,
          { input: game.run!.input },
          job.controller.signal,
        );
        const enter = EnterDialogueSchema.safeParse(proposal);
        if (enter.success) {
          validateDialogueEntry(game, enter.data.npcId);
          await this.commit(id, job, (g) => {
            validateDialogueEntry(g, enter.data.npcId);
            g.dialogue = {
              npcId: enter.data.npcId,
              locationId: g.world.location,
            };
            g.scene.options = [];
            g.run!.stage = "done";
            g.run!.status = "completed";
            g.run!.result = `开始与${g.world.npcs[enter.data.npcId].name}交谈。`;
            g.receipts[g.run!.id].result = g.run!.result;
          });
          return;
        }
        const plan = PlanSchema.parse(proposal);
        if (plan.decision !== "act") {
          await this.commit(id, job, (g) => {
            g.run!.stage = "done";
            g.run!.status = "completed";
            g.run!.result = plan.message;
            g.receipts[g.run!.id].result = plan.message;
          });
          return;
        }
        // Rule rejection is a completed, non-consuming action, not a broken model request.
        try {
          applyPlan(game, plan, game.run!.id);
        } catch (error) {
          await this.commit(id, job, (g) => {
            g.run!.stage = "done";
            g.run!.status = "completed";
            g.run!.result = errorText(error);
            g.receipts[g.run!.id].result = errorText(error);
          });
          return;
        }
        game = await this.commit(id, job, (g) => {
          const outcome = applyPlan(g, plan, g.run!.id);
          g.world = outcome.world;
          g.run!.playerCommitted = true;
          g.run!.result = `${outcome.result}\n耗时 ${outcome.minutes} 分钟。`;
          g.run!.npcIds = outcome.npcIds;
          g.run!.stage = outcome.npcIds.length ? "reply" : "scene";
          g.receipts[g.run!.id].committed = true;
          g.receipts[g.run!.id].result = g.run!.result;
          g.scene = { description: g.run!.result, options: [] };
        });
      }
      if (game.run!.stage === "reply") {
        for (const npc of game.run!.npcIds) {
          game = this.current(id, job);
          if (game.run!.replied.includes(npc)) continue;
          const reply = ReplySchema.parse(
            await this.runner.run(
              "reply",
              game,
              npcContext(game, npc),
              job.controller.signal,
            ),
          );
          game = await this.commit(id, job, (g) => {
            g.world = applyReply(g, npc, reply, g.run!.id);
            g.run!.replied.push(npc);
            g.scene.description += `\n\n${g.world.npcs[npc].name}：${reply.text}`;
          });
        }
        game = await this.commit(id, job, (g) => {
          if (g.dialogue && g.run!.kind === "dialogue") {
            g.run!.stage = "done";
            g.run!.status = "completed";
            g.run!.error = "";
          } else g.run!.stage = "scene";
        });
      }
      if (game.run!.stage === "scene") {
        const scene = SceneSchema.parse(
          await this.runner.run("scene", game, {}, job.controller.signal),
        );
        await this.commit(id, job, (g) => {
          g.scene = {
            description: scene.description,
            options: scene.options.map((o, i) => ({
              ...o,
              id: `${g.run!.id}:${g.generation}:${i}`,
            })),
          };
          g.run!.stage = "done";
          g.run!.status = "completed";
          g.run!.error = "";
        });
      }
    } catch (error) {
      if (job.controller.signal.aborted || this.closed) return;
      try {
        await this.commit(id, job, (g) => {
          g.run!.status = "failed";
          g.run!.error = errorText(error);
        });
      } catch (persistError) {
        console.error("[TG] 未能保存处理结果：", errorText(persistError));
      }
    }
  }
  async cancelAction(id: string): Promise<Game> {
    return this.serial(id, async () => {
      this.jobs.get(id)?.controller.abort();
      const g = this.read(id);
      if (g.run && g.run.status !== "completed") {
        g.generation++;
        g.run.status = "cancelled";
        g.run.error = g.run.playerCommitted
          ? "已确认结果保留，回应尚未完成。"
          : "行动已取消，尚未产生效果。";
        return this.put(g);
      }
      return g;
    });
  }
  async retryOutput(id: string, expectedRevision: number): Promise<Game> {
    return this.serial(id, async () => {
      const g = this.read(id);
      if (g.revision !== expectedRevision) throw new Error("现场已更新");
      if (g.run?.status === "running") throw new Error("仍在处理中");
      if (!g.run || g.run.stage === "done") {
        if (g.dialogue) throw new Error("对话已完成，请继续说话或退出对话");
        g.run = {
          id: randomUUID(),
          input: "",
          stage: "scene",
          status: "running",
          result: "",
          error: "",
          npcIds: [],
          replied: [],
          playerCommitted: false,
        };
      }
      g.run.status = "running";
      g.run.error = "";
      g.generation++;
      const saved = await this.put(g);
      this.launch(saved);
      return saved;
    });
  }
  listSaves(): Omit<Save, "game">[] {
    return this.store.saves().map(({ game, ...meta }) => meta);
  }
  async saveGame(id: string, slot: number, title: string): Promise<void> {
    await this.store.save(
      SaveSchema.parse({
        slot,
        title: title || "未命名存档",
        date: new Date().toISOString(),
        game: this.read(id),
      }),
    );
  }
  async loadGame(id: string, slot: number): Promise<Game> {
    const save = this.store.saves().find((s) => s.slot === slot);
    if (!save) throw new Error("空存档栏位");
    return this.restore(id, save.game);
  }
  private async restore(id: string, input: unknown): Promise<Game> {
    const loaded = validateGame(input);
    return this.serial(id, async () => {
      const current = this.read(id);
      this.jobs.get(id)?.controller.abort();
      loaded.id = id;
      loaded.generation = current.generation + 1;
      loaded.revision = current.revision;
      // A load changes the present; it must not erase the local audit history.
      loaded.settlements = [
        ...(current.settlements ?? []),
        {
          id: randomUUID(),
          actionId: `restore-${randomUUID()}`,
          generation: loaded.generation,
          revision: loaded.revision + 1,
          time: new Date().toISOString(),
          stage: "restore",
          input: "读取存档",
          result: "恢复存档状态",
          changes: changes(current.world, loaded.world),
        },
      ];
      if (loaded.run?.status === "running") {
        loaded.run.status = "failed";
        loaded.run.error = "已恢复存档，可补齐未完成阶段。";
      }
      return this.put(loaded);
    });
  }
  exportSave(slot: number): Save {
    const save = this.store.saves().find((s) => s.slot === slot);
    if (!save) throw new Error("空存档栏位");
    return copy(save);
  }
  async importSave(value: unknown, slot: number): Promise<void> {
    const save = SaveSchema.parse(value);
    validateGame(save.game);
    await this.store.save({ ...save, slot: SaveSchema.shape.slot.parse(slot) });
  }
  async configure(
    id: string,
    model: ModelChoice,
    theme: "dark" | "light",
  ): Promise<Game> {
    return this.serial(id, async () => {
      const g = this.read(id);
      if (g.run?.status === "running")
        throw new Error("请在当前行动结束后更换设置");
      g.model = ModelSchema.parse(model);
      g.theme = theme;
      return this.put(g);
    });
  }
  async whenIdle(id: string): Promise<void> {
    await this.jobs.get(id)?.promise;
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.jobs.values()) job.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map((j) => j.promise));
    await Promise.allSettled([...this.queues.values()]);
  }
}
export function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 1500)
    : String(error).slice(0, 1500);
}
