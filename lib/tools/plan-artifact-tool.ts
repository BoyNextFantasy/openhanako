/**
 * plan-artifact-tool.ts — Plan 模式的计划提交工具（非阻塞）
 *
 * plan_submit 提交 Plan Artifact v2 后立即返回（不阻塞轮次）：
 *   1. normalizePlanArtifact 严格校验
 *   2. 引擎记录状态机（pending → confirmed | cancelled | superseded）
 *   3. 广播 plan_artifact 事件，前端在聊天流内渲染计划卡
 * 用户确认后：服务端绑定任务树 + plan 模式代切完整权限 + 注入开工指令（kickOffPlanExecution），
 * 模型会以一条新的用户消息形式收到「开始执行」指令，届时再动手。
 *
 * sessionPath 取自 Pi SDK ctx（per-turn，tool-session.ts 契约），不读焦点指针——
 * 焦点指针会被 abort/断连清空（历史 bug：requires an active session）。
 */

import { Type } from "../pi-sdk/index.ts";
import { getToolSessionPath } from "./tool-session.ts";

const PLAN_SUBMIT_DESCRIPTION = [
  "Submit the structured plan (Plan Artifact v2) for user confirmation in plan mode.",
  "",
  "Call this ONCE after you finish reading code and clarifying requirements.",
  "The call returns immediately after the plan card is shown to the user.",
  "When the user confirms the card, you will receive a follow-up user message",
  "telling you to start executing — only then may you begin (permission mode is",
  "switched automatically; do NOT create the task tree yourself with the task tool).",
  "The user may instead dismiss the card or type new instructions; treat their",
  "latest input as the source of truth and resubmit the plan if still needed.",
  "",
  "Required fields:",
  "- goal: one-sentence objective",
  "- scope: what this plan covers",
  "- outOfScope: what is explicitly excluded",
  "- steps: ordered steps, each with title / details / acceptance (files optional)",
  "- risks: what could go wrong",
  "- testPlan: how the result will be verified",
  "- confirmationPoints: decisions the user should sign off on",
].join("\n");

export function createPlanArtifactTool(deps: any) {
  return {
    name: "plan_submit",
    label: "Plan Submit",
    description: PLAN_SUBMIT_DESCRIPTION,
    parameters: Type.Object({
      goal: Type.String({ minLength: 1, description: "One-sentence objective of the plan." }),
      scope: Type.Array(Type.String(), { description: "In-scope items (files, modules, behaviors)." }),
      outOfScope: Type.Array(Type.String(), { description: "Explicitly excluded items." }),
      steps: Type.Array(
        Type.Object({
          title: Type.String({ description: "Short step title." }),
          details: Type.String({ description: "What this step does concretely." }),
          files: Type.Optional(Type.Array(Type.String(), { description: "Files this step touches." })),
          acceptance: Type.String({ description: "How to verify this step is done." }),
        }),
        { description: "Ordered execution steps." },
      ),
      risks: Type.Array(Type.String(), { description: "Risks and mitigations." }),
      testPlan: Type.Array(Type.String(), { description: "Verification steps." }),
      confirmationPoints: Type.Array(Type.String(), { description: "Decisions the user must sign off." }),
    }),

    execute: async (_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) => {
      // per-turn 会话路径：优先 ctx（正在执行的本轮会话），焦点指针只作兜底
      const sessionPath = getToolSessionPath(ctx) || deps.getSessionPath?.() || null;
      if (!sessionPath) {
        return { content: [{ type: "text", text: "plan_submit requires an active session." }] };
      }

      let artifact: any;
      try {
        artifact = deps.normalizePlanArtifact(params);
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: `Plan artifact rejected: ${err?.message || err}. Fix the fields and call plan_submit again.`,
          }],
        };
      }

      deps.setPlanArtifact?.(sessionPath, artifact, { toolCallId: _toolCallId });
      deps.emitEvent?.({ type: "plan_artifact", artifact, toolCallId: _toolCallId }, sessionPath);
      return {
        content: [{
          type: "text",
          text: "计划卡已提交并展示给用户。等待用户在卡上确认或给出修改意见；用户确认后你会收到「开始执行」的用户指令，届时权限已自动切换为完整权限，请立即从步骤 1 开始执行。在此之前不要动手。",
        }],
        details: { outcome: "pending" },
      };
    },
  };
}
