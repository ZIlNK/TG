import {
  PlanSchema,
  ReplySchema,
  type ActionPlan,
  type Game,
  type Reply,
  type Step,
  type World,
  type MemoryRecord,
  TIERS,
} from "./schema";
import { buildNpcContext } from "./context";
import { BALANCE, npcPresent, PRODUCTS } from "./world";

export const copy = <T>(value: T): T => structuredClone(value);
export const nextSeed = (seed: number): number =>
  (Math.imul(seed, 1664525) + 1013904223) >>> 0;
export const ambientOpportunity = (game: Game): boolean =>
  nextSeed(game.world.seed) / 4294967296 < 0.25;
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const clamp = (value: number, max = 100): number =>
  Math.max(0, Math.min(max, value));
function present(w: World, npcId: string): World["npcs"][string] {
  requireRule(npcPresent(w, npcId), "对方不在当前现场，无法进行这次互动。");
  return w.npcs[npcId];
}
function take(items: Record<string, number>, id: string, amount = 1): void {
  requireRule((items[id] || 0) >= amount, "没有足够的该物品。");
  items[id] -= amount;
  if (!items[id]) delete items[id];
}
function learn(w: World, npcId: string, message: string): void {
  const npc = present(w, npcId);
  npc.knowledge.push(message);
  npc.history.push(`玩家：${message}`);
}
export function refreshQuests(w: World): void {
  for (const q of Object.values(w.quests)) {
    if (q.status === "completed" || q.status === "ended") continue;
    if (q.due !== null && w.minute > q.due) {
      q.status = "ended";
      q.reason = "超过约定期限";
    } else if (q.goals.every((g) => g.done)) {
      q.status = "completed";
      q.reason = "全部目标已完成";
    } else {
      const objective = q.goals.find((g) => !g.done)!;
      const npc = w.npcs[objective.target];
      const unavailable =
        npc?.availableUntil !== null &&
        npc?.availableUntil !== undefined &&
        w.minute > npc.availableUntil;
      q.status = unavailable ? "blocked" : "active";
      q.reason = unavailable ? "需要的人物暂时不在场" : "";
    }
  }
}
function progress(
  w: World,
  kind: "investigate" | "deliver" | "report",
  target: string,
  item = "",
): void {
  for (const q of Object.values(w.quests)) {
    if (q.status === "completed" || q.status === "ended") continue;
    const goal = q.goals.find((g) => !g.done);
    if (
      goal?.kind === kind &&
      goal.target === target &&
      (!goal.item || goal.item === item)
    )
      goal.done = true;
  }
}
function step(
  w: World,
  s: Step,
  actionId: string,
  npcIds: Set<string>,
): { minutes: number; result: string } {
  let minutes =
    s.minutes ||
    ([
      "talk",
      "deliver",
      "accept",
      "decline",
      "report",
      "buy",
      "use",
      "abandon",
    ].includes(s.kind)
      ? 1
      : 5);
  if (!["move", "sleep", "wait"].includes(s.kind))
    requireRule(
      (TIERS as readonly number[]).includes(minutes),
      "行动耗时必须使用 1、5、15、30 分钟档位。",
    );
  const name = (npc: string): string => {
    const n = present(w, npc);
    npcIds.add(npc);
    return n.name;
  };
  switch (s.kind) {
    case "move": {
      const route = w.locations[w.location].routes[s.target];
      requireRule(route, "当前地点没有通往目标的路线。");
      w.location = s.target;
      return { minutes: route, result: `到达${w.locations[s.target].name}。` };
    }
    case "talk": {
      const who = name(s.target);
      requireRule(s.text.trim(), "需要说明想说什么。");
      learn(w, s.target, s.text);
      return { minutes, result: `你对${who}说：“${s.text}”` };
    }
    case "investigate": {
      requireRule(!s.target || s.target === w.location, "只能调查当前地点。");
      const detail = s.text || "查看现场";
      const history = (w.investigations[w.location] ||= []);
      const repeated = history.includes(detail);
      history.push(detail);
      w.skills.感知 += minutes >= 15 ? 3 : 1;
      const result = repeated
        ? `再次检查${detail}，没有发现新的变化。`
        : `检查了${detail}，记录了调查经过。`;
      progress(w, "investigate", w.location);
      return { minutes, result };
    }
    case "deliver": {
      const who = name(s.target);
      requireRule(w.items[s.item], "物品不存在。");
      take(w.inventory, s.item);
      const npc = w.npcs[s.target];
      npc.items[s.item] = (npc.items[s.item] || 0) + 1;
      const result = `已将${w.items[s.item].name}交给${who}。`;
      learn(w, s.target, result + s.text);
      progress(w, "deliver", s.target, s.item);
      return { minutes, result };
    }
    case "report": {
      const who = name(s.target);
      requireRule(s.text.trim(), "需要说明汇报的内容。");
      learn(w, s.target, s.text);
      progress(w, "report", s.target);
      return { minutes, result: `已向${who}说明：${s.text}` };
    }
    case "accept":
    case "decline": {
      const offer = w.offers[s.target];
      requireRule(
        offer && offer.status === "offered",
        "该提议不存在或已经处理。",
      );
      const who = name(offer.npcId);
      if (s.kind === "accept") {
        if (offer.kind === "gift") {
          if (offer.item === "money") {
            requireRule(
              w.npcs[offer.npcId].money >= offer.quantity,
              "对方没有足够的钱。",
            );
            w.npcs[offer.npcId].money -= offer.quantity;
            w.stats.money += offer.quantity;
          } else {
            take(w.npcs[offer.npcId].items, offer.item, offer.quantity);
            w.inventory[offer.item] =
              (w.inventory[offer.item] || 0) + offer.quantity;
          }
        } else {
          requireRule(
            offer.quest && !w.quests[offer.quest.id],
            "任务已经存在。",
          );
          w.quests[offer.quest.id] = copy(offer.quest);
        }
      }
      offer.status = s.kind === "accept" ? "accepted" : "declined";
      const result = `已${s.kind === "accept" ? "接受" : "婉拒"}${who}的提议。`;
      learn(w, offer.npcId, result);
      return { minutes, result };
    }
    case "abandon": {
      const quest = w.quests[s.target];
      requireRule(
        quest && ["active", "blocked"].includes(quest.status),
        "没有可放弃的该任务。",
      );
      quest.status = "ended";
      quest.reason = "玩家主动放弃";
      return { minutes, result: `已放弃${quest.title}，经历仍保留。` };
    }
    case "buy": {
      requireRule(
        s.item,
        '购买必须在 item 中填写商品编号，例如 {kind:"buy",item:"pancake"}。',
      );
      if (s.item === "rent") {
        requireRule(
          w.location === "Bedroom/bedroom_main" && !w.rentPaid,
          "只能在卧室支付尚未支付的房租。",
        );
        requireRule(w.stats.money >= 50, "支付房租需要 50 元。");
        w.stats.money -= 50;
        w.rentPaid = true;
        return { minutes, result: "已支付本期房租 50 元。" };
      }
      const product = PRODUCTS.find(
        (p) => p.id === s.item && p.place === w.location,
      );
      requireRule(product, "这里没有出售该商品。");
      const hour = Math.floor(w.minute / 60) % 24;
      requireRule(hour >= 6 && hour < 22, "店铺目前未营业。");
      requireRule(w.stats.money >= product.price, "金钱不足，尚未扣款。");
      w.stats.money -= product.price;
      w.inventory[s.item] = (w.inventory[s.item] || 0) + 1;
      return {
        minutes,
        result: `花费 ${product.price} 元购买${product.name}，已放入背包。`,
      };
    }
    case "use": {
      requireRule(
        s.item,
        '使用必须在 item 中填写物品编号，例如 {kind:"use",item:"pancake"}。',
      );
      const product = PRODUCTS.find((p) => p.id === s.item);
      requireRule(product, "该物品不能这样使用。");
      take(w.inventory, s.item);
      w.stats.stamina = clamp(w.stats.stamina + product.stamina, 80);
      w.stats.hunger = clamp(w.stats.hunger + product.hunger);
      return { minutes, result: `吃了${product.name}。` };
    }
    case "sleep": {
      requireRule(
        w.location === "Bedroom/bedroom_main",
        "需要先回到卧室才能睡觉。",
      );
      requireRule(s.minutes, "请说明睡眠时长。");
      w.stats.stamina = clamp(
        w.stats.stamina + (minutes / 60) * BALANCE.sleepStaminaPerHour,
        80,
      );
      w.stats.stress = clamp(
        w.stats.stress - (minutes / 60) * BALANCE.sleepStressPerHour,
      );
      w.skills.意志 += Math.floor(minutes / 80);
      return { minutes, result: `睡眠 ${minutes} 分钟。` };
    }
    case "rest": {
      w.stats.stamina = clamp(w.stats.stamina + (minutes / 60) * 25, 80);
      w.stats.stress = clamp(w.stats.stress - (minutes / 60) * 10);
      return { minutes, result: `休息 ${minutes} 分钟。` };
    }
    case "wait":
      requireRule(s.minutes, "请说明等待时长。");
      return { minutes, result: `等待 ${minutes} 分钟。` };
    case "study": {
      requireRule(
        w.stats.stress <= 70 && w.stats.stamina >= minutes / 6,
        "目前太疲惫或压力太大，无法集中学习。",
      );
      w.stats.stamina = clamp(w.stats.stamina - minutes / 6, 80);
      w.stats.stress = clamp(w.stats.stress - minutes / 24);
      w.skills.学识 += Math.max(1, Math.floor(minutes / 15));
      return { minutes, result: `专注学习 ${minutes} 分钟。` };
    }
    case "exercise": {
      requireRule(w.stats.stamina >= minutes, "体力不足以完成这次锻炼。");
      w.stats.stamina -= minutes;
      w.skills.运动 += Math.max(1, Math.floor(minutes / 5));
      return { minutes, result: `锻炼 ${minutes} 分钟。` };
    }
    case "discover": {
      requireRule(s.location, "缺少新地点信息。");
      const loc = s.location;
      requireRule(!w.locations[loc.id], "地点编号已存在。");
      requireRule(
        Object.values(w.locations).some((l) => l.region === loc.region),
        "新地点必须属于已知区域。",
      );
      const travel =
        loc.region === w.locations[w.location].region
          ? BALANCE.localTravel
          : BALANCE.regionTravel;
      w.locations[loc.id] = {
        ...loc,
        routes: { [w.location]: travel },
        generated: true,
      };
      w.locations[w.location].routes[loc.id] = travel;
      return {
        minutes,
        result: `发现通往${loc.name}的路线，你仍在${w.locations[w.location].name}。`,
      };
    }
    case "meet": {
      requireRule(s.npc && !w.npcs[s.npc.id], "新人物需要使用未登记的编号。");
      const n = s.npc;
      w.npcs[n.id] = {
        ...n,
        location: w.location,
        relationship: 0,
        items: {},
        money: 0,
        knowledge: [`在${w.locations[w.location].name}初次遇见${w.name}。`],
        history: [],
        availableUntil: null,
      };
      npcIds.add(n.id);
      return {
        minutes,
        result: `在${w.locations[w.location].name}遇见${n.name}，人物已经登记。`,
      };
    }
  }
}
function advance(w: World, minutes: number, actionId: string): void {
  const oldDay = Math.floor(w.minute / 1440);
  w.minute += minutes;
  w.stats.hunger = clamp(w.stats.hunger + (minutes / 120) * 5);
  for (let day = oldDay + 1; day <= Math.floor(w.minute / 1440); day++) {
    w.seed = nextSeed(w.seed);
    w.weather = ["晴", "雨", "多云", "雾"][w.seed % 4];
    for (const npc of Object.values(w.npcs))
      npc.relationship -= Math.sign(npc.relationship);
    w.events.push({
      minute: day * 1440,
      actionId,
      text: `进入第 ${day + 1} 天，天气：${w.weather}。`,
    });
    if (day + 1 >= 7 && !w.rentPaid)
      w.events.push({
        minute: day * 1440,
        actionId,
        text: "房租已到期，记得在卧室支付 50 元。",
      });
  }
}
export function applyPlan(
  game: Game,
  input: ActionPlan,
  actionId: string,
): { world: World; minutes: number; result: string; npcIds: string[] } {
  const plan = PlanSchema.parse(input);
  requireRule(
    plan.decision === "act" && plan.groups.length,
    "没有可执行行动。",
  );
  requireRule(!game.world.over, "本局已经结束，请重新开局。");
  const w = copy(game.world);
  const npcIds = new Set<string>();
  const results: string[] = [];
  let total = 0;
  const mayGenerateEvent = ambientOpportunity(game);
  w.seed = nextSeed(w.seed);
  // All steps operate on an isolated draft; any failed precondition discards the entire draft.
  for (const group of plan.groups) {
    const movement = group.filter((s) =>
      ["move", "sleep", "wait"].includes(s.kind),
    );
    requireRule(
      group.length === 1 || !movement.length,
      "移动、睡眠或等待需要按先后顺序单独处理。",
    );
    const handled = group.map((s) => {
      const before = copy(w);
      const outcome = step(w, s, actionId, npcIds);
      const npcId = ["talk", "report", "deliver"].includes(s.kind)
        ? s.target
        : ["accept", "decline"].includes(s.kind)
          ? before.offers[s.target]?.npcId
          : s.kind === "meet"
            ? s.npc?.id
            : undefined;
      const itemIds = new Set(s.item && w.items[s.item] ? [s.item] : []);
      for (const id of new Set([
        ...Object.keys(before.inventory),
        ...Object.keys(w.inventory),
      ]))
        if (before.inventory[id] !== w.inventory[id]) itemIds.add(id);
      const questIds = Object.keys(w.quests).filter(
        (id) =>
          id === s.target ||
          JSON.stringify(before.quests[id]) !== JSON.stringify(w.quests[id]),
      );
      if (before.offers[s.target]?.quest)
        questIds.push(before.offers[s.target].quest!.id);
      return {
        ...outcome,
        memory: {
          kind: ["talk", "report"].includes(s.kind)
            ? "dialogue"
            : s.kind === "investigate"
              ? "observation"
              : "action_result",
          text: outcome.result,
          locationId: w.location,
          speakerId: ["talk", "report"].includes(s.kind) ? "player" : "",
          knownBy: npcId ? ["player", npcId] : ["player"],
          relatedNpcIds: npcId ? [npcId] : [],
          relatedItemIds: [...itemIds],
          relatedQuestIds: [...new Set(questIds)],
        } satisfies Omit<
          MemoryRecord,
          "id" | "minute" | "actionId" | "generation"
        >,
      };
    });
    const minutes = Math.max(...handled.map((h) => h.minutes));
    total += minutes;
    requireRule(total <= 1440, "一次行动最多处理一天的时间。");
    advance(w, minutes, actionId);
    for (const [index, h] of handled.entries()) {
      addMemory(w, game, actionId, h.memory);
      if (group[index].kind === "deliver" && group[index].text.trim())
        addMemory(w, game, actionId, {
          ...h.memory,
          kind: "dialogue",
          speakerId: "player",
          text: group[index].text,
        });
    }
    results.push(...handled.map((h) => h.result));
    refreshQuests(w);
  }
  if (plan.ambient) {
    requireRule(
      mayGenerateEvent,
      "这次行动没有触发世界事件，不能另行附加效果。",
    );
    for (const [key, amount] of Object.entries(plan.ambient.effects)) {
      if (amount === undefined) continue;
      const stat = key as keyof typeof plan.ambient.effects;
      w.stats[stat] = clamp(
        w.stats[stat] + amount,
        stat === "stamina" ? 80 : 100,
      );
    }
    w.events.push({ minute: w.minute, text: plan.ambient.text, actionId });
    results.push(plan.ambient.text);
    addMemory(w, game, actionId, {
      kind: "observation",
      text: plan.ambient.text,
      locationId: w.location,
      speakerId: "",
      knownBy: ["player"],
      relatedNpcIds: [],
      relatedItemIds: [],
      relatedQuestIds: [],
    });
  }
  // Threshold consequences belong to the player action settlement, never to rendering or retries.
  if (w.stats.stamina <= 0) {
    w.stats.health = clamp(w.stats.health - 5);
    w.stats.trauma = clamp(w.stats.trauma + 2);
  }
  if (w.stats.stress >= 80) w.stats.control = clamp(w.stats.control - 5);
  if (w.stats.stress >= 100) {
    w.stats.trauma = clamp(w.stats.trauma + 10);
    w.stats.stress = 90;
  }
  if (w.stats.hunger >= 80) {
    w.stats.stamina = clamp(w.stats.stamina - 10, 80);
    w.stats.health = clamp(w.stats.health - 2);
  }
  if (!w.stats.health || w.stats.trauma >= 100)
    w.over = !w.stats.health ? "健康耗尽" : "创伤达到上限";
  const result = results.join("\n");
  w.events.push({ minute: w.minute, text: result, actionId });
  return {
    world: w,
    minutes: total,
    result,
    npcIds: [...npcIds].filter((npc) => npcPresent(w, npc)),
  };
}
export const npcContext = buildNpcContext;
export function applyReply(
  game: Game,
  npcId: string,
  value: Reply,
  actionId: string,
): World {
  const reply = ReplySchema.parse(value);
  const w = copy(game.world);
  const n = present(w, npcId);
  n.relationship = Math.max(
    -100,
    Math.min(100, n.relationship + reply.relationship),
  );
  n.history.push(`${n.name}：${reply.text}`);
  for (const [i, proposed] of reply.offers.entries()) {
    if (proposed.kind === "gift")
      requireRule(
        proposed.item === "money"
          ? n.money >= proposed.quantity
          : w.items[proposed.item] &&
              (n.items[proposed.item] || 0) >= proposed.quantity,
        "NPC 不能赠送其未持有的物品或金钱。",
      );
    else {
      requireRule(
        proposed.quest &&
          proposed.quest.giver === npcId &&
          !w.quests[proposed.quest.id],
        "新任务无效或已存在。",
      );
      requireRule(
        !Object.values(w.offers).some(
          (o) =>
            o.kind === "quest" &&
            o.status === "offered" &&
            o.quest?.id === proposed.quest!.id,
        ),
        "该任务已经提出。",
      );
      proposed.quest.status = "active";
      proposed.quest.reason = "";
      proposed.quest.goals.forEach((g) => {
        g.done = false;
      });
      for (const goal of proposed.quest.goals) {
        requireRule(
          goal.kind === "investigate"
            ? w.locations[goal.target]
            : w.npcs[goal.target],
          "任务目标不存在。",
        );
        requireRule(!goal.item || w.items[goal.item], "任务物品不存在。");
      }
    }
    const id = `${actionId}:${npcId}:${i}`;
    w.offers[id] = { ...proposed, id, npcId, status: "offered" };
  }
  w.events.push({
    minute: w.minute,
    text: `${n.name}：${reply.text}`,
    actionId,
  });
  addMemory(w, game, actionId, {
    kind: "dialogue",
    text: reply.text,
    locationId: w.location,
    speakerId: npcId,
    expression: reply.expression,
    knownBy: ["player", npcId],
    relatedNpcIds: [npcId],
    relatedItemIds: reply.offers
      .filter((o) => o.kind === "gift" && Boolean(w.items[o.item]))
      .map((o) => o.item),
    relatedQuestIds: reply.offers.flatMap((o) => (o.quest ? [o.quest.id] : [])),
  });
  return w;
}

function addMemory(
  w: World,
  game: Game,
  actionId: string,
  value: Omit<MemoryRecord, "id" | "minute" | "actionId" | "generation">,
): void {
  const memories = (w.memories ??= []);
  memories.push({
    ...value,
    id: actionId + ":" + game.generation + ":" + memories.length,
    minute: w.minute,
    actionId,
    generation: game.generation,
  });
}
