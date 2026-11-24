import React from "react";
import type { Expression } from "../../core/schema";
import { PortraitSources } from "./sources";

export const expressionLabels: Record<Expression, string> = {
  neutral: "平静",
  smile: "微笑",
  shy: "害羞",
  worried: "担心",
  sad: "难过",
  surprised: "惊讶",
  thinking: "思索",
  look_away: "移开视线",
};

export function hasPortrait(npcId: string): boolean {
  return Boolean(PortraitSources[npcId]?.neutral);
}

export function NpcPortrait({
  npcId,
  name,
  expression,
}: {
  npcId: string;
  name: string;
  expression: Expression;
}): React.ReactElement | null {
  const set = PortraitSources[npcId];
  const src = set?.[expression] ?? set?.neutral;
  if (!src) return null;
  return (
    <figure className="tg-portrait" data-expression={expression}>
      <div className="tg-portrait-art">
        <img
          key={expression}
          src={src}
          alt={`${name}的立绘，神情${expressionLabels[expression]}`}
        />
      </div>
      <figcaption>神情 · {expressionLabels[expression]}</figcaption>
    </figure>
  );
}