// Loaded temporarily outside the package during an in-place update. Returning
// from apply immediately lets the live composer finish removing the old game.
import { writeFile, rename } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

export const inject = ["storageDomain"];
/** @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{entry:string, acknowledgement:string}} config */
export function apply(ctx, config) {
  let active = true;
  ctx.effect(() => () => {
    active = false;
  });
  const acknowledge = async (result) => {
    const temporary = config.acknowledgement + ".tmp";
    await writeFile(temporary, JSON.stringify(result));
    await rename(temporary, config.acknowledgement);
  };
  void (async () => {
    const { domainSpec } = await import(config.entry);
    const deadline = Date.now() + 30_000;
    let lastError = "游戏服务尚未卸载";
    while (active && Date.now() < deadline) {
      if (!ctx.get("tg")) {
        let domain;
        try {
          domain = await ctx.storageDomain.open(domainSpec);
        } catch (error) {
          lastError = String(error);
        }
        if (domain) {
          await domain.close();
          await acknowledge({ ok: true });
          return;
        }
      }
      await wait(100);
    }
    if (active) throw new Error(lastError);
  })().catch(async (error) => {
    if (active) await acknowledge({ ok: false, message: String(error) });
  });
}
