// Temporary Harness diagnostic plugin. Keep outside packages/dsh-tg: the Host
// identifies client packages from an entry's nearest package.json.
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

export const inject = ['clientModules', 'typert', 'typertGateway', 'tools'];
/** @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{output:string, gameIds?:string[]}} config */
export function apply(ctx, config) {
  let active = true;
  ctx.effect(() => () => { active = false; });
  const record = (event, data = {}) => appendFile(config.output, JSON.stringify({at:new Date().toISOString(),event,pid:process.pid,...data})+'\n');
  const rpc = (method, request={}) => ctx.typertGateway.invoke({namespace:'tg',method,args:{request}});
  const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  void (async () => {
    await mkdir(dirname(config.output), {recursive:true});
    let previous;
    while(active) {
      const present = ctx.typert.listPackages().some(p=>p.package==='dsh-tg');
      const modules = ctx.clientModules.graph().entries.map(e=>e.id);
      const key = JSON.stringify([present,modules.includes('dsh-tg'),ctx.clientModules.artifactBaseline('dsh-tg')?.path]);
      if(key !== previous) {
        previous = key;
        const globalGameTools = ctx.tools.schemas().filter(t=>t.name.startsWith('tg_')).map(t=>t.name);
        const snapshot={modules,globalGameTools,baseline:ctx.clientModules.artifactBaseline('dsh-tg'),loaderEntries:[...ctx.loader.entries()].filter(e=>/dsh-tg|tg-/.test(e.options.name)).map(e=>({name:e.options.name,disabled:e.disabled,fiber:!!e.fiber}))};
        if(present) {
          const games=await rpc('listGames');
          const all=await Promise.all(games.map(g=>rpc('getGame',{gameId:g.id})));
          snapshot.running=all.filter(g=>g.run?.status==='running').map(g=>g.id);
          snapshot.games=all.filter(g=>config.gameIds?.includes(g.id)).map(g=>({id:g.id,minute:g.world.minute,worldHash:hash(g.world),quest:g.world.quests['linwanqing-photo']?.status,playerPhoto:g.world.inventory.photo||0,npcPhoto:g.world.npcs.linwanqing.items.photo||0,receipts:g.receipts}));
          snapshot.saves=(await rpc('listSaves')).map(s=>({slot:s.slot,title:s.title}));
        }
        await record(present?'loaded':'unloaded',snapshot);
      }
      await wait(1000);
    }
  })().catch(error=>void record('error',{error:String(error),stack:error.stack}));
}
