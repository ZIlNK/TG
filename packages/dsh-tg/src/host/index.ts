import { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import type {} from "@deepseek-ai/dsh-api-gateway";
import type {} from "@deepseek-ai/dsh-typert-registry";
import {
  GameSchema,
  SaveSchema,
  type Game,
  type ModelChoice,
  type Save,
} from "../core/schema";
import { GameService, type Store } from "../core/service";
import { remoteContribution, type RpcInput, type RpcOutput } from "../rpc";
import { HarnessRunner } from "./model";
import { currentDefaultModel } from "./model-choice";
import { TraceService } from "./trace";
import { AttemptSchema, type Attempt } from "../core/trace";

export const name = "tg-game";
export const inject = [
  "agents",
  "tools",
  "systemPrompt",
  "llm",
  "storageDomain",
  "typert",
  "typertGateway",
  "sessionPersistence",
];
export const domainSpec = defineDomain({
  name: "tg_game_v1",
  version: 1,
  tables: {
    games: domainTable<string, Game>(GameSchema),
    saves: domainTable<string, Save>(SaveSchema),
  },
});
export class TgRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly game: GameService,
    private readonly trace: TraceService,
  ) {
    super(ctx, "tg");
  }
  @Remote listTraces(r: RpcInput<"listTraces">): RpcOutput<"listTraces"> {
    const game = this.game.getGame(r.gameId);
    return {
      attempts: this.trace.list(game.id),
      settlements: game.settlements ?? [],
    };
  }
  @Remote traceEvents(
    r: RpcInput<"traceEvents">,
  ): Promise<RpcOutput<"traceEvents">> {
    this.game.getGame(r.gameId);
    return this.trace.events(r.gameId, r.sessionId, r.offset, r.limit);
  }
  // Persist a concrete snapshot while keeping the follow flag: the runner
  // re-reads the DSH default on every stage, the snapshot keeps old saves and
  // the settings page readable.
  private followRoute(model: ModelChoice): ModelChoice {
    if (!model.follow) return model;
    const current = currentDefaultModel(this.ctx);
    if (!current)
      throw new Error("当前 DSH 没有可用的默认模型配置，请改选具体模型。");
    return {
      provider: current.provider,
      model: current.model,
      follow: true,
    };
  }
  @Remote async models(
    _request: RpcInput<"models">,
  ): Promise<RpcOutput<"models">> {
    const result: RpcOutput<"models"> = [];
    const current = currentDefaultModel(this.ctx);
    if (current)
      result.push({
        provider: current.provider,
        model: current.model,
        label: `跟随 DSH 当前模型（${current.provider} / ${current.model}）`,
        follow: true,
      });
    for (const provider of this.ctx.llm.listProviders()) {
      for (const model of await this.ctx.llm.listModels(provider.id))
        result.push({
          provider: provider.id,
          model: model.id,
          label: `${provider.id} / ${model.name || model.id}`,
        });
    }
    return result;
  }
  @Remote listGames(_request: RpcInput<"listGames">): RpcOutput<"listGames"> {
    return this.game.listGames();
  }
  @Remote createGame(r: RpcInput<"createGame">): Promise<Game> {
    return this.game.createGame(
      r.name,
      this.followRoute(r.model),
      r.replaceGameId,
    );
  }
  @Remote getGame(r: RpcInput<"getGame">): Game {
    return this.game.getGame(r.gameId);
  }
  @Remote submitAction(r: RpcInput<"submitAction">): Promise<Game> {
    return this.game.submitAction(r);
  }
  @Remote cancelAction(r: RpcInput<"cancelAction">): Promise<Game> {
    return this.game.cancelAction(r.gameId);
  }
  @Remote sendDialogue(r: RpcInput<"sendDialogue">): Promise<Game> {
    return this.game.submitAction(r, "dialogue");
  }
  @Remote exitDialogue(r: RpcInput<"exitDialogue">): Promise<Game> {
    return this.game.submitAction(r, "exitDialogue");
  }
  @Remote retryOutput(r: RpcInput<"retryOutput">): Promise<Game> {
    return this.game.retryOutput(r.gameId, r.expectedRevision);
  }
  @Remote listSaves(_r: RpcInput<"listSaves">): RpcOutput<"listSaves"> {
    return this.game.listSaves();
  }
  @Remote async saveGame(r: RpcInput<"saveGame">): Promise<boolean> {
    await this.game.saveGame(r.gameId, r.slot, r.title);
    return true;
  }
  @Remote loadGame(r: RpcInput<"loadGame">): Promise<Game> {
    return this.game.loadGame(r.gameId, r.slot);
  }
  @Remote exportSave(r: RpcInput<"exportSave">): Save {
    return this.game.exportSave(r.slot);
  }
  @Remote async importSave(r: RpcInput<"importSave">): Promise<boolean> {
    await this.game.importSave(r.save, r.slot);
    return true;
  }
  @Remote configure(r: RpcInput<"configure">): Promise<Game> {
    return this.game.configure(r.gameId, this.followRoute(r.model), r.theme);
  }
}
export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open(domainSpec);
  const games = domain.table("games");
  const saves = domain.table("saves");
  const store: Store = {
    games: () => Array.from(games.entries(), ([, value]) => value),
    get: (id) => games.get(id),
    put: (g) => games.put(g.id, g),
    saves: () => Array.from(saves.entries(), ([, value]) => value),
    save: (s) => saves.put(String(s.slot), s),
  };
  const traceDomain = await ctx.storageDomain.open(
    defineDomain({
      name: "tg_traces_v1",
      version: 1,
      tables: { attempts: domainTable<string, Attempt>(AttemptSchema) },
    }),
  );
  const attempts = traceDomain.table("attempts");
  const trace = new TraceService(ctx, {
    all: () => Array.from(attempts.entries(), ([, a]) => a),
    get: (id) => attempts.get(id),
    put: (a) => attempts.put(a.sessionId, a),
  });
  const game = new GameService(store, new HarnessRunner(ctx, trace));
  ctx.effect(() => async () => {
    await game.close();
    await traceDomain.close();
    await domain.close();
  });
  await game.recover();
  await trace.recover();
  ctx.effect(() =>
    ctx.typert.register({
      package: "dsh-tg",
      face: "host",
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: remoteContribution.descriptors,
    }),
  );
  new TgRemote(ctx, game, trace);
}
