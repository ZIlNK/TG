import { planVariables, type ActionContext } from "./plan";
import { replyVariables, type NpcContext } from "./reply";
import { sceneVariables, type SceneContext } from "./scene";
import type { StageMessages } from "./format";
import { defaultMessages, type PromptStore } from "./loader";

export type StagePromptInput =
  | { stage: "plan"; context: ActionContext & { ambientOpportunity: boolean } }
  | { stage: "reply"; context: NpcContext }
  | { stage: "scene"; context: SceneContext };

export function buildStageMessages(
  request: StagePromptInput,
  store?: PromptStore,
): StageMessages {
  const values =
    request.stage === "plan"
      ? planVariables(request.context)
      : request.stage === "reply"
        ? replyVariables(request.context)
        : sceneVariables(request.context);
  return store
    ? store.load(request.stage, values)
    : defaultMessages(request.stage, values);
}
