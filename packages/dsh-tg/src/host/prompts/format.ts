export interface StageMessages {
  system: string;
  user: string;
  warning?: string;
}
export type PromptVariables = Record<string, string>;

export function safe(value: string): string {
  return literal(value).replace(
    /[<>&]/g,
    (c: string): string =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

export function environmentVariables(context: {
  minute: number;
  time: { label: string; period: string };
  weather: string;
  place: { id: string; name: string; region: string; description: string };
}): PromptVariables {
  return {
    day: `第 ${Math.floor(context.minute / 1440) + 1} 天`,
    time: context.time.label.split(" · ")[1],
    period: safe(context.time.period),
    minute: String(context.minute),
    weather: safe(context.weather),
    ...Object.fromEntries(
      Object.entries(context.place).map(([key, value]) => [
        `place.${key}`,
        safe(value),
      ]),
    ),
  };
}

// Values stay literal: line breaks/quotes cannot become template syntax.
export function literal(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

export function proseSection(title: string, text: string): string {
  const escaped = text.replace(
    /[<>&]/g,
    (character: string): string =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `【${title} · 游戏资料】\n<game-data>\n${escaped}\n</game-data>`;
}

// Format data only. Each stage maintains its own complete instruction text.
export function dataSection(title: string, value: unknown): string {
  const json = JSON.stringify(value, null, 2).replace(
    /[<>&]/g,
    (character: string): string =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `【${title} · 游戏资料】\n<game-data>\n${json}\n</game-data>`;
}
