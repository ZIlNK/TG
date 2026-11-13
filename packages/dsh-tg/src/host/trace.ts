import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type { Attempt } from "../core/trace";
import { errorText } from "../core/service";

export interface TraceStore {
  all(): Attempt[];
  get(id: string): Attempt | undefined;
  put(attempt: Attempt): Promise<void>;
}
export class TraceService {
  private live = new Map<string, () => readonly unknown[]>();
  constructor(
    private readonly ctx: Context,
    private readonly store: TraceStore,
  ) {}
  list(gameId: string): Attempt[] {
    return this.store
      .all()
      .filter((a) => a.gameId === gameId)
      .sort((a, b) => b.started.localeCompare(a.started));
  }
  async recover(): Promise<void> {
    for (const a of this.store.all())
      if (a.status === "running")
        await this.store.put({
          ...a,
          status: "interrupted",
          ended: new Date().toISOString(),
          error: "宿主中断；原记录保留，重试会创建新记录。",
        });
  }
  async start(attempt: Attempt): Promise<void> {
    await this.store.put(attempt);
  }
  attach(id: string, snapshot: () => readonly unknown[]): void {
    this.live.set(id, snapshot);
  }
  async finish(attempt: Attempt): Promise<void> {
    try {
      await this.store.put(attempt);
    } finally {
      this.live.delete(attempt.sessionId);
    }
  }
  async events(
    gameId: string,
    sessionId: string,
    offset: number,
    limit: number,
  ): Promise<{
    events: unknown[];
    next: number;
    more: boolean;
    error: string;
  }> {
    const attempt = this.store.get(sessionId);
    if (!attempt || attempt.gameId !== gameId)
      throw new Error("该记录不属于当前游戏");
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("无效的记录分页参数");
    try {
      let events: readonly unknown[];
      const snapshot = this.live.get(sessionId);
      if (snapshot) events = snapshot().slice(offset, offset + limit + 1);
      else {
        const handle = await this.ctx.sessionPersistence.open(
          sessionId as never,
          "read",
        );
        try {
          events = (await handle.read(offset, limit + 1)).events;
        } finally {
          await handle.close();
        }
      }
      return {
        events: events.slice(0, limit),
        next: offset + Math.min(events.length, limit),
        more: events.length > limit,
        error: "",
      };
    } catch (error) {
      return {
        events: [],
        next: offset,
        more: false,
        error: "原始轨迹暂不可读：" + errorText(error),
      };
    }
  }
}
