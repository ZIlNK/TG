import content from "../content/legacy.json";
import { type Game, type ModelChoice, type World } from "./schema";

export const BALANCE = {
  localTravel: 5,
  regionTravel: 15,
  sleepStaminaPerHour: 10,
  sleepStressPerHour: 2.5,
} as const;
const areas: Record<string, [string, string][]> = {
  Bedroom: [["bedroom_main", "卧室内"]],
  Street: [
    ["street_main", "街道主路"],
    ["food_stall", "早餐摊"],
    ["convenience_store_entrance", "便利店门口"],
    ["bus_stop", "公交站"],
  ],
  Park: [
    ["park_entrance", "公园入口"],
    ["park_path", "林间小径"],
    ["fountain", "中央喷泉"],
    ["benches", "长椅区"],
  ],
  Shop: [
    ["shop_entrance", "商店入口"],
    ["shop_aisles", "货架区"],
    ["shop_counter", "收银台"],
  ],
};
export const PRODUCTS = [
  {
    id: "pancake",
    name: "煎饼果子",
    place: "Street/food_stall",
    price: 6,
    stamina: 6,
    hunger: -15,
  },
  {
    id: "soymilk",
    name: "热豆浆",
    place: "Street/food_stall",
    price: 2,
    stamina: 2,
    hunger: -5,
  },
  {
    id: "breakfast",
    name: "早餐套餐",
    place: "Street/food_stall",
    price: 8,
    stamina: 8,
    hunger: -20,
  },
  {
    id: "meal",
    name: "快餐",
    place: "Shop/shop_counter",
    price: 5,
    stamina: 20,
    hunger: -30,
  },
];
export function createWorld(name: string): World {
  const locations: World["locations"] = {};
  for (const [region, list] of Object.entries(areas)) {
    for (const [area, title] of list) {
      const key = `${region}/${area}`;
      locations[key] = {
        id: key,
        region,
        name: title,
        description:
          content.locations[region as keyof typeof content.locations].lore,
        routes: {},
        generated: false,
      };
      for (const [other] of list)
        if (other !== area)
          locations[key].routes[`${region}/${other}`] = BALANCE.localTravel;
    }
  }
  for (const region of ["Bedroom", "Park", "Shop"]) {
    const key = `${region}/${areas[region][0][0]}`;
    locations[key].routes["Street/street_main"] = BALANCE.regionTravel;
    locations["Street/street_main"].routes[key] = BALANCE.regionTravel;
  }
  const npcs: World["npcs"] = {};
  for (const [id, raw] of Object.entries(content.characterCards)) {
    const card = raw as Record<string, unknown>;
    const resources = card.agencyResources as {
      money: number;
      items: Record<string, number>;
    };
    npcs[id] = {
      id,
      name: String(card.name),
      profile: JSON.stringify({
        role: card.role,
        description: card.description,
        personality: card.personality,
        dialogueExamples: card.dialogueExamples,
      }).slice(0, 6000),
      location: `${card.locationId}/${card.areaId}`,
      relationship: 0,
      items: resources?.items || {},
      money: resources?.money || 0,
      knowledge: [String(card.scenario || "")],
      history: [],
      availableUntil: null,
    };
  }
  const items: World["items"] = {
    "blank-paper": {
      id: "blank-paper",
      name: "空白纸",
      description: "可以写字或画画的纸。",
    },
  };
  for (const p of PRODUCTS)
    items[p.id] = {
      id: p.id,
      name: p.name,
      description: "食物，使用后恢复体力并缓解饥饿。",
    };
  return {
    name,
    minute: 480,
    location: "Bedroom/bedroom_main",
    stats: {
      health: 100,
      stamina: 80,
      stress: 10,
      hunger: 0,
      trauma: 0,
      control: 100,
      arousal: 0,
      allure: 15,
      reputation: 0,
      money: 25,
    },
    skills: { 运动: 0, 学识: 0, 社交: 0, 潜行: 0, 感知: 0, 意志: 0, 魅力: 0 },
    inventory: {},
    locations,
    items,
    npcs,
    quests: {},
    offers: {},
    facts: [],
    investigations: {},
    weather: "晴",
    rentPaid: false,
    over: "",
    seed: 1729,
    events: [],
  };
}
export function createGame(id: string, name: string, model: ModelChoice): Game {
  return {
    format: "tg-harness-v1",
    id,
    revision: 0,
    generation: 0,
    model,
    world: createWorld(name),
    run: null,
    scene: {
      description:
        "新的一天从卧室开始。输入你想做的事，或生成当前现场的行动选项。",
      options: [],
    },
    receipts: {},
    theme: "dark",
  };
}
export function npcPresent(w: World, id: string): boolean {
  const npc = w.npcs[id];
  return Boolean(
    npc &&
      npc.location === w.location &&
      (npc.availableUntil === null || w.minute <= npc.availableUntil),
  );
}
export function clockLabel(minute: number): string {
  return `第 ${Math.floor(minute / 1440) + 1} 天 · ${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
