import { z } from "zod";
import { SettlementSchema } from "./trace";

export const TIERS = [1, 5, 15, 30] as const;
const text = z.string().max(6000);
const id = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => !["__proto__", "constructor", "prototype"].includes(value),
    "保留编号不可使用",
  );
const count = z.number().int().nonnegative().max(1000000);
export const ModelSchema = z.object({ provider: id, model: id });
export type ModelChoice = z.infer<typeof ModelSchema>;
export const StepSchema = z
  .object({
    kind: z.enum([
      "talk",
      "investigate",
      "move",
      "deliver",
      "report",
      "accept",
      "decline",
      "abandon",
      "buy",
      "use",
      "rest",
      "sleep",
      "wait",
      "study",
      "exercise",
      "discover",
      "meet",
    ]),
    target: z.string().max(160).default(""),
    item: z.string().max(160).default(""),
    text: text.default(""),
    minutes: z.number().int().min(1).max(1440).optional(),
    location: z
      .object({ id, name: id, region: id, description: text })
      .optional(),
    npc: z.object({ id, name: id, profile: text.min(1) }).optional(),
  })
  .strict();
export const AmbientSchema = z
  .object({
    text: text.min(1),
    effects: z.partialRecord(
      z.enum([
        "health",
        "stamina",
        "stress",
        "trauma",
        "hunger",
        "control",
        "arousal",
      ]),
      z.number().int().min(-100).max(100),
    ),
  })
  .strict();
export const PlanSchema = z
  .object({
    decision: z.enum(["act", "clarify", "reject"]),
    message: text,
    groups: z.array(z.array(StepSchema).min(1).max(4)).max(8),
    ambient: AmbientSchema.nullable().optional(),
  })
  .strict();
export type Step = z.infer<typeof StepSchema>;
export type ActionPlan = z.infer<typeof PlanSchema>;
export const LocationSchema = z.object({
  id,
  region: id,
  name: id,
  description: text,
  routes: z.record(id, z.number().int().min(1).max(1440)),
  generated: z.boolean(),
});
export const ItemSchema = z.object({ id, name: id, description: text });
const GoalSchema = z.object({
  kind: z.enum(["investigate", "deliver", "report"]),
  target: id,
  item: z.string().max(160),
  done: z.boolean(),
  text,
});
export const QuestSchema = z.object({
  id,
  title: id,
  description: text,
  giver: id,
  status: z.enum(["active", "blocked", "completed", "ended"]),
  reason: text,
  goals: z.array(GoalSchema).min(1).max(6),
  due: count.nullable(),
});
export const OfferSchema = z.object({
  id,
  npcId: id,
  message: text,
  kind: z.enum(["gift", "quest"]),
  item: z.string().max(160),
  quantity: z.number().int().min(1).max(20),
  quest: QuestSchema.nullable(),
  status: z.enum(["offered", "accepted", "declined"]),
});
export const ReplySchema = z
  .object({
    text: text.min(1),
    relationship: z.number().int().min(-5).max(5),
    offers: z
      .array(
        z
          .object({
            kind: z.enum(["gift", "quest"]),
            message: text,
            item: z.string().max(160),
            quantity: z.number().int().min(1).max(20),
            quest: QuestSchema.nullable(),
          })
          .strict(),
      )
      .max(2),
  })
  .strict();
export type Reply = z.infer<typeof ReplySchema>;
export const SceneSchema = z
  .object({
    description: text.min(1),
    options: z
      .array(
        z
          .object({
            label: z.string().min(1).max(100),
            input: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict();
export type Scene = z.infer<typeof SceneSchema>;
const NpcSchema = z.object({
  id,
  name: id,
  profile: text,
  location: id,
  relationship: z.number().min(-100).max(100),
  items: z.record(id, count),
  money: count,
  knowledge: z.array(text),
  history: z.array(text),
  availableUntil: count.nullable(),
});
const StatsSchema = z.object({
  health: z.number().min(0).max(100),
  stamina: z.number().min(0).max(80),
  stress: z.number().min(0).max(100),
  hunger: z.number().min(0).max(100),
  trauma: z.number().min(0).max(100),
  control: z.number().min(0).max(100),
  arousal: z.number().min(0).max(100),
  allure: z.number().min(0).max(100),
  reputation: z.number(),
  money: count,
});
export const MemorySchema = z.object({
  id: z.string().min(1).max(400),
  kind: z.enum(["observation", "dialogue", "action_result"]),
  text: z.string().max(12000),
  minute: count,
  locationId: id,
  actionId: id,
  generation: count,
  speakerId: z.string().max(160),
  knownBy: z.array(id).min(1),
  relatedNpcIds: z.array(id),
  relatedItemIds: z.array(id),
  relatedQuestIds: z.array(id),
});
export type MemoryRecord = z.infer<typeof MemorySchema>;
export const WorldSchema = z.object({
  name: id,
  minute: count,
  location: id,
  stats: StatsSchema,
  skills: z.record(id, count),
  inventory: z.record(id, count),
  locations: z.record(id, LocationSchema),
  items: z.record(id, ItemSchema),
  npcs: z.record(id, NpcSchema),
  quests: z.record(id, QuestSchema),
  offers: z.record(id, OfferSchema),
  facts: z.array(text),
  investigations: z.record(id, z.array(text)),
  weather: id,
  rentPaid: z.boolean(),
  over: text,
  seed: z.number().int().nonnegative().max(4294967295),
  events: z.array(z.object({ minute: count, text, actionId: id })),
  memories: z.array(MemorySchema).optional(),
});
export type World = z.infer<typeof WorldSchema>;
export type Quest = z.infer<typeof QuestSchema>;
export const StageSchema = z.enum(["plan", "reply", "scene", "done"]);
export const RunSchema = z.object({
  kind: z.enum(["action", "dialogue", "exitDialogue"]).optional(),
  optionId: z.string().optional(),
  id,
  input: text,
  stage: StageSchema,
  status: z.enum(["running", "failed", "cancelled", "completed"]),
  error: text,
  result: text,
  npcIds: z.array(id),
  replied: z.array(id),
  playerCommitted: z.boolean(),
});
export type Run = z.infer<typeof RunSchema>;
export const GameSchema = z.object({
  dialogue: z.object({ npcId: id, locationId: id }).nullable().optional(),
  format: z.literal("tg-harness-v1"),
  id,
  revision: count,
  generation: count,
  model: ModelSchema,
  world: WorldSchema,
  run: RunSchema.nullable(),
  scene: z.object({
    description: text,
    options: z.array(z.object({ id, label: id, input: text })).max(6),
  }),
  receipts: z.record(
    id,
    z.object({ input: text, result: text, committed: z.boolean() }),
  ),
  theme: z.enum(["dark", "light"]),
  settlements: z.array(SettlementSchema).optional(),
});
export type Game = z.infer<typeof GameSchema>;
export const SaveSchema = z.object({
  slot: z.number().int().min(0).max(7),
  title: id,
  date: id,
  game: GameSchema,
});
export type Save = z.infer<typeof SaveSchema>;
export function validateGame(input: unknown): Game {
  const game = GameSchema.parse(input);
  const w = game.world;
  if (
    game.dialogue &&
    (!w.npcs[game.dialogue.npcId] ||
      game.dialogue.locationId !== w.location ||
      w.npcs[game.dialogue.npcId].location !== w.location)
  )
    throw new Error("对话对象或对话位置无效");
  const memoryIds = new Set<string>();
  for (const memory of w.memories ?? []) {
    if (
      memoryIds.has(memory.id) ||
      !w.locations[memory.locationId] ||
      memory.knownBy.some((who) => who !== "player" && !w.npcs[who]) ||
      (memory.speakerId &&
        memory.speakerId !== "player" &&
        !w.npcs[memory.speakerId]) ||
      memory.relatedNpcIds.some((npc) => !w.npcs[npc]) ||
      memory.relatedItemIds.some((item) => !w.items[item]) ||
      memory.relatedQuestIds.some(
        (quest) =>
          !w.quests[quest] &&
          !Object.values(w.offers).some((o) => o.quest?.id === quest),
      )
    )
      throw new Error("经历记录的编号、知情者或关联对象无效");
    memoryIds.add(memory.id);
  }
  if (!w.locations[w.location]) throw new Error("存档中的位置不存在");
  for (const [key, place] of Object.entries(w.locations)) {
    if (key !== place.id) throw new Error("地点编号不一致");
    for (const next of Object.keys(place.routes))
      if (!w.locations[next]) throw new Error("路线目标不存在");
  }
  for (const [key, npc] of Object.entries(w.npcs)) {
    if (key !== npc.id || !w.locations[npc.location])
      throw new Error("人物编号或位置无效");
    for (const item of Object.keys(npc.items))
      if (!w.items[item]) throw new Error("人物物品定义缺失");
  }
  for (const [key, item] of Object.entries(w.items))
    if (key !== item.id) throw new Error("物品编号不一致");
  for (const key of Object.keys(w.inventory))
    if (!w.items[key]) throw new Error("物品定义缺失");
  const checkQuest = (q: Quest): void => {
    if (!w.npcs[q.giver]) throw new Error("任务发布者不存在");
    for (const goal of q.goals)
      if (
        !(goal.kind === "investigate"
          ? w.locations[goal.target]
          : w.npcs[goal.target]) ||
        (goal.item && !w.items[goal.item])
      )
        throw new Error("任务目标无效");
  };
  for (const [key, q] of Object.entries(w.quests)) {
    if (key !== q.id) throw new Error("任务编号不一致");
    checkQuest(q);
  }
  for (const [key, offer] of Object.entries(w.offers)) {
    if (key !== offer.id || !w.npcs[offer.npcId])
      throw new Error("提议编号或人物无效");
    if (offer.kind === "quest") {
      if (!offer.quest) throw new Error("缺少任务提议");
      checkQuest(offer.quest);
    } else if (offer.item !== "money" && !w.items[offer.item])
      throw new Error("礼物不存在");
  }
  if (game.run) {
    const run = game.run;
    if (
      run.kind === "dialogue" &&
      (!game.dialogue ||
        !["reply", "done"].includes(run.stage) ||
        run.npcIds.some((npc) => npc !== game.dialogue!.npcId))
    )
      throw new Error("对话阶段或回应人物无效");
    if (run.kind === "exitDialogue" && game.dialogue)
      throw new Error("退出对话状态不一致");
    if (run.playerCommitted && run.stage === "plan")
      throw new Error("已结算行动不能回到理解阶段");
    if (run.stage === "reply" && !run.playerCommitted)
      throw new Error("人物回应缺少已结算行动");
    if (
      run.npcIds.some((n) => !w.npcs[n]) ||
      run.replied.some((n) => !run.npcIds.includes(n))
    )
      throw new Error("回应人物记录无效");
    if (run.playerCommitted && !game.receipts[run.id]?.committed)
      throw new Error("缺少行动提交记录");
  }
  return game;
}
