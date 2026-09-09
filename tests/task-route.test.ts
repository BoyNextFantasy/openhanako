import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { TaskRegistry } from "../lib/task-registry.ts";
import { buildForest, createTasksRoute } from "../server/routes/tasks.ts";

function makeApp() {
  const registry = new TaskRegistry({ persistencePath: null });
  const engine = { taskRegistry: registry };
  const app = new Hono();
  app.route("/api", createTasksRoute(engine));
  return { app, registry };
}

describe("tasks route", () => {
  it("GET returns empty forest when no tasks exist", async () => {
    const { app } = makeApp();
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, tasks: [] });
  });

  it("GET returns nested forest including terminal nodes", async () => {
    const { app, registry } = makeApp();
    const parent = registry.createLLMTask("父任务");
    const child = registry.createLLMTask("子任务A", { parentTaskId: parent.taskId });
    registry.startLLMTask(parent.taskId);
    registry.doneLLMTask(child.taskId);

    const res = await app.request("/api/tasks");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tasks).toHaveLength(1);
    const node = body.tasks[0];
    expect(node).toMatchObject({
      id: parent.taskId,
      summary: "父任务",
      status: "in_progress",
      parentTaskId: null,
    });
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toMatchObject({
      id: child.taskId,
      summary: "子任务A",
      status: "done",
      parentTaskId: parent.taskId,
    });
  });

  it("promotes orphan tasks whose parent is missing to top level", () => {
    const forest = buildForest([
      {
        taskId: "T1",
        status: "open",
        _llmParentTaskId: "T-missing",
        _llmSummary: "孤儿任务",
        children: [] as any,
      } as any,
    ]);
    expect(forest).toHaveLength(1);
    expect(forest[0]).toMatchObject({ id: "T1", summary: "孤儿任务", parentTaskId: "T-missing" });
    expect(forest[0].children).toEqual([]);
  });

  it("filters tasks by sessionPath and excludes untagged legacy tasks", async () => {
    const { app, registry } = makeApp();
    registry.createLLMTask("会话A的任务", { sessionPath: "/s/a.jsonl" });
    registry.createLLMTask("会话B的任务", { sessionPath: "/s/b.jsonl" });
    registry.createLLMTask("无标记历史任务");

    const res = await app.request("/api/tasks?sessionPath=%2Fs%2Fa.jsonl");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ summary: "会话A的任务", parentTaskId: null });
    expect(body.tasks[0].children).toEqual([]);

    const all = await app.request("/api/tasks");
    const allBody = await all.json();
    expect(allBody.tasks).toHaveLength(3);
  });

  it("matches sessionPath across slash/case forms via normalized key", async () => {
    const { app, registry } = makeApp();
    registry.createLLMTask("反斜杠打标任务", { sessionPath: "C:\\Users\\me\\sessions\\a.jsonl" });

    // 前端事件链路可能给出正斜杠/大小写不同的同一路径，归一化后必须命中
    const res = await app.request("/api/tasks?sessionPath=" + encodeURIComponent("c:/users/ME/Sessions/a.jsonl"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].summary).toBe("反斜杠打标任务");
  });

  it("POST done transitions an active task", async () => {
    const { app, registry } = makeApp();
    const task = registry.createLLMTask("待完成任务");
    const res = await app.request(`/api/tasks/${task.taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "done" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.task.status).toBe("done");
    expect(registry.getLLMTask(task.taskId)?.status).toBe("done");
  });

  it("POST abandon transitions an active task", async () => {
    const { app, registry } = makeApp();
    const task = registry.createLLMTask("待放弃任务");
    const res = await app.request(`/api/tasks/${task.taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abandon" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.status).toBe("abandoned");
  });

  it("POST done on a terminal task returns 409", async () => {
    const { app, registry } = makeApp();
    const task = registry.createLLMTask("已完成任务");
    registry.doneLLMTask(task.taskId);
    const res = await app.request(`/api/tasks/${task.taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "done" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("POST unknown action returns 400", async () => {
    const { app, registry } = makeApp();
    const task = registry.createLLMTask("任意任务");
    const res = await app.request(`/api/tasks/${task.taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rename" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 503 when engine has no task registry", async () => {
    const app = new Hono();
    app.route("/api", createTasksRoute({}));
    const res = await app.request("/api/tasks");
    expect(res.status).toBe(503);
  });
});
