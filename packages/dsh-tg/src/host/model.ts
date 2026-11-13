import { randomUUID } from "node:crypto";
import type { Context } from "@deepseek-ai/cordis";
import type { AgentHandle } from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-system-prompt";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  PlanSchema,
  ReplySchema,
  SceneSchema,
  type Game,
} from "../core/schema";
import { errorText, type ModelRunner, type Stage } from "../core/service";
import { ambientOpportunity, applyPlan, applyReply } from "../core/rules";
import {
  buildActionContext,
  buildSceneContext,
  buildNpcContext,
  queryContext,
} from "../core/context";
import type { TraceService } from "./trace";
import type { Attempt } from "../core/trace";
import { buildStageMessages, type StagePromptInput } from "./prompts";
import { PromptStore } from "./prompts/loader";
import { EnterDialogueSchema, validateDialogueEntry } from "../core/dialogue";

export class HarnessRunner implements ModelRunner {
  constructor(
    private readonly ctx: Context,
    private readonly trace?: TraceService,
    private readonly prompts = new PromptStore(),
  ) {}
  async run(
    stage: Stage,
    game: Game,
    context: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const schema =
      stage === "plan"
        ? PlanSchema
        : stage === "reply"
          ? ReplySchema
          : SceneSchema;
    let result: unknown;
    let rounds = 0;
    let calls = 0;
    let failure = "";
    let handle: AgentHandle | undefined;
    const request: StagePromptInput =
      stage === "reply"
        ? {
            stage,
            context: buildNpcContext(
              game,
              (context as { npc: { id: string } }).npc.id,
            ),
          }
        : stage === "plan"
          ? {
              stage,
              context: {
                ...buildActionContext(
                  game,
                  game.run?.input ??
                    (context as { input?: string }).input ??
                    "",
                ),
                ambientOpportunity: ambientOpportunity(game),
              },
            }
          : { stage, context: buildSceneContext(game) };
    const messages = buildStageMessages(request, this.prompts);
    const prompt = JSON.stringify(request.context);
    const attempt: Attempt = {
      sessionId: `tg-${game.id}-${stage}-${randomUUID()}`,
      gameId: game.id,
      actionId: game.run?.id ?? randomUUID(),
      generation: game.generation,
      stage,
      npcId:
        stage === "reply" ? (context as { npc: { id: string } }).npc.id : "",
      input: game.run?.input ?? "",
      ...game.model,
      started: new Date().toISOString(),
      ended: "",
      status: "running",
      error: "",
      promptWarning: messages.warning,
    };
    await this.trace?.start(attempt);
    try {
      handle = await this.ctx.agents.create({
        sessionId: attempt.sessionId as never,
        agentOptions: {
          provider: game.model.provider,
          model: game.model.model,
          maxTokens: 4096,
        },
        signal,
        setup: (ctx, agent) => {
          ctx.tools.restrict({ allow: [] });
          ctx.systemPrompt.section({
            name: "tg-rules",
            order: 0,
            text:
              messages.system +
              (stage === "plan" && game.run?.optionId
                ? "\n【交谈模式协议】玩家选择了当前现场的选项。若此选项的意图是与在场 NPC 交谈，请调用 tg_enter_dialogue，npcId 使用该人物准确编号；该工具仅进入独立对话界面，不代替玩家说话、不结算时间。收到 STAGED 后结束，不再调用 tg_propose_result。其他行动仍调用 tg_propose_result。"
                : stage === "reply" && game.dialogue
                  ? "\n【独立对话模式】用户本轮文字只代表对你说的话，不代表已经完成移动、交付、购买或接受提议。只作人物回应，不生成场景选项、不声称上述操作已生效。"
                  : ""),
            complete: true,
          });
          ctx.on(
            "system-prompt/assemble",
            async (_assembly, _context, next) => ({
              ...(await next()),
              contexts: [],
            }),
          );
          ctx.on("agent/request", async (_payload, next) => {
            if (++rounds > 5) {
              failure = "本阶段已达到 5 次模型请求上限";
              throw new Error(failure);
            }
            signal.throwIfAborted();
            return next();
          });
          ctx.on("agent/request-error", async (payload, _next) => {
            failure = "模型请求失败：" + JSON.stringify(payload.failure);
            return undefined;
          });
          const countToolCall = (): void => {
            signal.throwIfAborted();
            if (++calls > 12) {
              failure = "工具调用超过 12 次上限";
              agent.cancel({ kind: "user" });
              throw new Error(failure);
            }
          };
          ctx.tools.register(
            defineTool({
              name: "tg_read_context",
              description:
                "读取本阶段允许知道的游戏事实；人物阶段只含该人物已知的信息。",
              parameters: {
                query: {
                  type: "string",
                  description:
                    "可选关键词或人物、物品、任务编号，查询相关资料与较早经历。不能扩大当前阶段的知情范围。",
                },
              },
              output: {
                schema: { type: "string" },
                render: (_args, value) => [{ type: "text", text: value }],
              },
              execute: async (args) => {
                countToolCall();
                return args.query
                  ? JSON.stringify(
                      queryContext(
                        game,
                        stage,
                        args.query,
                        attempt.npcId || undefined,
                      ),
                    )
                  : prompt;
              },
            }),
          );
          if (stage === "plan" && game.run?.optionId && !game.dialogue) {
            ctx.tools.register(
              defineTool({
                name: "tg_enter_dialogue",
                description:
                  "所选选项为与当前在场人物交谈时，提议进入独立对话模式。收到 STAGED 后结束本轮，不再提交其他结果。",
                parameters: {
                  npcId: {
                    type: "string",
                    required: true,
                    description: "当前在场 NPC 的准确编号",
                  },
                },
                output: {
                  schema: { type: "string" },
                  render: (_args, value) => [{ type: "text", text: value }],
                },
                execute: async (args) => {
                  countToolCall();
                  if (result !== undefined)
                    return "REJECTED：本轮已有有效提议，请结束回复。";
                  try {
                    validateDialogueEntry(game, args.npcId);
                    result = EnterDialogueSchema.parse({
                      decision: "enter_dialogue",
                      npcId: args.npcId,
                    });
                    return "STAGED：进入对话的提议通过校验，请结束本轮。";
                  } catch (error) {
                    result = undefined;
                    return "REJECTED：" + errorText(error);
                  }
                },
              }),
            );
          }
          ctx.tools.register(
            defineTool({
              name: "tg_propose_result",
              description:
                "暂存本阶段结果，未改变游戏状态。收到 STAGED 后结束回复。",
              parameters: {
                json: {
                  type: "string",
                  required: true,
                  description: "符合当前阶段结构的完整 JSON 字符串",
                },
              },
              output: {
                schema: { type: "string" },
                render: (_args, value) => [{ type: "text", text: value }],
              },
              execute: async (args) => {
                countToolCall();
                if (result !== undefined)
                  return "REJECTED：本轮已有有效提议，请结束回复。";
                try {
                  const candidate = schema.parse(JSON.parse(args.json));
                  if (
                    stage === "plan" &&
                    game.run?.optionId &&
                    "groups" in candidate &&
                    candidate.groups.length &&
                    candidate.groups
                      .flat()
                      .every((step) => step.kind === "talk")
                  )
                    throw new Error(
                      "纯交谈选项请调用 tg_enter_dialogue 进入对话，不提交 talk 行动。",
                    );
                  if (
                    stage === "plan" &&
                    "decision" in candidate &&
                    candidate.decision === "act"
                  )
                    applyPlan(game, PlanSchema.parse(candidate), game.run!.id);
                  if (stage === "reply") {
                    const npcId = (context as { npc: { id: string } }).npc.id;
                    applyReply(
                      game,
                      npcId,
                      ReplySchema.parse(candidate),
                      game.run!.id,
                    );
                  }
                  result = candidate;
                  return "STAGED：结果通过校验，结束本轮。由游戏程序稍后提交。";
                } catch (error) {
                  result = undefined;
                  return "REJECTED：" + errorText(error);
                }
              },
            }),
          );
        },
      });
      this.trace?.attach(attempt.sessionId, () =>
        handle!.agent.session.snapshotEvents(),
      );
      const stop = (): void => handle?.agent.cancel({ kind: "user" });
      signal.addEventListener("abort", stop, { once: true });
      try {
        handle.agent.followup({
          id: randomUUID() as never,
          role: "user",
          source: { kind: "user" },
          content: [{ type: "text", text: messages.user }],
        });
        await handle.agent.whenIdle();
        signal.throwIfAborted();
        const end = handle.agent.session
          .snapshotEvents()
          .findLast((event) => event.type === "turn/end");
        if (end?.type !== "turn/end" || end.data.reason.kind !== "completed")
          failure ||= "模型未正常完成本阶段。";
        if (failure || !result)
          throw new Error(failure || "模型未提交有效结果，可重试。");
        attempt.status = "completed";
        return result;
      } finally {
        signal.removeEventListener("abort", stop);
      }
    } catch (error) {
      attempt.status = signal.aborted ? "cancelled" : "failed";
      attempt.error = errorText(error);
      throw error;
    } finally {
      try {
        await handle?.dispose();
      } catch (error) {
        attempt.status = "failed";
        attempt.error = "释放调用上下文失败：" + errorText(error);
        throw error;
      } finally {
        attempt.ended = new Date().toISOString();
        // Diagnostic index failure must not replay an already resolved model phase.
        await this.trace
          ?.finish(attempt)
          .catch((error) =>
            console.error("[TG] 轨迹索引保存失败", errorText(error)),
          );
      }
    }
  }
}
