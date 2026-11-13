import React, { useMemo, useState } from "react";
import { contentText, object, trajectoryRows } from "./trajectory";

function Payload({ value }: { value: unknown }): React.ReactElement {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      /* Preserve ordinary text. */
    }
  }
  const text = contentText(parsed);
  return (
    <pre className="tg-trajectory-payload">
      {text || JSON.stringify(parsed, null, 2) || "无内容"}
    </pre>
  );
}
export function TrajectoryView({
  events,
  stageLabel,
}: {
  events: unknown[];
  stageLabel: string;
}): React.ReactElement {
  const rows = useMemo(() => trajectoryRows(events), [events]);
  const [selected, setSelected] = useState(""),
    [query, setQuery] = useState("");
  const [tab, setTab] = useState("内容"),
    [all, setAll] = useState(false);
  const filtered = rows.filter(
    (row) =>
      (all ||
        row.type === "request/header" ||
        /^(system|developer|user|assistant|tool)\//.test(row.type)) &&
      `${row.label} ${row.summary} ${JSON.stringify(row.raw)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const chosen = filtered.find((row) => row.id === selected) ?? filtered[0];
  const firstTime = rows.find((row) => row.time !== null)?.time ?? null;
  const lastTime = rows.findLast((row) => row.time !== null)?.time ?? firstTime;
  const duration =
    firstTime !== null && lastTime !== null
      ? Math.max(1, lastTime - firstTime)
      : null;
  const select = (id: string): void => {
    setSelected(id);
    setTab("内容");
  };
  return (
    <div className="tg-trajectory">
      <div className="tg-trajectory-stage">{stageLabel}</div>
      <div className="tg-trajectory-toolbar">
        <input
          aria-label="搜索轨迹"
          placeholder="搜索消息、工具或参数"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          全部事件
        </label>
        <span>
          {filtered.length} 条 / {rows.length} 条
          {duration !== null &&
            ` · ${((lastTime! - firstTime!) / 1000).toFixed(1)} 秒`}
        </span>
      </div>
      <div className="tg-trajectory-timeline" aria-label="事件时间轴">
        {filtered.map((row, index) => (
          <button
            key={row.id}
            title={`${row.label} · ${row.summary.slice(0, 100)}`}
            aria-label={`定位事件 ${row.id} ${row.label}`}
            aria-pressed={chosen?.id === row.id}
            data-kind={row.type.split("/")[0]}
            onClick={() => select(row.id)}
            style={{
              left: `${duration !== null && row.time !== null ? ((row.time - firstTime!) / duration) * 98 : (index / Math.max(filtered.length, 1)) * 98}%`,
            }}
          />
        ))}
      </div>
      <div className="tg-trajectory-split">
        <div className="tg-trajectory-table-wrap">
          <table className="tg-trajectory-table">
            <thead>
              <tr>
                <th>轮次</th>
                <th>事件</th>
                <th>内容</th>
                <th>耗时</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr
                  key={row.id}
                  data-selected={chosen?.id === row.id}
                  data-error={row.error}
                >
                  <td>{row.step}</td>
                  <td>{row.label}</td>
                  <td>
                    <button onClick={() => select(row.id)} title={row.summary}>
                      {row.summary || "查看详情"}
                    </button>
                  </td>
                  <td>
                    {row.duration === null
                      ? "—"
                      : `${(row.duration / 1000).toFixed(2)}s`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <p className="tg-muted">没有匹配的事件。</p>}
        </div>
        {chosen && (
          <aside className="tg-trajectory-detail" aria-label="事件详情">
            <p className="tg-trajectory-stage">{stageLabel}</p>
            <header>
              <strong>{chosen.label}</strong>
              <span>
                #{chosen.id}
                {chosen.time !== null &&
                  ` · ${new Date(chosen.time).toLocaleTimeString()}`}
              </span>
            </header>
            <div
              className="tg-trajectory-tabs"
              role="tablist"
              aria-label="详情显示方式"
            >
              {["内容", "原始 JSON"].map((name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ))}
            </div>
            {tab === "原始 JSON" ? (
              <Payload
                value={{
                  stageLabel,
                  event: chosen.raw,
                  ...(chosen.pairedRaw ? { result: chosen.pairedRaw } : {}),
                }}
              />
            ) : (
              <>
                {chosen.type === "tool/call" && (
                  <>
                    <h4>{chosen.summary}</h4>
                    <h5>调用参数</h5>
                  </>
                )}
                {chosen.type === "request/header" ? (
                  <>
                    <h5>本次请求实际发送的工具</h5>
                    {chosen.tools === undefined ? (
                      <p className="tg-muted">原始记录未提供工具列表。</p>
                    ) : chosen.tools.length === 0 ? (
                      <p className="tg-muted">本次请求未提供工具。</p>
                    ) : (
                      chosen.tools.map((tool, index) => (
                        <section key={index}>
                          <h4>{String(object(tool).name ?? "未命名工具")}</h4>
                          <pre className="tg-trajectory-payload">
                            {JSON.stringify(tool, null, 2)}
                          </pre>
                        </section>
                      ))
                    )}
                    <details>
                      <summary>完整请求配置</summary>
                      <Payload value={chosen.body} />
                    </details>
                  </>
                ) : (
                  <Payload value={chosen.body} />
                )}
                {chosen.type === "tool/call" && (
                  <>
                    <h5>
                      工具返回 ·{" "}
                      {chosen.error
                        ? "失败"
                        : chosen.result
                          ? "已返回"
                          : "尚无返回记录"}
                    </h5>
                    {chosen.result !== undefined && (
                      <Payload value={chosen.result} />
                    )}
                    <p className="tg-muted">工具提议通过校验不代表已结算。</p>
                  </>
                )}
                {chosen.usage !== undefined && (
                  <>
                    <h5>Token 用量（提供方返回）</h5>
                    <Payload value={chosen.usage} />
                  </>
                )}
                {object(object(chosen.raw).data).error !== undefined && (
                  <Payload value={object(object(chosen.raw).data).error} />
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
