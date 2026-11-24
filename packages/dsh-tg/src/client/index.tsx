import React, { useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-api-gateway/client";
import type {} from "@deepseek-ai/dsh-client-connection/client";
import { type Game, type ModelChoice } from "../core/schema";
import { clockLabel } from "../core/world";
import {
  gameApi,
  remoteContribution,
  type GameRemote,
  type RpcOutput,
} from "../rpc";
import css from "./style.css?raw";
import themes from "../content/themes.json";
import { SceneCanvas } from "./SceneCanvas";
import { sceneFor } from "./scene/locations";
import { Traces } from "./traces";
import { DialogueView } from "./dialogue";

const menu = [
  "现场",
  "背包",
  "角色",
  "地图",
  "任务日志",
  "调用记录",
  "存档",
  "设置",
] as const;
type Page = (typeof menu)[number];
// A dedicated key keeps "follow the DSH default" selectable even though its
// displayed provider/model changes between sessions.
const FOLLOW = "follow";
const stageNames = {
  plan: "理解行动",
  reply: "等待人物回应",
  scene: "整理当前现场",
  done: "行动完成",
};
const labels: Record<string, string> = {
  health: "健康",
  stamina: "体力",
  stress: "压力",
  hunger: "饥饿",
  trauma: "创伤",
  control: "自控",
  arousal: "欲望",
  allure: "魅力",
  reputation: "声望",
  money: "金钱",
};
function Icon(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15M7 8h2m-2 4h2m6-4h2m-2 4h2" />
    </svg>
  );
}
function App({
  api,
  onReconnect,
}: {
  api: GameRemote;
  onReconnect: (refresh: () => void) => () => void;
}): React.ReactElement {
  const [game, setGame] = useState<Game | null>(null),
    [page, setPage] = useState<Page>("现场");
  const [models, setModels] = useState<RpcOutput<"models">>([]),
    [modelKey, setModelKey] = useState(""),
    [name, setName] = useState("旅人");
  const [saved, setSaved] = useState<RpcOutput<"listSaves">>([]),
    [games, setGames] = useState<RpcOutput<"listGames">>([]);
  const [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [input, setInput] = useState("");
  const activeId = useRef<string | null>(null),
    mounted = useRef(true),
    inFlight = useRef(false);
  const chooseModel = (): ModelChoice | undefined => {
    if (modelKey === FOLLOW) {
      const follow = models.find((m) => m.follow);
      return (
        follow && {
          provider: follow.provider,
          model: follow.model,
          follow: true,
        }
      );
    }
    const choice = models.find((m) => `${m.provider}/${m.model}` === modelKey);
    return choice && { provider: choice.provider, model: choice.model };
  };
  const adopt = (next: Game): void => {
    if (!mounted.current) return;
    activeId.current = next.id;
    setGame(next);
    setModelKey(
      next.model.follow
        ? FOLLOW
        : `${next.model.provider}/${next.model.model}`,
    );
    try {
      localStorage.setItem("tg-current-game", next.id);
    } catch {
      /* Storage is optional; Host keeps game data. */
    }
  };
  const refresh = async (): Promise<void> => {
    const id = activeId.current;
    if (!id) return;
    try {
      const next = await api.getGame({ gameId: id });
      if (mounted.current && activeId.current === id)
        setGame((prev) =>
          !prev || next.revision >= prev.revision ? next : prev,
        );
    } catch (e) {
      if (mounted.current) setError(String(e));
    }
  };
  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : String(e));
        await refresh();
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setWorking(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void Promise.all([api.models({}), api.listGames({}), api.listSaves({})])
      .then(([ms, gs, ss]) => {
        if (!mounted.current) return;
        setModels(ms);
        setGames(gs);
        setSaved(ss);
        if (ms[0])
          setModelKey(
            ms[0].follow ? FOLLOW : `${ms[0].provider}/${ms[0].model}`,
          );
        let last: string | null = null;
        try {
          last = localStorage.getItem("tg-current-game");
        } catch {
          /* Optional UI preference. */
        }
        if (gs.some((g) => g.id === last))
          void api
            .getGame({ gameId: last! })
            .then(adopt)
            .catch((e) => setError(String(e)));
      })
      .catch((e) => {
        if (mounted.current) setError(String(e));
      });
    return () => {
      mounted.current = false;
    };
  }, [api]);
  useEffect(
    () =>
      onReconnect(() => {
        void refresh();
      }),
    [onReconnect],
  );
  useEffect(() => {
    // Re-read the catalog so the follow entry shows the DSH default as it is
    // now, not the snapshot taken when the journey began.
    if (page !== "设置") return;
    void api
      .models({})
      .then((list) => {
        if (mounted.current) setModels(list);
      })
      .catch(() => undefined);
  }, [api, page]);
  useEffect(() => {
    const tick = (): void => {
      void refresh();
    };
    window.addEventListener("focus", tick);
    window.addEventListener("online", tick);
    const timer =
      game?.run?.status === "running"
        ? window.setInterval(tick, 1000)
        : undefined;
    return () => {
      window.removeEventListener("focus", tick);
      window.removeEventListener("online", tick);
      window.clearInterval(timer);
    };
  }, [game?.id, game?.run?.status]);
  const busy = working || game?.run?.status === "running";
  const submit = (optionId?: string): void => {
    if (!game || busy || (!optionId && !input.trim())) return;
    void run(async () => {
      const next = await api.submitAction({
        gameId: game.id,
        requestId: crypto.randomUUID(),
        expectedRevision: game.revision,
        ...(optionId ? { optionId } : { input: input.trim() }),
      });
      adopt(next);
      setInput("");
    });
  };
  const newGame = (): void => {
    const model = chooseModel();
    if (!model) {
      setError("请先在 Harness 模型设置中配置模型，并在这里选择。");
      return;
    }
    void run(async () => {
      adopt(await api.createGame({ name, model, replaceGameId: game?.id }));
      setPage("现场");
      setGames(await api.listGames({}));
    });
  };
  const modelSelect = (
    <select
      aria-label="游戏模型"
      value={modelKey}
      disabled={busy}
      onChange={(e) => setModelKey(e.target.value)}
    >
      {!models.length && <option value="">没有可用模型</option>}
      {models.map((m) => {
        const key = m.follow ? FOLLOW : `${m.provider}/${m.model}`;
        return (
          <option key={key} value={key}>
            {m.label}
          </option>
        );
      })}
    </select>
  );
  const w = game?.world;
  const followEntry = models.find((m) => m.follow);
  return (
    <section
      className="tg-app"
      data-theme={game?.theme || "dark"}
      style={themes[game?.theme || "dark"] as React.CSSProperties}
    >
      <style>{css}</style>
      <header className="tg-top">
        <div className="tg-brand">
          <Icon />
          <strong>浮城纪事</strong>
          <span>文字游戏</span>
        </div>
        <div className="tg-time">
          {w ? clockLabel(w.minute) : "你的故事，由一次行动开始"}
        </div>
      </header>
      {error && (
        <div className="tg-error" role="alert">
          {error}
          <button
            onClick={() => {
              setError("");
              void refresh();
            }}
          >
            刷新
          </button>
        </div>
      )}
      {!game ? (
        <div className="tg-start">
          <p className="tg-eyebrow">TG · INTERACTIVE FICTION</p>
          <h1>
            街灯亮起之前，
            <br />
            故事还未发生。
          </h1>
          <p>
            走进城市，遇见各有心事的人。观察、交谈、寻找，
            <br />
            每一次选择都留下痕迹。
          </p>
          <label>
            你的名字
            <input
              value={name}
              maxLength={160}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>使用模型{modelSelect}</label>
          <button
            className="tg-primary"
            onClick={newGame}
            disabled={working || !models.length}
          >
            开始新的故事 →
          </button>
          {games.length > 0 && (
            <div className="tg-continue">
              <h3>继续旅程</h3>
              {games.map((g) => (
                <button
                  key={g.id}
                  disabled={working}
                  onClick={() =>
                    void run(async () =>
                      adopt(await api.getGame({ gameId: g.id })),
                    )
                  }
                >
                  {g.name}
                  <small>{clockLabel(g.minute)}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="tg-layout">
          <aside className="tg-side">
            <p className="tg-eyebrow">
              {w!.weather} / {w!.locations[w!.location].region}
            </p>
            <h2>{w!.name}</h2>
            <div className="tg-money">
              ¥ {w!.stats.money}
              <span>随身现金</span>
            </div>
            {(["health", "stamina", "stress", "hunger"] as const).map((key) => (
              <div className="tg-meter" key={key}>
                <label>
                  {labels[key]}
                  <span>{Math.round(w!.stats[key])}</span>
                </label>
                <meter
                  min="0"
                  max={key === "stamina" ? 80 : 100}
                  value={w!.stats[key]}
                />
              </div>
            ))}
            <nav aria-label="游戏管理">
              {menu.map((item) => (
                <button
                  aria-current={page === item ? "page" : undefined}
                  key={item}
                  onClick={() => {
                    setPage(item);
                    if (item === "存档") void api.listSaves({}).then(setSaved);
                  }}
                >
                  {item === "现场" && game.dialogue ? "对话" : item}
                  <span>↗</span>
                </button>
              ))}
            </nav>
            <p className="tg-caption">世界记得你做过的事。</p>
          </aside>
          <main className="tg-main">
            <div className="tg-section-title">
              <p className="tg-eyebrow">
                {page === "现场" ? "当下 / HERE & NOW" : "旅程 / JOURNAL"}
              </p>
              <h1>
                {page === "现场"
                  ? game.dialogue
                    ? "人物对话"
                    : w!.locations[w!.location].name
                  : page}
              </h1>
            </div>
            {page === "现场" && game.dialogue && (
              <DialogueView
                key={`${game.id}:${game.dialogue.npcId}`}
                game={game}
                busy={Boolean(busy)}
                working={working}
                send={async (text) => {
                  let sent = false;
                  await run(async () => {
                    adopt(
                      await api.sendDialogue({
                        gameId: game.id,
                        requestId: crypto.randomUUID(),
                        expectedRevision: game.revision,
                        input: text,
                      }),
                    );
                    sent = true;
                  });
                  return sent;
                }}
                exit={() =>
                  void run(async () => {
                    adopt(
                      await api.exitDialogue({
                        gameId: game.id,
                        requestId: crypto.randomUUID(),
                        expectedRevision: game.revision,
                      }),
                    );
                  })
                }
                retry={() =>
                  void run(async () => {
                    adopt(
                      await api.retryOutput({
                        gameId: game.id,
                        expectedRevision: game.revision,
                      }),
                    );
                  })
                }
                cancel={() =>
                  void run(async () => {
                    adopt(await api.cancelAction({ gameId: game.id }));
                  })
                }
              />
            )}
            {page === "现场" && !game.dialogue && (
              <>
                <div className="tg-landscape" aria-hidden="true">
                  <SceneCanvas
                    scene={sceneFor(w!.location)}
                    minute={w!.minute}
                  />
                  <span>{w!.locations[w!.location].name}</span>
                </div>
                <article className="tg-prose">
                  {game.scene.description
                    .split("\n")
                    .filter(Boolean)
                    .map((p, i) => (
                      <p key={i}>{p}</p>
                    ))}
                </article>
                {game.run && (
                  <div className="tg-status" role="status">
                    {game.run.status === "running"
                      ? stageNames[game.run.stage] + "…"
                      : game.run.error || game.run.result}
                    {game.run.status === "running" && (
                      <button
                        disabled={working}
                        onClick={() =>
                          void run(async () =>
                            adopt(await api.cancelAction({ gameId: game.id })),
                          )
                        }
                      >
                        取消处理
                      </button>
                    )}
                  </div>
                )}
                {w!.over ? (
                  <div className="tg-error">
                    本局结束：{w!.over}。可以在设置中重新开局。
                  </div>
                ) : (
                  <>
                    <div className="tg-options">
                      {game.scene.options.map((option, i) => (
                        <button
                          disabled={busy}
                          key={option.id}
                          onClick={() => submit(option.id)}
                        >
                          <span>{String(i + 1).padStart(2, "0")}</span>
                          {option.label}
                          <b>→</b>
                        </button>
                      ))}
                    </div>
                    {!busy &&
                      (!game.scene.options.length ||
                        game.run?.status === "failed" ||
                        game.run?.status === "cancelled") && (
                        <button
                          className="tg-retry"
                          onClick={() =>
                            void run(async () =>
                              adopt(
                                await api.retryOutput({
                                  gameId: game.id,
                                  expectedRevision: game.revision,
                                }),
                              ),
                            )
                          }
                        >
                          {game.run && game.run.stage !== "done"
                            ? "重试未完成内容"
                            : "生成现场与选项"}
                        </button>
                      )}
                    <form
                      className="tg-composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        submit();
                      }}
                    >
                      <label htmlFor="tg-input">或者，做点别的</label>
                      <textarea
                        id="tg-input"
                        value={input}
                        maxLength={6000}
                        disabled={busy}
                        placeholder="说出你想做的事情……"
                        onChange={(e) => setInput(e.target.value)}
                      />
                      <button
                        className="tg-primary"
                        disabled={busy || !input.trim()}
                        type="submit"
                      >
                        行动 →
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
            {page === "调用记录" && (
              <Traces key={game.id} api={api} gameId={game.id} />
            )}
            {page === "背包" && (
              <div className="tg-list">
                {Object.entries(w!.inventory).length ? (
                  Object.entries(w!.inventory).map(([id, qty]) => (
                    <div key={id}>
                      <h3>
                        {w!.items[id]?.name || id}
                        <span>× {qty}</span>
                      </h3>
                      <p>{w!.items[id]?.description}</p>
                    </div>
                  ))
                ) : (
                  <p>背包里暂时没有物品。</p>
                )}
                <p className="tg-muted">使用或交付物品，请回到现场输入行动。</p>
              </div>
            )}
            {page === "角色" && (
              <>
                <div className="tg-grid">
                  {Object.entries(w!.stats).map(([key, value]) => (
                    <div key={key}>
                      <span>{labels[key]}</span>
                      <strong>{Math.round(value * 10) / 10}</strong>
                    </div>
                  ))}
                </div>
                <h2>技能</h2>
                <div className="tg-grid">
                  {Object.entries(w!.skills).map(([key, value]) => (
                    <div key={key}>
                      <span>{key}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
                <h2>认识的人</h2>
                {Object.values(w!.npcs).map((n) => (
                  <p key={n.id}>
                    {n.name} · 关系 {n.relationship} ·{" "}
                    {w!.locations[n.location]?.name}
                  </p>
                ))}
              </>
            )}
            {page === "地图" && (
              <div className="tg-list">
                {Object.values(w!.locations).map((loc) => (
                  <div key={loc.id}>
                    <h3>
                      {loc.name}
                      {loc.id === w!.location && <span>当前位置</span>}
                    </h3>
                    <p>{loc.description}</p>
                    <small>
                      {Object.entries(loc.routes)
                        .map(
                          ([id, min]) =>
                            `${w!.locations[id]?.name}（${min} 分钟）`,
                        )
                        .join(" · ")}
                    </small>
                  </div>
                ))}
                <p className="tg-muted">
                  地图用于查看路线；移动请在现场选择或输入。
                </p>
              </div>
            )}
            {page === "任务日志" && (
              <div className="tg-list">
                {Object.values(w!.quests).map((q) => (
                  <div key={q.id}>
                    <h3>
                      {q.title}
                      <span>
                        {
                          {
                            active: "进行中",
                            blocked: "暂时无法继续",
                            completed: "已完成",
                            ended: "已结束但未完成",
                          }[q.status]
                        }
                      </span>
                    </h3>
                    <p>{q.description}</p>
                    {q.goals.map((g, i) => (
                      <p key={i}>
                        {g.done ? "✓" : "○"} {g.text}
                      </p>
                    ))}
                    <small>{q.reason}</small>
                  </div>
                ))}
                {Object.values(w!.offers)
                  .filter((o) => o.status === "offered")
                  .map((o) => (
                    <div key={o.id}>
                      <h3>{w!.npcs[o.npcId].name}的提议</h3>
                      <p>{o.message}</p>
                      <small>回到现场接受或婉拒。</small>
                    </div>
                  ))}
                <h2>已发生的事情</h2>
                {w!.events
                  .slice(-30)
                  .reverse()
                  .map((e, i) => (
                    <div key={i}>
                      <small>{clockLabel(e.minute)}</small>
                      <p>{e.text}</p>
                    </div>
                  ))}
              </div>
            )}
            {page === "存档" && (
              <div className="tg-saves">
                {Array.from({ length: 8 }, (_, slot) => {
                  const s = saved.find((s) => s.slot === slot);
                  return (
                    <div key={slot}>
                      <small>栏位 {slot + 1}</small>
                      <h3>{s?.title || "空存档"}</h3>
                      <p>
                        {s
                          ? new Date(s.date).toLocaleString()
                          : "保存此刻的旅程"}
                      </p>
                      <div className="tg-row">
                        <button
                          disabled={working}
                          onClick={() =>
                            void run(async () => {
                              await api.saveGame({
                                gameId: game.id,
                                slot,
                                title: `${w!.name} · ${w!.locations[w!.location].name}`,
                              });
                              setSaved(await api.listSaves({}));
                            })
                          }
                        >
                          保存
                        </button>
                        <button
                          disabled={working || !s}
                          onClick={() =>
                            void run(async () => {
                              adopt(
                                await api.loadGame({ gameId: game.id, slot }),
                              );
                              setPage("现场");
                            })
                          }
                        >
                          读取
                        </button>
                        <button
                          disabled={working || !s}
                          onClick={() =>
                            void run(async () => {
                              const value = await api.exportSave({ slot });
                              const url = URL.createObjectURL(
                                new Blob([JSON.stringify(value, null, 2)], {
                                  type: "application/json",
                                }),
                              );
                              const a = document.createElement("a");
                              a.href = url;
                              a.download = `tg-save-${slot + 1}.json`;
                              a.click();
                              URL.revokeObjectURL(url);
                            })
                          }
                        >
                          导出
                        </button>
                        <label className="tg-file">
                          导入
                          <input
                            type="file"
                            accept="application/json,.json"
                            disabled={working}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file)
                                void run(async () => {
                                  if (file.size > 10 * 1024 * 1024)
                                    throw new Error("存档不能超过 10 MB");
                                  await api.importSave({
                                    slot,
                                    save: JSON.parse(await file.text()),
                                  });
                                  setSaved(await api.listSaves({}));
                                });
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
                <p className="tg-muted">
                  每次行动已自动保存。旧版 SugarCube 存档不转换，也不会被覆盖。
                </p>
              </div>
            )}
            {page === "设置" && (
              <div className="tg-settings">
                <label>游戏模型{modelSelect}</label>
                {game.model.follow && (
                  <p className="tg-muted">
                    跟随 DSH 当前模型
                    {followEntry
                      ? `（当前为 ${followEntry.provider} / ${followEntry.model}）`
                      : ""}
                    ：每次阶段调用都会读取 DSH 的模型配置，在 DSH
                    中切换模型后从下一次行动生效。
                  </p>
                )}
                <button
                  disabled={busy || !chooseModel()}
                  onClick={() =>
                    void run(async () =>
                      adopt(
                        await api.configure({
                          gameId: game.id,
                          model: chooseModel()!,
                          theme: game.theme,
                        }),
                      ),
                    )
                  }
                >
                  保存模型选择
                </button>
                <label>
                  界面主题
                  <select
                    disabled={busy}
                    value={game.theme}
                    onChange={(e) =>
                      void run(async () =>
                        adopt(
                          await api.configure({
                            gameId: game.id,
                            model: game.model,
                            theme: e.target.value as "dark" | "light",
                          }),
                        ),
                      )
                    }
                  >
                    <option value="dark">夜色</option>
                    <option value="light">纸页</option>
                  </select>
                </label>
                <label>
                  新角色名字
                  <input
                    maxLength={160}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <button
                  className="tg-primary"
                  disabled={working}
                  onClick={newGame}
                >
                  重新开局
                </button>
                <p className="tg-muted">
                  原有旅程保留在开始页，不覆盖手动存档。
                </p>
                <button
                  disabled={working}
                  onClick={() => {
                    activeId.current = null;
                    setGame(null);
                    void api.listGames({}).then(setGames);
                  }}
                >
                  返回旅程列表
                </button>
              </div>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
export const inject = ["slots", "remote"];
export async function apply(ctx: Context): Promise<void> {
  await ctx.remote.$mount(remoteContribution);
  ctx.inject(["remote.tg"], (scoped) => {
    const api = gameApi(scoped.remote.tg);
    const onReconnect = (refresh: () => void): (() => void) =>
      scoped.on("connection/reset", refresh);
    scoped.slots.inject("main", () =>
      scoped.slots.register(
        { name: "main", key: "tg-game", inject: () => ({ api, onReconnect }) },
        App,
      ),
    );
    scoped.slots.inject("sidebar.panellist", () =>
      scoped.slots.register(
        {
          name: "sidebar.panellist",
          id: "tg-game",
          label: "文字游戏",
          order: 70,
        },
        Icon,
      ),
    );
  });
}
