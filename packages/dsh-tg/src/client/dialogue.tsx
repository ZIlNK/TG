import React, { useEffect, useRef, useState } from "react";
import type { Game } from "../core/schema";
import { dialogueMessages } from "../core/dialogue";
import { clockLabel } from "../core/world";

export function DialogueView({
  game,
  busy,
  working,
  send,
  exit,
  retry,
  cancel,
}: {
  game: Game;
  busy: boolean;
  working: boolean;
  send: (text: string) => Promise<boolean>;
  exit: () => void;
  retry: () => void;
  cancel: () => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const npc = game.world.npcs[game.dialogue!.npcId];
  const messages = dialogueMessages(game);
  const unfinished = game.run?.kind === "dialogue" && game.run.stage !== "done";
  useEffect(() => {
    const node = list.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);
  return (
    <section className="tg-dialogue" aria-label={`与${npc.name}交谈`}>
      <header className="tg-dialogue-header">
        <div>
          <p className="tg-eyebrow">
            交谈中 · {game.world.locations[game.world.location].name}
          </p>
          <h2>{npc.name}</h2>
          <span className="tg-muted">
            关系 {npc.relationship} · {clockLabel(game.world.minute)}
          </span>
        </div>
        <button disabled={working} onClick={exit}>
          结束对话，返回现场
        </button>
      </header>
      <div
        className="tg-dialogue-messages"
        ref={list}
        role="log"
        aria-label="对话记录"
        aria-live="polite"
      >
        {!messages.length && (
          <p className="tg-muted">你走近了{npc.name}。想对 TA 说些什么？</p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className="tg-dialogue-message"
            data-speaker={m.speakerId === "player" ? "player" : "npc"}
          >
            <header>
              <strong>{m.speakerId === "player" ? "你" : npc.name}</strong>
              <small>{clockLabel(m.minute)}</small>
            </header>
            <p>{m.text}</p>
          </article>
        ))}
      </div>
      {game.run?.status === "running" && (
        <div role="status" className="tg-status">
          等待{npc.name}回应…{" "}
          <button disabled={working} onClick={cancel}>
            取消等待
          </button>
        </div>
      )}
      {unfinished && game.run?.status !== "running" && (
        <div className="tg-error" role="alert">
          {game.run?.error}
          <button disabled={working} onClick={retry}>
            重试回应
          </button>
        </div>
      )}
      {game.world.over && <p role="alert">本局结束：{game.world.over}</p>}
      <form
        className="tg-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !unfinished && text.trim())
            void send(text.trim()).then((sent) => {
              if (sent) setText("");
            });
        }}
      >
        <label htmlFor="tg-dialogue-input">对{npc.name}说</label>
        <textarea
          id="tg-dialogue-input"
          value={text}
          maxLength={6000}
          disabled={busy || Boolean(unfinished) || Boolean(game.world.over)}
          onChange={(event) => setText(event.target.value)}
          placeholder="输入你想说的话……"
        />
        <button
          className="tg-primary"
          disabled={
            busy ||
            Boolean(unfinished) ||
            !text.trim() ||
            Boolean(game.world.over)
          }
        >
          发送
        </button>
      </form>
      <p className="tg-muted">
        每次说话耗时 1 分钟。移动、交付或接受提议，请结束对话后在现场操作。
      </p>
    </section>
  );
}
