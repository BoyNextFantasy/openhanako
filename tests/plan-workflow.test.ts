import { describe, expect, it } from "vitest";
import { TaskRegistry } from "../lib/task-registry.ts";
import {
  bindPlanToTaskTree,
  normalizePlanArtifact,
  renderPlanArtifact,
} from "../core/plan-workflow.ts";

const validPlan = {
  goal: "Upgrade plan mode into a structured workflow",
  scope: ["Plan artifact", "Task tree binding"],
  outOfScope: ["Desktop UI redesign"],
  steps: [
    {
      title: "Read current plan-mode implementation",
      details: "Inspect permission classification and prompt injection.",
      files: ["core/session-permission-mode.ts", "core/agent.ts"],
      acceptance: "Current behavior is documented before changing it.",
    },
    {
      title: "Add structured plan artifact helper",
      details: "Validate required fields and render a stable handoff.",
      files: ["core/plan-workflow.ts"],
      acceptance: "Invalid plans fail early with actionable errors.",
    },
  ],
  risks: ["Read-only command detection may be too broad"],
  testPlan: ["npx vitest run tests/plan-workflow.test.ts"],
  confirmationPoints: ["User confirms before leaving plan mode"],
};

describe("plan workflow artifact", () => {
  it("normalizes a complete structured plan", () => {
    const plan = normalizePlanArtifact(validPlan);

    expect(plan).toMatchObject({
      kind: "plan_artifact",
      version: 2,
      status: "awaiting_user_confirmation",
      goal: validPlan.goal,
    });
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]).toMatchObject({ index: 1, title: validPlan.steps[0].title });
  });

  it("rejects missing required sections", () => {
    expect(() => normalizePlanArtifact({ ...validPlan, risks: [] }))
      .toThrow(/risks/i);
    expect(() => normalizePlanArtifact({ ...validPlan, steps: [] }))
      .toThrow(/steps/i);
  });

  it("renders an execution handoff that requires user confirmation", () => {
    const text = renderPlanArtifact(normalizePlanArtifact(validPlan));

    expect(text).toContain("Plan Artifact v2");
    expect(text).toContain(validPlan.goal);
    expect(text).toContain("awaiting_user_confirmation");
    expect(text).toMatch(/switch.*operate|confirm/i);
  });

  it("binds plan steps into the task tree without starting execution", () => {
    const registry = new TaskRegistry();
    const result = bindPlanToTaskTree(normalizePlanArtifact(validPlan), registry);

    expect(result.parentTaskId).toBe("T1");
    expect(result.stepTaskIds).toEqual(["T1.1", "T1.2"]);

    const parent = registry.getLLMTask("T1");
    const firstStep = registry.getLLMTask("T1.1");
    expect(parent).toMatchObject({ status: "open", _llmSummary: `Plan: ${validPlan.goal}` });
    expect(firstStep).toMatchObject({ status: "open", _llmParentTaskId: "T1" });
    expect(firstStep?._llmSummary).toContain(validPlan.steps[0].title);
  });
});
