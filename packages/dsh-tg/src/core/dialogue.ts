import { z } from "zod";
import type { Game, MemoryRecord } from "./schema";
import { npcPresent } from "./world";

export const EnterDialogueSchema = z
  .object({
    decision: z.literal("enter_dialogue"),
    npcId: z.string().min(1).max(160),
  })
  .strict();

export function validateDialogueEntry(game: Game, npcId: string): void {
  if (game.dialogue) throw new Error("已经在对话中");
  if (
    !game.run?.optionId ||
    !game.scene.options.some((o) => o.id === game.run!.optionId)
  )
    throw new Error("只能从当前现场的有效交谈选项进入对话");
  if (!npcPresent(game.world, npcId)) throw new Error("对方不在当前现场");
}

export function dialogueMessages(game: Game): MemoryRecord[] {
  const npcId = game.dialogue?.npcId;
  return (game.world.memories ?? []).filter(
    (m) =>
      m.kind === "dialogue" &&
      m.knownBy.includes("player") &&
      m.relatedNpcIds.includes(npcId ?? "") &&
      (m.speakerId === "player" || m.speakerId === npcId),
  );
}
