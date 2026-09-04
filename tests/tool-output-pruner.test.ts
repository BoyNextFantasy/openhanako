import { describe, it, expect } from "vitest";
import { pruneToolOutputs } from "../core/tool-output-pruner.ts";

function makeMsg(role: string, text: string, overrides: any = {}) {
  return {
    role,
    content: [{ type: "text", text }],
    ...overrides,
  };
}

function makeToolResult(text: string, overrides: any = {}) {
  return makeMsg("toolResult", text, overrides);
}

function makeUser(text: string) {
  return makeMsg("user", text);
}

describe("pruneToolOutputs", () => {
  it("returns unmodified array when no pruning needed (few messages)", () => {
    const msgs = [
      makeUser("hello"),
      makeToolResult("short response"),
    ];
    const { messages: result } = pruneToolOutputs(msgs);
    expect(result).toEqual(msgs);
  });

  it("protects last 2 user turns from pruning", () => {
    const largeText = "x".repeat(50_000 * 4);
    const msgs = [
      makeUser("old question"),
      makeToolResult(largeText),
      makeUser("recent question 1"),
      makeToolResult(largeText),
      makeUser("recent question 2"),
      makeToolResult(largeText),
    ];
    const { messages: result } = pruneToolOutputs(msgs);
    // Recent 2 turns untouched
    expect(result[3].content[0].text).toBe(largeText);
    expect(result[5].content[0].text).toBe(largeText);
    // Old tool output pruned
    expect(result[1].content[0].text).toBe("[工具输出已省略]");
  });

  it("protects the current turn when fewer than protectedTurns user turns exist", () => {
    const largeText = "x".repeat(70_000 * 4);
    const msgs = [
      makeUser("read this large file"),
      makeToolResult(largeText),
    ];

    const { messages: result } = pruneToolOutputs(msgs);

    expect(result[1].content[0].text.length).toBe(largeText.length);
    expect(result[1].content[0].text).not.toBe("[工具输出已省略]");
  });

  it("protects tool results under token budget", () => {
    const smallText = "small output";
    const msgs: any[] = [];
    for (let i = 0; i < 3; i++) {
      msgs.push(makeUser(`question ${i}`));
      msgs.push(makeToolResult(smallText));
    }
    const { messages: result } = pruneToolOutputs(msgs);
    for (const msg of result) {
      if (msg.role === "toolResult") {
        expect(msg.content[0].text).toBe(smallText);
      }
    }
  });

  it("skips pruning when savings below threshold", () => {
    const mediumText = "y".repeat(5_000 * 4);
    const msgs = [
      makeUser("turn 1"),
      makeToolResult(mediumText),
      makeUser("turn 2"),
      makeToolResult(mediumText),
      makeUser("turn 3"),
      makeToolResult(mediumText),
    ];
    const { messages: result } = pruneToolOutputs(msgs);
    expect(result).toEqual(msgs);
  });

  it("preserves error tool results", () => {
    const largeText = "z".repeat(50_000 * 4);
    const msgs = [
      makeUser("turn 1"),
      makeToolResult("small", { isError: true }),
      makeUser("turn 2"),
      makeToolResult(largeText, { isError: true }),
      makeUser("turn 3"),
      makeToolResult(largeText, { isError: true }),
    ];
    const { messages: result } = pruneToolOutputs(msgs);
    for (const msg of result) {
      if (msg.role === "toolResult") {
        expect(msg.content[0].text).not.toBe("[工具输出已省略]");
      }
    }
  });

  it("stops at compaction boundary", () => {
    const largeText = "w".repeat(50_000 * 4);
    const msgs = [
      makeUser("before compaction"),
      makeToolResult(largeText),
      { type: "compaction", summary: "previous summary" },
      makeUser("after compaction"),
      makeToolResult(largeText),
      makeUser("recent"),
      makeToolResult(largeText),
    ];
    const { messages: result } = pruneToolOutputs(msgs);
    // Before compaction boundary: not reached (stop at compaction marker)
    // So first tool result is NOT in the scan range
    // The messages after compaction: tool results in last 2 turns are protected
    expect(result[4].content[0].text).toBe(largeText);
    expect(result[6].content[0].text).toBe(largeText);
  });

  it("preserves non-text content blocks", () => {
    const msgs = [
      makeUser("turn 1"),
      {
        role: "toolResult",
        content: [
          { type: "image", data: "base64..." },
          { type: "text", text: "x".repeat(50_000 * 4) },
        ],
      },
      makeUser("turn 2"),
      makeToolResult("recent"),
      makeUser("turn 3"),
      makeToolResult("recent"),
    ];
    const { messages: result } = pruneToolOutputs(msgs, { protectedTurns: 2 });
    // Image block preserved
    expect(result[1].content[0].type).toBe("image");
    expect(result[1].content[0].data).toBe("base64...");
    // Text block pruned
    expect(result[1].content[1].text).toBe("[工具输出已省略]");
  });

  it("respects custom options", () => {
    const largeText = "v".repeat(10_000 * 4);
    const msgs = [
      makeUser("turn 1"),
      makeToolResult(largeText),
      makeUser("turn 2"),
      makeToolResult(largeText),
      makeUser("turn 3"),
      makeToolResult(largeText),
    ];
    const { messages: result } = pruneToolOutputs(msgs, {
      protectedTurns: 1,
      protectedTokens: 5_000,
      minimumPruneTokens: 5_000,
    });
    // First tool output should be pruned (past 1-turn protection + over 5K budget)
    expect(result[1].content[0].text).toBe("[工具输出已省略]");
  });
});
