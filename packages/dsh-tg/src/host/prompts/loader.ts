import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import defaults from "./defaults.json";
import type { PromptVariables, StageMessages } from "./format";

export type PromptStage = keyof typeof defaults;
type TemplatePair = { system: string; user: string };

export function renderTemplates(
  pair: TemplatePair,
  values: PromptVariables,
): StageMessages {
  const render = (text: string): string => {
    if (!text.trim()) throw new Error("模板不能为空");
    if (text.length > 200_000) throw new Error("模板超过 200000 字符");
    // Single-pass replacement: data containing placeholders is never evaluated.
    return text.replace(
      /\{([a-zA-Z_][\w.]*)\}/g,
      (_match: string, key: string): string => {
        if (!Object.hasOwn(values, key))
          throw new Error(`未知或当前阶段不可用的变量：{${key}}`);
        return values[key];
      },
    );
  };
  const system = render(pair.system);
  const user = render(pair.user);
  if (!system.trim() || !user.trim()) throw new Error("替换后的提示词不能为空");
  return { system, user };
}

export function defaultMessages(
  stage: PromptStage,
  values: PromptVariables,
): StageMessages {
  return renderTemplates(defaults[stage], values);
}

export class PromptStore {
  private readonly valid = new Map<PromptStage, TemplatePair>();
  private initialized = false;
  constructor(
    readonly directory = join(
      process.env.DSH_HOME || join(homedir(), ".dsh"),
      "tg",
      "prompts",
    ),
  ) {}

  initialize(): void {
    if (this.initialized) return;
    mkdirSync(this.directory, { recursive: true });
    for (const stage of Object.keys(defaults) as PromptStage[]) {
      for (const role of ["system", "user"] as const) {
        try {
          writeFileSync(
            join(this.directory, `${stage}.${role}.md`),
            defaults[stage][role],
            { encoding: "utf8", flag: "wx" },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
    }
    this.initialized = true;
  }

  load(stage: PromptStage, values: PromptVariables): StageMessages {
    try {
      this.initialize();
      const pair = {
        system: readFileSync(
          join(this.directory, `${stage}.system.md`),
          "utf8",
        ),
        user: readFileSync(join(this.directory, `${stage}.user.md`), "utf8"),
      };
      const messages = renderTemplates(pair, values);
      this.valid.set(stage, pair);
      return messages;
    } catch (error) {
      const warning = `提示词热更新失败（${stage}，${this.directory}）：${error instanceof Error ? error.message : String(error)}。本次使用${this.valid.has(stage) ? "最近有效模板" : "内置默认模板"}。`;
      return {
        ...renderTemplates(this.valid.get(stage) ?? defaults[stage], values),
        warning,
      };
    }
  }
}
