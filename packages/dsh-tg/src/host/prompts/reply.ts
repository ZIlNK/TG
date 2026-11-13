import type { buildNpcContext } from "../../core/context";
import {
  dataSection,
  safe,
  environmentVariables,
  type PromptVariables,
} from "./format";

export type NpcContext = ReturnType<typeof buildNpcContext>;

export function replyVariables(context: NpcContext): PromptVariables {
  const {
    npc,
    time,
    minute,
    weather,
    place,
    playerName,
    memories,
    currentActionId,
    ...state
  } = context;
  const interaction = memories.filter(
    (memory) => currentActionId !== null && memory.actionId === currentActionId,
  );
  const history = memories.filter(
    (memory) => currentActionId === null || memory.actionId !== currentActionId,
  );
  return {
    ...environmentVariables(context),
    "npc.name": safe(npc.name),
    "npc.id": safe(npc.id),
    "npc.relationship": String(npc.relationship),
    "npc.profile": safe(npc.profile),
    "npc.knowledge": npc.knowledge.length
      ? npc.knowledge.map(safe).join("；")
      : "暂无记录",
    "npc.history": npc.history.length
      ? npc.history.map(safe).join("；")
      : "暂无记录",
    playerName: safe(playerName),
    resources: dataSection("你持有的资源", {
      items: npc.items,
      money: npc.money,
    }),
    state: dataSection("人物可知资料", state),
    memories: dataSection("知情历史经历", { memories: history }),
    interaction: dataSection("本轮互动", {
      currentActionId,
      memories: interaction,
    }),
  };
}
