import React, { useEffect, useState } from "react";
import type { GameRemote, RpcOutput } from "../rpc";
import type { Attempt } from "../core/trace";
import { TrajectoryView } from "./trajectory-view";

const phases: Record<string, string> = {
  plan: "阶段 1 · 理解行动",
  reply: "阶段 2 · NPC 回应",
  scene: "阶段 3 · 现场与选项生成",
  restore: "读取存档",
};
const phaseDescriptions: Record<Attempt["stage"], string> = {
  plan: "理解玩家意图，提出行动计划；实际效果由程序结算。",
  reply: "根据该人物已知的信息生成回应，以及待玩家接受的提议。",
  scene: "根据已结算结果生成现场描述与下一轮选项，不产生游戏效果。",
};
const statuses: Record<string, string> = {
  running: "处理中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
function Json({ value }: { value: unknown }): React.ReactElement {
  return <pre className="tg-trace-json">{JSON.stringify(value, null, 2)}</pre>;
}
function Events({
  api,
  attempt,
}: {
  api: GameRemote;
  attempt: Attempt;
}): React.ReactElement {
  const [data, setData] = useState<RpcOutput<"traceEvents">>({
    events: [],
    next: 0,
    more: false,
    error: "",
  });
  useEffect(() => {
    let stopped = false,
      busy = false;
    const refresh = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const events: unknown[] = [];
        let offset = 0;
        let next: RpcOutput<"traceEvents">;
        do {
          next = await api.traceEvents({
            gameId: attempt.gameId,
            sessionId: attempt.sessionId,
            offset,
            limit: 100,
          });
          events.push(...next.events);
          if (stopped) return;
          if (!next.more || next.error || next.next <= offset) break;
          offset = next.next;
        } while (true);
        next = { ...next, events };
        if (!stopped) setData(next);
      } catch (e) {
        if (!stopped)
          setData({ events: [], next: 0, more: false, error: String(e) });
      } finally {
        busy = false;
      }
    };
    setData({ events: [], next: 0, more: false, error: "" });
    void refresh();
    const timer =
      attempt.status === "running"
        ? window.setInterval(() => void refresh(), 1000)
        : undefined;
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, attempt.sessionId, attempt.status]);
  return (
    <div>
      {data.error && <p role="alert">{data.error}</p>}
      {!data.events.length && !data.error && <p>暂无已写入的事件。</p>}
      <TrajectoryView
        events={data.events}
        stageLabel={`${phases[attempt.stage]}${attempt.npcId ? ` · NPC：${attempt.npcId}` : ""}`}
      />
    </div>
  );
}
function AttemptView({
  api,
  attempt,
}: {
  api: GameRemote;
  attempt: Attempt;
}): React.ReactElement {
  const [open, setOpen] = useState(true);
  const elapsed = attempt.ended
    ? Math.max(0, Date.parse(attempt.ended) - Date.parse(attempt.started))
    : null;
  return (
    <details
      className="tg-trace-attempt"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span className="tg-stage-badge" data-stage={attempt.stage}>
          {phases[attempt.stage]}
        </span>
        {attempt.npcId && ` · NPC：${attempt.npcId}`} ·{" "}
        {statuses[attempt.status]}
        {elapsed !== null && ` · ${(elapsed / 1000).toFixed(1)} 秒`}
      </summary>
      <p className="tg-muted">{phaseDescriptions[attempt.stage]}</p>
      <p>
        {attempt.provider} / {attempt.model} · 运行代次 {attempt.generation}
      </p>
      <small>{new Date(attempt.started).toLocaleString()}</small>
      {attempt.error && <p role="alert">{attempt.error}</p>}
      {attempt.promptWarning && <p role="alert">{attempt.promptWarning}</p>}
      {open && <Events api={api} attempt={attempt} />}
    </details>
  );
}
export function Traces({
  api,
  gameId,
}: {
  api: GameRemote;
  gameId: string;
}): React.ReactElement {
  const [data, setData] = useState<RpcOutput<"listTraces">>({
    attempts: [],
    settlements: [],
  });
  const [selected, setSelected] = useState("");
  const [error, setError] = useState(""),
    [exporting, setExporting] = useState(false);
  useEffect(() => {
    let stopped = false,
      busy = false;
    const refresh = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const next = await api.listTraces({ gameId });
        if (!stopped) {
          setData(next);
          setError("");
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [api, gameId]);
  const actions = [
    ...new Map([
      ...data.attempts.map(
        (a) =>
          [
            a.actionId,
            { input: a.input || "刷新现场", time: a.started },
          ] as const,
      ),
      ...data.settlements.map(
        (a) =>
          [a.actionId, { input: a.input || "刷新现场", time: a.time }] as const,
      ),
    ]).entries(),
  ].sort((a, b) => b[1].time.localeCompare(a[1].time));
  const actionId = actions.some(([id]) => id === selected)
    ? selected
    : actions[0]?.[0];
  const attempts = data.attempts
    .filter((a) => a.actionId === actionId)
    .sort((a, b) => a.started.localeCompare(b.started));
  const settlements = data.settlements.filter((a) => a.actionId === actionId);
  const download = async (): Promise<void> => {
    setExporting(true);
    try {
      const sessions = [];
      for (const attempt of attempts) {
        const events: unknown[] = [];
        let offset = 0,
          issue = "";
        do {
          const page = await api.traceEvents({
            gameId,
            sessionId: attempt.sessionId,
            offset,
            limit: 100,
          });
          events.push(...page.events);
          issue = page.error;
          if (!page.more || issue) break;
          offset = page.next;
        } while (true);
        sessions.push({
          attempt,
          stageLabel: phases[attempt.stage],
          events,
          error: issue,
        });
      }
      const blob = new Blob(
        [
          JSON.stringify(
            {
              format: "tg-trace-v1",
              gameId,
              actionId,
              exportedAt: new Date().toISOString(),
              sessions,
              settlements,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `tg-trace-${actionId}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="tg-traces">
      <p className="tg-muted">
        按行动查看模型输入、回复和工具结果。实际结算单独列出；工具返回 STAGED
        只表示提议通过校验。记录从安装此版本后开始关联。
      </p>
      {error && <p role="alert">{error}</p>}
      {!actions.length ? (
        <p>尚无调用记录，执行一次行动后会出现在这里。</p>
      ) : (
        <>
          <label>
            选择行动
            <select
              value={actionId}
              onChange={(e) => setSelected(e.target.value)}
            >
              {actions.map(([id, a]) => (
                <option key={id} value={id}>
                  {new Date(a.time).toLocaleString()} · {a.input.slice(0, 70)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={exporting} onClick={() => void download()}>
            {exporting ? "正在导出…" : "导出本次行动 JSON"}
          </button>
          <p className="tg-muted">
            导出当前可读的轨迹快照；进行中的调用可能尚未完整。原始输入可能包含剧情和角色信息。
          </p>
          <p className="tg-muted">
            阶段 1 理解行动 → 阶段 2 NPC 回应（需要时）→ 阶段 3 现场与选项生成。
            阶段编号表示处理职责，不是模型请求次数；重试会保留为独立记录。
          </p>
          {attempts.map((a) => (
            <AttemptView key={a.sessionId} api={api} attempt={a} />
          ))}
          <h2>实际结算</h2>
          {!settlements.length && <p>尚无持久化的结算记录。</p>}
          {settlements.map((s) => (
            <details key={s.id} className="tg-trace-settlement">
              <summary>
                {phases[s.stage] ?? s.stage} · 状态版本 {s.revision} ·{" "}
                {s.changes.length
                  ? `${s.changes.length} 项世界变化`
                  : "世界状态未改变"}
              </summary>
              <p>{s.result}</p>
              <Json value={s} />
            </details>
          ))}
        </>
      )}
    </section>
  );
}
