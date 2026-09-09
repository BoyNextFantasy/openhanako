import { Hono } from "hono";
import { safeJson } from "../hono-helpers.ts";

// LLM 任务森林路由：右侧工作区「任务计划」卡的数据源（只读 + done/abandon 两个操作）。
// 已知限制：TaskRegistry 是 engine 级全局单例，LLM 任务没有 agentId 字段，
// 多 agent 共享同一任务池（演示场景单 agent，无影响；隔离需先改数据模型）。

interface FlatTask {
  taskId: string;
  status: string;
  _llmParentTaskId?: string | null;
  _llmSummary?: string | null;
  _llmOwner?: string | null;
  _llmLastEventKind?: string | null;
  _llmLastEventSummary?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  endedAt?: number | null;
  [key: string]: any;
}

interface TaskNode {
  id: string;
  summary: string;
  status: string;
  parentTaskId: string | null;
  owner: string | null;
  lastEventKind: string | null;
  lastEventSummary: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  endedAt: number | null;
  children: TaskNode[];
}

function toNode(task: FlatTask): TaskNode {
  return {
    id: task.taskId,
    summary: task._llmSummary || "",
    status: task.status,
    parentTaskId: task._llmParentTaskId || null,
    owner: task._llmOwner || null,
    lastEventKind: task._llmLastEventKind || null,
    lastEventSummary: task._llmLastEventSummary || null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    endedAt: task.endedAt ?? null,
    children: [],
  };
}

// 平铺数组按 _llmParentTaskId 组森林；父不存在或父不是 LLM 任务时提升为顶层（防脏数据丢节点）。
export function buildForest(tasks: FlatTask[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>();
  for (const task of tasks) nodes.set(task.taskId, toNode(task));

  const roots: TaskNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentTaskId ? nodes.get(node.parentTaskId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function createTasksRoute(engine: any) {
  const route = new Hono();

  route.get("/tasks", (c) => {
    const registry = engine?.taskRegistry;
    if (!registry) {
      return c.json({ ok: false, error: "task registry unavailable" }, 503);
    }
    // 按会话过滤（前端带当前会话路径）；不带参数保持旧行为返回全部。
    const sessionPath = c.req.query("sessionPath") || null;
    const tasks = registry.listLLMTasks({
      includeTerminal: true,
      ...(sessionPath ? { sessionPath } : {}),
    });
    return c.json({ ok: true, tasks: buildForest(tasks) });
  });

  route.post("/tasks/:taskId", async (c) => {
    const registry = engine?.taskRegistry;
    if (!registry) {
      return c.json({ ok: false, error: "task registry unavailable" }, 503);
    }
    const taskId = c.req.param("taskId");
    const body = await safeJson(c);
    const action = body?.action;
    if (action !== "done" && action !== "abandon") {
      return c.json({ ok: false, error: "action must be done or abandon" }, 400);
    }
    try {
      const task = action === "done"
        ? registry.doneLLMTask(taskId, { eventSummary: "marked done from UI" })
        : registry.abandonLLMTask(taskId, { eventSummary: "abandoned from UI" });
      const [node] = buildForest([task]);
      return c.json({ ok: true, task: node });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || String(err) }, 409);
    }
  });

  return route;
}
