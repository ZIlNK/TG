import type { buildActionContext } from "../../core/context";
import {
  dataSection,
  safe,
  environmentVariables,
  type PromptVariables,
} from "./format";

export type ActionContext = ReturnType<typeof buildActionContext>;

export function planVariables(
  context: ActionContext & { ambientOpportunity: boolean },
): PromptVariables {
  const { input, scene, time, minute, weather, place, memories, ...state } =
    context;
  return {
    ...environmentVariables(context),
    input,
    "player.name": safe(state.player.name),
    scene: dataSection("玩家正在查看的现场", { scene }),
    state: dataSection("行动依据", state),
    memories: dataSection("知情经历", { memories }),
  };
}
