import type { Game, MemoryRecord } from "./schema";
import { clockLabel, npcPresent, photoQuest, PRODUCTS } from "./world";

function gameTime(minute: number): { label: string; period: string } {
  const hour = Math.floor(minute / 60) % 24;
  const period =
    hour < 5
      ? "凌晨"
      : hour < 8
        ? "清晨"
        : hour < 12
          ? "上午"
          : hour < 14
            ? "中午"
            : hour < 18
              ? "下午"
              : hour < 20
                ? "傍晚"
                : "夜间";
  return { label: clockLabel(minute), period };
}

function records(game: Game, viewer: string): MemoryRecord[] {
  // Permissions precede relevance and limits. Never mix private memories in a summary.
  return (game.world.memories ?? []).filter((m) => m.knownBy.includes(viewer));
}
function publicPlace(game: Game) {
  const p = game.world.locations[game.world.location];
  return {
    id: p.id,
    name: p.name,
    region: p.region,
    description: p.description,
  };
}
function playerContext(game: Game, input: string) {
  const w = game.world;
  const mentioned = (id: string, name: string): boolean =>
    input.includes(id) || input.includes(name);
  const npcs = Object.values(w.npcs)
    .filter((n) => npcPresent(w, n.id) || mentioned(n.id, n.name))
    .map((n) => ({ id: n.id, name: n.name, present: npcPresent(w, n.id) }));
  const npcIds = new Set(npcs.map((n) => n.id));
  const quests = Object.values(w.quests).filter(
    (q) =>
      mentioned(q.id, q.title) ||
      npcIds.has(q.giver) ||
      q.goals.some((g) => g.target === w.location),
  );
  const questIds = new Set(quests.map((q) => q.id));
  const products = PRODUCTS.filter(
    (p) => p.place === w.location || Boolean(w.inventory[p.id]),
  );
  const itemIds = new Set([
    ...Object.keys(w.inventory),
    ...products.map((p) => p.id),
  ]);
  const memories = records(game, "player")
    .filter(
      (m) =>
        m.actionId === game.run?.id ||
        m.locationId === w.location ||
        m.relatedNpcIds.some((id) => npcIds.has(id)) ||
        m.relatedQuestIds.some((id) => questIds.has(id)),
    )
    .slice(-30);
  return {
    minute: w.minute,
    time: gameTime(w.minute),
    weather: w.weather,
    place: publicPlace(game),
    player: {
      name: w.name,
      stats: w.stats,
      skills: w.skills,
      inventory: w.inventory,
      rentPaid: w.rentPaid,
      over: w.over,
    },
    npcs,
    routes: Object.entries(w.locations[w.location].routes).map(
      ([id, minutes]) => ({ id, name: w.locations[id].name, minutes }),
    ),
    // Name-only directory permits explicit distant targets without disclosing private profiles.
    locations: Object.values(w.locations)
      .filter((p) => mentioned(p.id, p.name))
      .map((p) => ({ id: p.id, name: p.name, region: p.region })),
    regions: [...new Set(Object.values(w.locations).map((p) => p.region))],
    items: Object.values(w.items).filter((i) => itemIds.has(i.id)),
    products,
    quests,
    offers: Object.values(w.offers).filter(
      (o) => npcIds.has(o.npcId) && o.status === "offered",
    ),
    investigation: (w.investigations[w.location] ?? []).slice(-10),
    memories,
  };
}
export function buildActionContext(game: Game, input: string) {
  return structuredClone({
    ...playerContext(game, input),
    input,
    scene: game.scene,
  });
}
export function buildSceneContext(game: Game) {
  return structuredClone({
    ...playerContext(game, ""),
    actionResult: game.run?.playerCommitted ? game.run.result : "",
    currentActionId: game.run?.id ?? null,
  });
}
export function buildNpcContext(game: Game, npcId: string) {
  const w = game.world,
    n = w.npcs[npcId];
  if (!n || !npcPresent(w, npcId))
    throw new Error("对方不在当前现场，无法进行这次互动。");
  const visible = records(game, npcId);
  return structuredClone({
    npc: {
      id: n.id,
      name: n.name,
      profile: n.profile,
      relationship: n.relationship,
      items: n.items,
      money: n.money,
      knowledge: n.knowledge.slice(-20),
      history: n.history.slice(-12),
    },
    place: publicPlace(game),
    minute: w.minute,
    time: gameTime(w.minute),
    weather: w.weather,
    playerName: w.name,
    currentActionId: game.run?.id ?? null,
    memories: visible.slice(-30),
    offers: Object.values(w.offers).filter((o) => o.npcId === npcId),
    quests: Object.values(w.quests)
      .filter((q) => q.giver === npcId)
      .map((q) => ({ id: q.id, title: q.title, description: q.description })),
    itemDefinitions: Object.values(w.items).filter((i) => n.items[i.id]),
    photoQuestTemplate: npcId === "linwanqing" ? photoQuest() : null,
  });
}

export function queryContext(
  game: Game,
  stage: "plan" | "reply" | "scene",
  query: string,
  npcId?: string,
) {
  if (stage === "reply" && !npcId) throw new Error("缺少人物身份");
  const viewer = stage === "reply" ? npcId! : "player";
  const text = query.trim().slice(0, 200);
  const visible = records(game, viewer).filter(
    (m) =>
      !text ||
      m.text.includes(text) ||
      m.relatedNpcIds.includes(text) ||
      m.relatedItemIds.includes(text) ||
      m.relatedQuestIds.includes(text),
  );
  return structuredClone({
    context:
      stage === "reply"
        ? buildNpcContext(game, npcId!)
        : stage === "plan"
          ? buildActionContext(game, `${game.run?.input ?? ""} ${text}`)
          : buildSceneContext(game),
    matchingMemories: visible.slice(-30),
    totalMatches: visible.length,
  });
}
