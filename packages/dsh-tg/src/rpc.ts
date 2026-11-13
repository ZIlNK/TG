import { z } from "zod";
import type {
  TypertRemoteContribution,
  RemoteResult,
} from "@deepseek-ai/dsh-typert-protocol";
import { GameSchema, ModelSchema, SaveSchema } from "./core/schema";
import { AttemptSchema, SettlementSchema } from "./core/trace";

const game = z.object({ gameId: z.string().min(1) });
const slot = z.number().int().min(0).max(7);
export const rpcSchemas = {
  listTraces: {
    input: game,
    output: z.object({
      attempts: z.array(AttemptSchema),
      settlements: z.array(SettlementSchema),
    }),
  },
  traceEvents: {
    input: game.extend({
      sessionId: z.string().min(1).max(240),
      offset: z.number().int().nonnegative(),
      limit: z.number().int().min(1).max(100),
    }),
    output: z.object({
      events: z.array(z.unknown()),
      next: z.number(),
      more: z.boolean(),
      error: z.string(),
    }),
  },
  models: {
    input: z.object({}),
    output: z.array(ModelSchema.extend({ label: z.string() })),
  },
  listGames: {
    input: z.object({}),
    output: z.array(
      z.object({ id: z.string(), name: z.string(), minute: z.number() }),
    ),
  },
  createGame: {
    input: z.object({
      name: z.string().min(1).max(160),
      model: ModelSchema,
      replaceGameId: z.string().optional(),
    }),
    output: GameSchema,
  },
  getGame: { input: game, output: GameSchema },
  submitAction: {
    input: game.extend({
      requestId: z.string().min(1).max(160),
      expectedRevision: z.number().int().nonnegative(),
      input: z.string().max(6000).optional(),
      optionId: z.string().optional(),
    }),
    output: GameSchema,
  },
  cancelAction: { input: game, output: GameSchema },
  sendDialogue: {
    input: game.extend({
      requestId: z.string().min(1).max(120),
      expectedRevision: z.number().int().nonnegative(),
      input: z.string().min(1).max(6000),
    }),
    output: GameSchema,
  },
  exitDialogue: {
    input: game.extend({
      requestId: z.string().min(1).max(120),
      expectedRevision: z.number().int().nonnegative(),
    }),
    output: GameSchema,
  },
  retryOutput: {
    input: game.extend({ expectedRevision: z.number().int().nonnegative() }),
    output: GameSchema,
  },
  listSaves: {
    input: z.object({}),
    output: z.array(SaveSchema.omit({ game: true })),
  },
  saveGame: {
    input: game.extend({ slot, title: z.string().min(1).max(160) }),
    output: z.boolean(),
  },
  loadGame: { input: game.extend({ slot }), output: GameSchema },
  exportSave: { input: z.object({ slot }), output: SaveSchema },
  importSave: {
    input: z.object({ slot, save: SaveSchema }),
    output: z.boolean(),
  },
  configure: {
    input: game.extend({
      model: ModelSchema,
      theme: z.enum(["dark", "light"]),
    }),
    output: GameSchema,
  },
} as const;
export type RpcName = keyof typeof rpcSchemas;
export type RpcInput<K extends RpcName> = z.infer<
  (typeof rpcSchemas)[K]["input"]
>;
export type RpcOutput<K extends RpcName> = z.infer<
  (typeof rpcSchemas)[K]["output"]
>;
export type GameRemote = {
  [K in RpcName]: (request: RpcInput<K>) => Promise<RpcOutput<K>>;
};
export type GameWireRemote = {
  [K in RpcName]: (request: RpcInput<K>) => Promise<RemoteResult<RpcOutput<K>>>;
};
export function gameApi(remote: GameWireRemote): GameRemote {
  return Object.fromEntries(
    Object.keys(rpcSchemas).map((method) => [
      method,
      async (request: unknown) => {
        const invoke = remote[method as RpcName] as (
          request: unknown,
        ) => Promise<RemoteResult<unknown>>;
        const result = await invoke(request);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      },
    ]),
  ) as GameRemote;
}
// rc.2 (0.1.5) reads schema; 0.2.0 materializes it through create(). Both
// boundaries use the very same validator, including malformed save rejection.
function strictCodec(
  typeSymbol: string,
  schema: z.ZodType,
): {
  mode: "strict";
  typeSymbol: string;
  schema: z.ZodType;
  create: () => z.ZodType;
} {
  return { mode: "strict" as const, typeSymbol, schema, create: () => schema };
}
// One schema table describes both Host and Client Remote contracts; no untyped HTTP bypass.
export const remoteContribution: TypertRemoteContribution = {
  package: "dsh-tg",
  descriptors: Object.entries(rpcSchemas).map(([method, schemas]) => ({
    id: `dsh-tg#tg/${method}`,
    service: "tg",
    namespace: "tg",
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: "request",
        wire: "request",
        source: "json",
        codec: strictCodec(`dsh-tg#${method}Input`, schemas.input),
      },
    ],
    result: strictCodec(`dsh-tg#${method}Output`, schemas.output),
  })),
};
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    tg: GameWireRemote;
  }
}
