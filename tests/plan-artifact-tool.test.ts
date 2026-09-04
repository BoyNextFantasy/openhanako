import { describe, expect, it, vi } from "vitest";

import { createPlanArtifactTool } from "../lib/tools/plan-artifact-tool.ts";
import { normalizePlanArtifact } from "../core/plan-workflow.ts";

const VALID_PLAN = {
  goal: "为搜索页添加防抖",
  scope: ["web/search.ts"],
  outOfScope: ["服务端接口"],
  steps: [
    { title: "实现防抖 hook", details: "300ms 防抖", files: ["web/search.ts"], acceptance: "快速输入只触发一次请求" },
  ],
  risks: ["防抖可能吞掉最后一次输入"],
  testPlan: ["vitest run tests/search.test.ts"],
  confirmationPoints: ["防抖时长 300ms 是否可接受"],
};

const TURN_SESSION = "/sessions/turn.jsonl";

/** 模拟正在执行 turn 的会话（Pi SDK 第 5 参 ctx） */
const turnCtx = {
  sessionManager: { getSessionFile: () => TURN_SESSION },
  emitEvent: (event: any, sp?: string) => sp,
};

function makeDeps(overrides: Record<string, any> = {}) {
  const calls = {
    stored: [] as Array<{ sessionPath: string; artifact: any; meta: any }>,
    events: [] as Array<{ event: any; sessionPath: string }>,
  };
  const deps = {
    getSessionPath: () => null,
    normalizePlanArtifact,
    setPlanArtifact: (sessionPath: string, artifact: any, meta: any) => calls.stored.push({ sessionPath, artifact, meta }),
    emitEvent: (event: any, sessionPath: string) => calls.events.push({ event, sessionPath }),
    ...overrides,
  };
  return { deps, calls };
}

describe("plan_submit tool (non-blocking)", () => {
  it("uses the per-turn ctx sessionPath, returns immediately, and stores the pending plan", async () => {
    const { deps, calls } = makeDeps();
    const tool = createPlanArtifactTool(deps);

    expect(tool.name).toBe("plan_submit");
    const result = await tool.execute("call-1", VALID_PLAN, undefined, undefined, turnCtx);

    expect(result.content[0].text).toContain("计划卡已提交");
    expect(result.details).toMatchObject({ outcome: "pending" });
    expect(calls.stored).toHaveLength(1);
    expect(calls.stored[0]).toMatchObject({ sessionPath: TURN_SESSION, meta: { toolCallId: "call-1" } });
    expect(calls.events).toHaveLength(1);
    expect(calls.events[0].event).toMatchObject({ type: "plan_artifact", toolCallId: "call-1" });
    expect(calls.events[0].sessionPath).toBe(TURN_SESSION);
  });

  it("falls back to deps.getSessionPath when ctx has no session manager", async () => {
    const { deps, calls } = makeDeps({ getSessionPath: () => "/sessions/fallback.jsonl" });
    const tool = createPlanArtifactTool(deps);

    await tool.execute("call-2", VALID_PLAN, undefined, undefined, {});
    expect(calls.stored[0].sessionPath).toBe("/sessions/fallback.jsonl");
  });

  it("rejects invalid plan fields without storing or emitting", async () => {
    const { deps, calls } = makeDeps();
    const tool = createPlanArtifactTool(deps);

    const result = await tool.execute("call-3", { ...VALID_PLAN, steps: [] }, undefined, undefined, turnCtx);

    expect(result.content[0].text).toContain("Plan artifact rejected");
    expect(calls.stored).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });

  it("requires a session: ctx missing and focus pointer empty", async () => {
    const { deps, calls } = makeDeps();
    const tool = createPlanArtifactTool(deps);

    const result = await tool.execute("call-4", VALID_PLAN, undefined, undefined, {});
    expect(result.content[0].text).toContain("requires an active session");
    expect(calls.stored).toHaveLength(0);
    expect(calls.events).toHaveLength(0);
  });
});
