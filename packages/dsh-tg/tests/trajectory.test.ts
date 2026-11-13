import { test } from "node:test";
import assert from "node:assert/strict";
import { trajectoryRows, contentText } from "../src/client/trajectory";

test("request headers expose their own actual tool schemas without inventing missing definitions", () => {
  const tools = [
    {
      name: "tg_propose_result",
      description: "提交",
      parameters: {
        type: "object",
        properties: { json: { type: "string" } },
        required: ["json"],
      },
    },
  ];
  const events = [
    { type: "request/header", data: { header: { tools } } },
    { type: "request/header", data: { header: { tools: [] } } },
    { type: "request/header", data: { header: {} } },
  ];
  const before = structuredClone(events);
  const rows = trajectoryRows(events);
  assert.deepEqual(rows[0].tools, tools);
  assert.match(rows[0].summary, /tg_propose_result/);
  assert.deepEqual(rows[1].tools, []);
  assert.equal(rows[2].tools, undefined);
  assert.deepEqual(events, before);
});
test("trajectory pairs overlapping calls by identity and uses actual timestamps", () => {
  const events = [
    {
      seq: 0,
      time: 1000,
      type: "tool/call",
      data: { step: 2, name: "a", callId: "a", arguments: "{}" },
    },
    {
      seq: 1,
      time: 1100,
      type: "tool/call",
      data: { step: 2, name: "b", callId: "b", arguments: "{}" },
    },
    {
      seq: 2,
      time: 1400,
      type: "tool/result",
      data: {
        message: {
          toolCallId: "b",
          content: [{ text: "REJECTED" }],
          isError: true,
        },
      },
    },
    {
      seq: 3,
      time: 1600,
      type: "tool/result",
      data: { message: { toolCallId: "a", content: [{ text: "STAGED" }] } },
    },
  ];
  const rows = trajectoryRows(events);
  assert.equal(rows[0].duration, 600);
  assert.equal(rows[1].duration, 300);
  assert.equal(contentText(rows[0].result), "STAGED");
  assert.equal(rows[0].error, false);
  assert.equal(rows[1].error, true);
  assert.deepEqual(rows[0].pairedRaw, events[3]);
});
test("readable text preserves all text blocks and raw events, absent usage stays absent", () => {
  const raw = {
    seq: 9,
    type: "assistant/message",
    data: {
      message: {
        content: [
          { type: "text", text: "第一段" },
          { type: "text", text: "第二段" },
        ],
      },
    },
  };
  const [row] = trajectoryRows([raw]);
  assert.equal(row.summary, "第一段\n\n第二段");
  assert.equal(row.duration, null);
  assert.equal(row.usage, undefined);
  assert.deepEqual(row.raw, raw);
  assert.doesNotThrow(() => trajectoryRows([null, { type: "unknown" }]));
});
