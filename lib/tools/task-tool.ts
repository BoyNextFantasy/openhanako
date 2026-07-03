/**
 * task-tool.ts — LLM 可见的持久化树形任务工具
 *
 * 对标 MiMoCode 的 task tool（open → in_progress → blocked → done/abandoned）。
 * 操作包装在 `operation` 对象中，使用 discriminated union。
 */

import { Type, StringEnum } from "../pi-sdk/index.ts";

const TASK_STATUSES = ["open", "in_progress", "blocked", "done", "abandoned"];

const createOp = Type.Object({
  action: Type.Literal("create"),
  summary: Type.String({ minLength: 1, description: "Task summary for a single task." }),
  parent_id: Type.Optional(Type.String({ description: "Parent task id for sub-tasks." })),
});

const listOp = Type.Object({
  action: Type.Literal("list"),
  status: Type.Optional(StringEnum(TASK_STATUSES, { description: "Filter by status." })),
  include_terminal: Type.Optional(Type.Boolean({ description: "Include done/abandoned tasks. Default false." })),
  parent_id: Type.Optional(Type.String({ description: "Filter by parent task id. Use null string for top-level only." })),
});

const getOp = Type.Object({
  action: Type.Literal("get"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
});

const startOp = Type.Object({
  action: Type.Literal("start"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  event_summary: Type.Optional(Type.String({ description: "Short note on starting." })),
});

const blockOp = Type.Object({
  action: Type.Literal("block"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  event_summary: Type.Optional(Type.String({ description: "Short reason for blocking." })),
});

const unblockOp = Type.Object({
  action: Type.Literal("unblock"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  event_summary: Type.Optional(Type.String({ description: "Short reason for unblocking." })),
});

const doneOp = Type.Object({
  action: Type.Literal("done"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  event_summary: Type.Optional(Type.String({ description: "Short summary of what was completed." })),
});

const abandonOp = Type.Object({
  action: Type.Literal("abandon"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  event_summary: Type.Optional(Type.String({ description: "Short reason for abandoning." })),
});

const renameOp = Type.Object({
  action: Type.Literal("rename"),
  id: Type.String({ minLength: 1, description: "Task id, e.g. T1 or T1.1." }),
  summary: Type.String({ minLength: 1, description: "New task summary." }),
});

const TASK_DESCRIPTION = [
  "Persistent work-item tool. Tasks are bounded, referenceable entities with",
  "IDs (T1, T2, ...; subtasks T1.1, T1.2, ...). This is the only work-item",
  "tool — use it to track every multi-step piece of work: what you're doing",
  "now, what's queued, what's blocked, what's done.",
  "",
  "JSON calls always wrap the action in an `operation` object — see examples below.",
  "",
  "## Operations",
  "",
  "- create:     register a new task. `summary` required. optional: `parent_id`.",
  "- list:       enumerate tasks. defaults to open+in_progress+blocked, excluding terminal.",
  "              optional: `status` filter, `include_terminal`, `parent_id`.",
  "- get:        fetch one task by id.",
  "- start:      mark a task in_progress (you're working on it now). `id` required.",
  "- block:      transition → blocked. `id` required. optional: `event_summary`.",
  "- unblock:    transition blocked → open. `id` required. optional: `event_summary`.",
  "- done:       mark task complete. `id` required. optional: `event_summary`.",
  "- abandon:    drop task without completing. `id` required. optional: `event_summary`.",
  "- rename:     change a task's summary. `id` + `summary` required.",
  "",
  "Status lifecycle: open ⇄ in_progress, either → blocked → open, either → done | abandoned.",
  "Mark a task `start` before working it; `done` immediately after finishing.",
  "",
  "## JSON examples",
  "",
  '{"operation":{"action":"create","summary":"Implement auth"}}',
  '{"operation":{"action":"create","summary":"Lexer","parent_id":"T1"}}',
  '{"operation":{"action":"list"}}',
  '{"operation":{"action":"get","id":"T1"}}',
  '{"operation":{"action":"start","id":"T1"}}',
  '{"operation":{"action":"block","id":"T1","event_summary":"waiting on spec"}}',
  '{"operation":{"action":"unblock","id":"T1","event_summary":"spec resolved"}}',
  '{"operation":{"action":"done","id":"T1","event_summary":"all tests pass"}}',
  '{"operation":{"action":"abandon","id":"T1","event_summary":"out of scope"}}',
  '{"operation":{"action":"rename","id":"T1","summary":"Updated title"}}',
  "",
  "## Discipline",
  "",
  "- Only mark `done` when the work is FULLY accomplished. If tests fail, the",
  "  implementation is partial, or you hit an unresolved error, keep it",
  "  in_progress or `block` it — never `done`.",
  "- If blocked, `block` the task or create a new task describing the blocker.",
  "- Keep one task in_progress at a time when working solo (not enforced —",
  "  parallel subagents may each have their own in_progress task).",
  "",
  "## When to use",
  "",
  "Use task whenever work has 3+ steps, spans multiple turns, will be referenced",
  "again (by you, the user, or a subagent), or needs to be visible in the session.",
  "Skip it for a single trivial action.",
].join("\n");

export function createTaskTool(deps) {
  return {
    name: "task",
    label: "Task",
    description: TASK_DESCRIPTION,
    parameters: Type.Object({
      operation: Type.Union([
        createOp,
        listOp,
        getOp,
        startOp,
        blockOp,
        unblockOp,
        doneOp,
        abandonOp,
        renameOp,
      ]),
    }),

    execute: async (_toolCallId, params) => {
      const registry = deps.getTaskRegistry?.();
      if (!registry) {
        return { content: [{ type: "text", text: "Task registry unavailable" }] };
      }

      const op = params.operation;

      if (op.action === "create") {
        const parentId = op.parent_id?.trim() || null;
        const t = registry.createLLMTask(op.summary, { parentTaskId: parentId });
        return { content: [{ type: "text", text: `Created ${t.taskId} (${t.status}): ${t._llmSummary}` }] };
      }

      if (op.action === "list") {
        const tasks = registry.listLLMTasks({
          status: op.status,
          includeTerminal: op.include_terminal,
          parentTaskId: op.parent_id !== undefined ? (op.parent_id?.trim() || null) : undefined,
        });
        if (tasks.length === 0) return { content: [{ type: "text", text: "No tasks." }] };
        const lines = tasks.map((t) => {
          const indent = t._llmParentTaskId ? "  " : "";
          return `${indent}${t.taskId} ${t.status} — ${t._llmSummary}`;
        });
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (op.action === "get") {
        const t = registry.getLLMTask(op.id);
        if (!t) return { content: [{ type: "text", text: `Task ${op.id}: not found. Use \`task list\` to see valid task IDs.` }] };
        return { content: [{ type: "text", text: JSON.stringify({ id: t.taskId, status: t.status, summary: t._llmSummary, parent_task_id: t._llmParentTaskId, owner: t._llmOwner, last_event: t._llmLastEventSummary ? `${t._llmLastEventKind}: ${t._llmLastEventSummary}` : t._llmLastEventKind, created_at: t.createdAt }, null, 2) }] };
      }

      if (op.action === "start") {
        const t = registry.startLLMTask(op.id);
        return { content: [{ type: "text", text: `start → ${t.status} (${t._llmSummary})` }] };
      }

      if (op.action === "block") {
        const t = registry.blockLLMTask(op.id);
        return { content: [{ type: "text", text: `block → ${t.status}` }] };
      }

      if (op.action === "unblock") {
        const t = registry.unblockLLMTask(op.id);
        return { content: [{ type: "text", text: `unblock → ${t.status}` }] };
      }

      if (op.action === "done") {
        const t = registry.doneLLMTask(op.id);
        return { content: [{ type: "text", text: `done → ${t.status} (${t._llmSummary})` }] };
      }

      if (op.action === "abandon") {
        const t = registry.abandonLLMTask(op.id);
        return { content: [{ type: "text", text: `abandon → ${t.status}` }] };
      }

      if (op.action === "rename") {
        const t = registry.renameLLMTask(op.id, op.summary);
        return { content: [{ type: "text", text: `rename → "${t._llmSummary}"` }] };
      }

      return { content: [{ type: "text", text: `Unknown operation: ${op.action}` }] };
    },
  };
}
