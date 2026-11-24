import type { Context } from "@deepseek-ai/cordis";
import type { ModelChoice } from "../core/schema";

/** The Host service installed by `@deepseek-ai/dsh-agent-default-model`. */
export interface AgentDefaultModel {
  currentSelection(): {
    provider: string;
    model: string;
    reasoningEffort?: string;
  };
}
export interface ResolvedModel {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/**
 * Read the current DSH default model. The service is optional: a Host built
 * without the default-model bundle has none, and the plugin then keeps using
 * the concrete route stored on the game.
 */
export function currentDefaultModel(
  ctx: Context,
): ResolvedModel | undefined {
  let service: AgentDefaultModel | undefined;
  try {
    service = (ctx as { get?: (name: string) => unknown }).get?.(
      "agentDefaultModel",
    ) as AgentDefaultModel | undefined;
  } catch {
    return undefined;
  }
  if (!service || typeof service.currentSelection !== "function")
    return undefined;
  try {
    const selection = service.currentSelection();
    if (!selection?.provider || !selection?.model) return undefined;
    return {
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Resolve the route one stage should call. Following is read-only: it never
 * rewrites the saved game, so a DSH model switch applies from the next stage
 * and old saves keep their recorded snapshot.
 */
export function resolveModel(ctx: Context, model: ModelChoice): ResolvedModel {
  if (!model.follow) return { provider: model.provider, model: model.model };
  const current = currentDefaultModel(ctx);
  if (!current)
    throw new Error("当前 DSH 没有可用的默认模型配置，请改选具体模型后重试。");
  return current;
}