import { z } from "zod";

export const SettlementSchema = z.object({
  id: z.string(),
  actionId: z.string(),
  generation: z.number(),
  revision: z.number(),
  time: z.string(),
  stage: z.string(),
  input: z.string(),
  result: z.string(),
  changes: z.array(
    z.object({ path: z.string(), before: z.unknown(), after: z.unknown() }),
  ),
});
export type Settlement = z.infer<typeof SettlementSchema>;
export const AttemptSchema = z.object({
  sessionId: z.string(),
  gameId: z.string(),
  actionId: z.string(),
  generation: z.number(),
  stage: z.enum(["plan", "reply", "scene"]),
  npcId: z.string(),
  input: z.string(),
  provider: z.string(),
  model: z.string(),
  started: z.string(),
  ended: z.string(),
  status: z.enum([
    "running",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  error: z.string(),
  promptWarning: z.string().optional(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

// World changes only: trace data never becomes part of NPC knowledge or prompts.
export function changes(
  before: unknown,
  after: unknown,
  path = "world",
): Settlement["changes"] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      changes(a[key], b[key], `${path}.${key}`),
    );
  }
  return [{ path, before: before ?? null, after: after ?? null }];
}
