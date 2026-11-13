import type { buildSceneContext } from "../../core/context";
import {
  dataSection,
  safe,
  environmentVariables,
  type PromptVariables,
} from "./format";

export type SceneContext = ReturnType<typeof buildSceneContext>;

export function sceneVariables(context: SceneContext): PromptVariables {
  const {
    time,
    minute,
    weather,
    place,
    actionResult,
    currentActionId,
    memories,
    ...state
  } = context;
  return {
    ...environmentVariables(context),
    "player.name": safe(state.player.name),
    state: dataSection("当前可见状态与选项依据", state),
    result: dataSection("结算结果", { actionResult, currentActionId }),
    memories: dataSection("知情经历", { memories }),
  };
}
