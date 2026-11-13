export type ObjectValue = Record<string, unknown>;
export const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : {};
export function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(contentText).filter(Boolean).join("\n\n");
  const block = object(value);
  if (typeof block.text === "string") return block.text;
  if (block.content !== undefined) return contentText(block.content);
  return "";
}
export const eventNames: Record<string, string> = {
  "system/message": "系统提示",
  "developer/message": "开发指令",
  "user/message": "用户输入",
  "assistant/message": "模型回复",
  "assistant/attempt": "未完成输出",
  "tool/call": "工具调用",
  "tool/result": "工具结果",
  "request/header": "模型工具列表与请求配置",
  "request/context": "请求上下文",
  "turn/start": "开始处理",
  "turn/end": "处理结束",
  "step/start": "请求开始",
  "step/end": "请求结束",
};
export interface EventRow {
  id: string;
  type: string;
  label: string;
  step: string;
  time: number | null;
  duration: number | null;
  summary: string;
  body: unknown;
  tools?: unknown[];
  result?: unknown;
  usage?: unknown;
  error: boolean;
  raw: unknown;
  pairedRaw?: unknown;
}
export function trajectoryRows(events: unknown[]): EventRow[] {
  return events.map((raw, index) => {
    const e = object(raw),
      d = object(e.data),
      message = object(d.message);
    const type = String(e.type ?? "unknown");
    const time = typeof e.time === "number" ? e.time : null;
    const end =
      type === "tool/call"
        ? events.find((value) => {
            const candidate = object(value),
              data = object(candidate.data);
            return (
              candidate.type === "tool/result" &&
              typeof d.callId === "string" &&
              object(data.message).toolCallId === d.callId
            );
          })
        : undefined;
    const endEvent = object(end),
      result = object(object(endEvent.data).message);
    const body = type === "tool/call" ? d.arguments : (d.message ?? d);
    const readable = contentText(body);
    const header = object(d.header);
    const tools =
      type === "request/header" && Array.isArray(header.tools)
        ? header.tools
        : undefined;
    const summary =
      type === "tool/call"
        ? String(d.name ?? "工具")
        : type === "request/header"
          ? tools === undefined
            ? "原始记录未提供工具列表"
            : `${tools.length} 个工具：${tools.map((tool) => String(object(tool).name ?? "未命名")).join("、")}`
          : readable ||
            (type === "turn/end"
              ? String(object(d.reason).kind ?? "结束")
              : (JSON.stringify(body) ?? ""));
    return {
      id: String(e.seq ?? index),
      type,
      label: eventNames[type] ?? type,
      step: typeof d.step === "number" ? String(d.step) : "—",
      time,
      duration:
        time !== null && typeof endEvent.time === "number"
          ? Math.max(0, endEvent.time - time)
          : null,
      summary,
      body,
      tools,
      result: end ? result : undefined,
      usage: d.usage,
      error:
        message.isError === true || result.isError === true || Boolean(d.error),
      raw,
      pairedRaw: end,
    };
  });
}
