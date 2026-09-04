import { describe, expect, it, vi } from "vitest";

import { HanaEngine as Engine } from "../core/engine.ts";

/**
 * 计划卡引擎级测试（非阻塞 + 状态机语义）：
 * setPlanArtifact（pending + 覆盖作废）→ confirm/dismiss/resolvePlanReview
 * → plan_review_update 事件 → 会话运行时清理。
 */

function makeEngine() {
  const events: Array<{ event: any; sessionPath: string }> = [];
  const engine = Object.create(Engine.prototype) as any;
  engine._planArtifacts = new Map();
  let taskCounter = 0;
  engine._taskRegistry = {
    createLLMTask(summary: string, options?: any) {
      taskCounter += 1;
      const id = taskCounter === 1 ? "T1" : `T1.${taskCounter - 1}`;
      return { taskId: id, status: "open", _llmSummary: summary, _llmParentTaskId: options?.parentTaskId ?? null };
    },
    getLLMTask: (id: string) => ({ taskId: id, status: "open" }),
  };
  engine._deleteSessionRuntimeMapEntry = () => {};
  engine._deleteSessionRuntimeSetEntry = () => {};
  engine._emitEvent = (event: any, sessionPath: string) => events.push({ event, sessionPath });
  return { engine, events };
}

const ARTIFACT = {
  goal: "g", scope: ["s"], outOfScope: ["o"],
  steps: [{ title: "a", details: "d", acceptance: "ac" }, { title: "b", details: "d", acceptance: "ac" }],
  risks: ["r"], testPlan: ["t"], confirmationPoints: ["c"],
};

describe("engine plan review state", () => {
  it("pending entry tracks toolCallId and is visible via getPlanReviewEntry", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    expect(engine.getPlanReviewEntry("/sessions/a")).toMatchObject({
      artifact: { goal: "g" },
      toolCallId: "call-1",
    });
    // 提交本身不产生 plan_review_update（前端靠 plan_artifact 事件置 pending）
    expect(events).toHaveLength(0);
  });

  it("confirm without a pending plan returns ok:false", () => {
    const { engine } = makeEngine();
    expect(engine.confirmPlanArtifact("/sessions/a").ok).toBe(false);
  });

  it("confirm binds the task tree, sets confirmed, and emits plan_review_update", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    const result = engine.confirmPlanArtifact("/sessions/a");
    expect(result).toMatchObject({ ok: true, alreadyBound: false, parentTaskId: "T1", stepTaskIds: ["T1.1", "T1.2"] });
    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: "plan_review_update", toolCallId: "call-1", status: "confirmed" });

    // 已确认后不再是 pending
    expect(engine.getPlanReviewEntry("/sessions/a")).toBeNull();
  });

  it("repeated confirms are idempotent (alreadyBound, no duplicate events)", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });
    const first = engine.confirmPlanArtifact("/sessions/a");
    const second = engine.confirmPlanArtifact("/sessions/a");

    expect(second).toMatchObject({ ok: true, alreadyBound: true, parentTaskId: "T1" });
    expect(events).toHaveLength(1);
    expect(first.stepTaskIds).toEqual(second.stepTaskIds);
  });

  it("resubmitting supersedes the previous pending card via plan_review_update", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    engine.setPlanArtifact("/sessions/a", { ...ARTIFACT, goal: "revised" }, { toolCallId: "call-2" });

    expect(events).toHaveLength(1);
    expect(events[0].event).toMatchObject({ type: "plan_review_update", toolCallId: "call-1", status: "superseded" });
    expect(engine.getPlanReviewEntry("/sessions/a")).toMatchObject({ artifact: { goal: "revised" }, toolCallId: "call-2" });
  });

  it("confirm is rejected after the plan was superseded or cancelled", () => {
    const { engine } = makeEngine();

    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });
    engine.resolvePlanReview("/sessions/a", "superseded");
    expect(engine.confirmPlanArtifact("/sessions/a")).toMatchObject({ ok: false });

    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-2" });
    engine.dismissPlanArtifact("/sessions/a");
    expect(engine.confirmPlanArtifact("/sessions/a")).toMatchObject({ ok: false });
  });

  it("dismiss only affects a pending plan and emits cancelled", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    expect(engine.dismissPlanArtifact("/sessions/a")).toMatchObject({ ok: true });
    expect(events[0].event).toMatchObject({ type: "plan_review_update", toolCallId: "call-1", status: "cancelled" });

    // 非 pending：无可关闭项
    expect(engine.dismissPlanArtifact("/sessions/a").ok).toBe(false);
    expect(engine.dismissPlanArtifact("/sessions/b").ok).toBe(false);
  });

  it("resolvePlanReview only supports superseded and only on pending plans", () => {
    const { engine, events } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    expect(engine.resolvePlanReview("/sessions/a", "rejected")).toBe(false);
    expect(engine.resolvePlanReview("/sessions/a", "superseded")).toBe(true);
    expect(events).toHaveLength(1);
    expect(engine.resolvePlanReview("/sessions/a", "superseded")).toBe(false);
  });

  it("plan state is isolated per session and cleared with session runtime", () => {
    const { engine } = makeEngine();
    engine.setPlanArtifact("/sessions/a", ARTIFACT, { toolCallId: "call-1" });

    expect(engine.getPlanReviewEntry("/sessions/b")).toBeNull();
    engine.clearSessionRuntimeState("/sessions/a");
    expect(engine.getPlanReviewEntry("/sessions/a")).toBeNull();
  });
});
