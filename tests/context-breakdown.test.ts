import { describe, expect, it } from "vitest";

import { estimateContextBreakdown } from "../core/compaction-utils.ts";

describe("estimateContextBreakdown", () => {
  it("splits total tokens into system/tools/messages/other by chars/4", () => {
    // 400 字符 ≈ 100 token（chars/4 口径）
    const result = estimateContextBreakdown({
      systemPrompt: "s".repeat(400),
      toolDefs: [{ name: "read", schema: "x".repeat(400) }],
      messages: [{ role: "user", content: "m".repeat(400) }],
      totalTokens: 1000,
    });

    expect(result).toMatchObject({ estimated: true });
    expect(result.systemPromptTokens).toBe(100);
    expect(result.toolsTokens).toBeGreaterThan(100); // JSON.stringify 有包裹开销
    expect(result.messagesTokens).toBeGreaterThan(0);
    expect(result.otherTokens).toBe(1000 - result.systemPromptTokens - result.toolsTokens - result.messagesTokens);
  });

  it("clamps otherTokens at zero when estimates exceed the reported total", () => {
    const result = estimateContextBreakdown({
      systemPrompt: "s".repeat(40_000),
      toolDefs: [],
      messages: [],
      totalTokens: 10,
    });
    expect(result.otherTokens).toBe(0);
  });

  it("handles missing session content gracefully", () => {
    const result = estimateContextBreakdown({ totalTokens: 500 });
    expect(result.systemPromptTokens).toBe(0);
    expect(result.toolsTokens).toBe(0);
    expect(result.messagesTokens).toBe(0);
    expect(result.otherTokens).toBe(500);
  });
});
