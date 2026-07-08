import { describe, expect, it, vi } from "vitest";
import { createMemorySearchTool } from "../lib/memory/memory-search.ts";

function makeFactStore(rows) {
  return {
    get size() {
      return rows.length;
    },
    searchByTags: vi.fn(() => rows),
    searchFullText: vi.fn(() => rows),
  };
}

describe("search_memory conversation scope", () => {
  it("returns all matching facts when no conversation scope is provided", async () => {
    const rows = [
      { id: 1, fact: "当前会话记忆", tags: ["plan"], time: "2026-07-08T10:00", session_id: "session-a" },
      { id: 2, fact: "其它会话记忆", tags: ["plan"], time: "2026-07-08T11:00", session_id: "session-b" },
    ];
    const tool = createMemorySearchTool(makeFactStore(rows));

    const result = await tool.execute("call-1", { query: "plan", tags: ["plan"] });
    const text = result.content[0].text;

    expect(text).toContain("当前会话记忆");
    expect(text).toContain("其它会话记忆");
  });

  it("hides facts from other sessions when a conversation scope is provided", async () => {
    const rows = [
      { id: 1, fact: "当前会话记忆", tags: ["plan"], time: "2026-07-08T10:00", session_id: "session-a" },
      { id: 2, fact: "其它会话记忆", tags: ["plan"], time: "2026-07-08T11:00", session_id: "session-b" },
      { id: 3, fact: "全局记忆", tags: ["plan"], time: "2026-07-08T12:00", session_id: null },
    ];
    const tool = createMemorySearchTool(makeFactStore(rows), {
      conversationScope: { sessionId: "session-a" },
    });

    const result = await tool.execute("call-1", { query: "plan", tags: ["plan"] });
    const text = result.content[0].text;

    expect(text).toContain("当前会话记忆");
    expect(text).toContain("全局记忆");
    expect(text).not.toContain("其它会话记忆");
  });
});
