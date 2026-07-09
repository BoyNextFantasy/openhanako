import { describe, it, expect } from "vitest";
import { TaskRegistry } from "../lib/task-registry.ts";
import { createTaskTool } from "../lib/tools/task-tool.ts";
import os from "os";
import path from "path";
import fs from "fs";

function tempPath() {
  return path.join(os.tmpdir(), `satori-task-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
}

function createRegistry(persistPath = null) {
  return new TaskRegistry({ persistencePath: persistPath });
}

// ── TaskRegistry LLM task methods ──

describe("TaskRegistry LLM tasks", () => {
  it("creates a task with auto-generated ID", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Implement auth");
    expect(t.taskId).toBe("T1");
    expect(t.status).toBe("open");
    expect(t._llmSummary).toBe("Implement auth");
    expect(t._llmParentTaskId).toBeNull();
  });

  it("creates subtasks with dotted IDs", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("Parent");
    const t1_1 = r.createLLMTask("Child 1", { parentTaskId: t1.taskId });
    const t1_2 = r.createLLMTask("Child 2", { parentTaskId: t1.taskId });
    expect(t1_1.taskId).toBe("T1.1");
    expect(t1_2.taskId).toBe("T1.2");
    expect(t1_1._llmParentTaskId).toBe("T1");
  });

  it("rejects subtasks with missing parent IDs", () => {
    const r = createRegistry();
    expect(() => r.createLLMTask("Orphan child", { parentTaskId: "T999" }))
      .toThrow('parent LLM task "T999" not found');
  });

  it("creates top-level tasks with sequential IDs", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("First");
    const t2 = r.createLLMTask("Second");
    const t3 = r.createLLMTask("Third");
    expect(t1.taskId).toBe("T1");
    expect(t2.taskId).toBe("T2");
    expect(t3.taskId).toBe("T3");
  });

  it("auto-generates nested subtask IDs correctly", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("T1");
    const t11 = r.createLLMTask("T1.1", { parentTaskId: t1.taskId });
    r.createLLMTask("T1.2", { parentTaskId: t1.taskId });
    const t111 = r.createLLMTask("T1.1.1", { parentTaskId: t11.taskId });
    expect(t11.taskId).toBe("T1.1");
    expect(t111.taskId).toBe("T1.1.1");
  });

  it("detects and rejects circular parent reference", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("T1");
    // creating with valid parent works
    expect(() => r.createLLMTask("child", { parentTaskId: t1.taskId })).not.toThrow();
    // self-reference via _detectParentCycle
    expect(r._detectParentCycle(t1.taskId, t1.taskId)).toBe(true);
  });

  it("detects circular parent chain", () => {
    const r = createRegistry();
    const head = r.createLLMTask("head");
    const mid = r.createLLMTask("mid", { parentTaskId: head.taskId });
    const tail = r.createLLMTask("tail", { parentTaskId: mid.taskId });
    // chain: T1 → T2 → T3. If we try to make T2's parent = T3, that's a cycle
    expect(r._detectParentCycle(mid.taskId, tail.taskId)).toBe(true);
    // Non-cycle: T4 with parent T1 is fine
    expect(r._detectParentCycle("T4", head.taskId)).toBe(false);
  });

  it("lifecycle: open → in_progress → done", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Test lifecycle");
    expect(t.status).toBe("open");

    const started = r.startLLMTask(t.taskId);
    expect(started.status).toBe("in_progress");

    const done = r.doneLLMTask(t.taskId);
    expect(done.status).toBe("done");
    expect(done.endedAt).toBeGreaterThan(0);
  });

  it("lifecycle: open → block → unblock → abandon", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Block me");
    r.startLLMTask(t.taskId);
    const blocked = r.blockLLMTask(t.taskId);
    expect(blocked.status).toBe("blocked");

    const unblocked = r.unblockLLMTask(t.taskId);
    expect(unblocked.status).toBe("open");

    const abandoned = r.abandonLLMTask(t.taskId);
    expect(abandoned.status).toBe("abandoned");
  });

  it("cannot start a terminal task", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Done already");
    r.doneLLMTask(t.taskId);
    expect(() => r.startLLMTask(t.taskId)).toThrow("terminal");
  });

  it("cannot block a terminal task", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Done already");
    r.doneLLMTask(t.taskId);
    expect(() => r.blockLLMTask(t.taskId)).toThrow("terminal");
  });

  it("cannot re-transition a terminal task", () => {
    const r = createRegistry();
    const done = r.createLLMTask("Done already");
    r.doneLLMTask(done.taskId);
    expect(() => r.doneLLMTask(done.taskId)).toThrow("terminal");
    expect(() => r.abandonLLMTask(done.taskId)).toThrow("terminal");

    const abandoned = r.createLLMTask("Abandoned already");
    r.abandonLLMTask(abandoned.taskId);
    expect(() => r.doneLLMTask(abandoned.taskId)).toThrow("terminal");
    expect(() => r.abandonLLMTask(abandoned.taskId)).toThrow("terminal");
  });

  it("can rename a terminal task without changing execution state", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Old terminal name");
    r.doneLLMTask(t.taskId);

    const renamed = r.renameLLMTask(t.taskId, "New terminal name");

    expect(renamed.status).toBe("done");
    expect(renamed._llmSummary).toBe("New terminal name");
  });

  it("cannot unblock a non-blocked task", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Not blocked");
    expect(() => r.unblockLLMTask(t.taskId)).toThrow("open");
  });

  it("renames a task", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Old name");
    const renamed = r.renameLLMTask(t.taskId, "New name");
    expect(renamed._llmSummary).toBe("New name");
  });

  it("lists only active tasks by default", () => {
    const r = createRegistry();
    r.createLLMTask("Active");
    const done = r.createLLMTask("Done");
    r.doneLLMTask(done.taskId);

    const list = r.listLLMTasks();
    expect(list).toHaveLength(1);
    expect(list[0]._llmSummary).toBe("Active");
  });

  it("lists tasks with includeTerminal", () => {
    const r = createRegistry();
    r.createLLMTask("Active");
    const done = r.createLLMTask("Done");
    r.doneLLMTask(done.taskId);

    const list = r.listLLMTasks({ includeTerminal: true });
    expect(list).toHaveLength(2);
  });

  it("filters by parent_task_id", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("Parent");
    r.createLLMTask("Child", { parentTaskId: t1.taskId });
    r.createLLMTask("Orphan");

    const children = r.listLLMTasks({ parentTaskId: "T1" });
    expect(children).toHaveLength(1);
    expect(children[0].taskId).toBe("T1.1");
  });

  it("filters top-level tasks only", () => {
    const r = createRegistry();
    const t1 = r.createLLMTask("Parent");
    r.createLLMTask("Child", { parentTaskId: t1.taskId });

    const topLevel = r.listLLMTasks({ parentTaskId: null });
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].taskId).toBe("T1");
  });

  it("filters by status", () => {
    const r = createRegistry();
    r.createLLMTask("Open");
    const inProgress = r.createLLMTask("In progress");
    r.startLLMTask(inProgress.taskId);

    const openOnly = r.listLLMTasks({ status: "open" });
    expect(openOnly).toHaveLength(1);
  });

  it("get returns single task", () => {
    const r = createRegistry();
    const t = r.createLLMTask("Find me");
    const found = r.getLLMTask(t.taskId);
    expect(found._llmSummary).toBe("Find me");
  });

  it("get returns null for non-existent", () => {
    const r = createRegistry();
    expect(r.getLLMTask("T999")).toBeNull();
  });

  it("get returns null for non-LLM task", () => {
    const r = createRegistry();
    r.register("bg-1", { type: "plugin" });
    expect(r.getLLMTask("bg-1")).toBeNull();
  });

  it("persists and loads LLM tasks from JSON", () => {
    const p = tempPath();
    const r1 = createRegistry(p);
    r1.createLLMTask("Persisted");
    const done = r1.createLLMTask("Completed");
    r1.doneLLMTask(done.taskId);

    // reload from disk
    const r2 = createRegistry(p);
    const list = r2.listLLMTasks({ includeTerminal: true });
    expect(list).toHaveLength(2);
    expect(list.find((t: any) => t._llmSummary === "Persisted")).toBeTruthy();

    try { fs.unlinkSync(p); } catch {}
  });
});

// ── Task tool (LLM-visible) ──

function makeTaskTool(registry) {
  return createTaskTool({ getTaskRegistry: () => registry });
}

describe("task tool", () => {
  it("create operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    const result = await tool.execute("tc-1", {
      operation: { action: "create", summary: "Implement auth" },
    });
    expect(result.content[0].text).toContain("T1");
    expect(result.content[0].text).toContain("open");
    expect(result.content[0].text).toContain("Implement auth");
  });

  it("create with parent_id", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Parent" } });
    const result = await tool.execute("tc-2", {
      operation: { action: "create", summary: "Child", parent_id: "T1" },
    });
    expect(result.content[0].text).toContain("T1.1");
  });

  it("list operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "First" } });
    const result = await tool.execute("tc-2", { operation: { action: "list" } });
    expect(result.content[0].text).toContain("T1");
    expect(result.content[0].text).toContain("open");
    expect(result.content[0].text).toContain("First");
  });

  it("get operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Target" } });
    const result = await tool.execute("tc-2", { operation: { action: "get", id: "T1" } });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe("T1");
    expect(parsed.summary).toBe("Target");
  });

  it("get operation — not found", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    const result = await tool.execute("tc-1", { operation: { action: "get", id: "T999" } });
    expect(result.content[0].text).toContain("not found");
  });

  it("start operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Start me" } });
    const result = await tool.execute("tc-2", { operation: { action: "start", id: "T1" } });
    expect(result.content[0].text).toContain("in_progress");
  });

  it("block/unblock cycle", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Rollercoaster" } });
    const blockResult = await tool.execute("tc-2", { operation: { action: "block", id: "T1", event_summary: "waiting on dependency" } });
    expect(blockResult.content[0].text).toContain("blocked");

    const unblockResult = await tool.execute("tc-3", { operation: { action: "unblock", id: "T1" } });
    expect(unblockResult.content[0].text).toContain("open");
  });

  it("persists lifecycle event_summary provided through the task tool", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);

    const expectLastEvent = async (id, expected) => {
      const result = await tool.execute(`get-${id}`, { operation: { action: "get", id } });
      expect(result.content[0].text).toContain(`"last_event": "${expected}"`);
    };

    await tool.execute("create-start", { operation: { action: "create", summary: "Start details" } });
    await tool.execute("start", { operation: { action: "start", id: "T1", event_summary: "beginning work" } });
    await expectLastEvent("T1", "started: beginning work");

    await tool.execute("create-block", { operation: { action: "create", summary: "Block details" } });
    await tool.execute("block", { operation: { action: "block", id: "T2", event_summary: "waiting on dependency" } });
    await expectLastEvent("T2", "blocked: waiting on dependency");

    await tool.execute("unblock", { operation: { action: "unblock", id: "T2", event_summary: "dependency resolved" } });
    await expectLastEvent("T2", "unblocked: dependency resolved");

    await tool.execute("create-done", { operation: { action: "create", summary: "Done details" } });
    await tool.execute("done", { operation: { action: "done", id: "T3", event_summary: "all tests pass" } });
    await expectLastEvent("T3", "done: all tests pass");

    await tool.execute("create-abandon", { operation: { action: "create", summary: "Abandon details" } });
    await tool.execute("abandon", { operation: { action: "abandon", id: "T4", event_summary: "out of scope" } });
    await expectLastEvent("T4", "abandoned: out of scope");
  });

  it("done operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Finish me" } });
    const result = await tool.execute("tc-2", { operation: { action: "done", id: "T1", event_summary: "all tests pass" } });
    expect(result.content[0].text).toContain("done");
  });

  it("abandon operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Drop me" } });
    const result = await tool.execute("tc-2", { operation: { action: "abandon", id: "T1", event_summary: "out of scope" } });
    expect(result.content[0].text).toContain("abandoned");
  });

  it("rename operation", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    await tool.execute("tc-1", { operation: { action: "create", summary: "Old" } });
    const result = await tool.execute("tc-2", { operation: { action: "rename", id: "T1", summary: "New" } });
    expect(result.content[0].text).toContain("New");
  });

  it("empty list returns 'No tasks.'", async () => {
    const r = createRegistry();
    const tool = makeTaskTool(r);
    const result = await tool.execute("tc-1", { operation: { action: "list" } });
    expect(result.content[0].text).toBe("No tasks.");
  });

  it("registry unavailable returns error", async () => {
    const tool = createTaskTool({ getTaskRegistry: () => null });
    const result = await tool.execute("tc-1", { operation: { action: "list" } });
    expect(result.content[0].text).toContain("unavailable");
  });
});
