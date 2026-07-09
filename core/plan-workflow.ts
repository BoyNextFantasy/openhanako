export type PlanWorkflowStep = {
  index: number;
  title: string;
  details: string;
  files: string[];
  acceptance: string;
};

export type PlanArtifact = {
  kind: "plan_artifact";
  version: 2;
  status: "awaiting_user_confirmation";
  goal: string;
  scope: string[];
  outOfScope: string[];
  steps: PlanWorkflowStep[];
  risks: string[];
  testPlan: string[];
  confirmationPoints: string[];
};

type TaskRegistryLike = {
  createLLMTask(summary: string, options?: { parentTaskId?: string | null; owner?: string | null }): { taskId: string };
};

function text(value: unknown, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`Plan artifact requires ${label}.`);
  return normalized;
}

function textList(value: unknown, label: string): string[] {
  const values = Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
    : [];
  if (values.length === 0) throw new Error(`Plan artifact requires non-empty ${label}.`);
  return values;
}

function optionalTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function normalizeStep(raw: any, index: number): PlanWorkflowStep {
  return {
    index,
    title: text(raw?.title, `steps[${index - 1}].title`),
    details: text(raw?.details, `steps[${index - 1}].details`),
    files: optionalTextList(raw?.files),
    acceptance: text(raw?.acceptance, `steps[${index - 1}].acceptance`),
  };
}

export function normalizePlanArtifact(raw: any): PlanArtifact {
  const rawSteps = Array.isArray(raw?.steps) ? raw.steps : [];
  if (rawSteps.length === 0) throw new Error("Plan artifact requires non-empty steps.");
  return {
    kind: "plan_artifact",
    version: 2,
    status: "awaiting_user_confirmation",
    goal: text(raw?.goal, "goal"),
    scope: textList(raw?.scope, "scope"),
    outOfScope: textList(raw?.outOfScope ?? raw?.out_of_scope, "outOfScope"),
    steps: rawSteps.map((step, idx) => normalizeStep(step, idx + 1)),
    risks: textList(raw?.risks, "risks"),
    testPlan: textList(raw?.testPlan ?? raw?.test_plan, "testPlan"),
    confirmationPoints: textList(raw?.confirmationPoints ?? raw?.confirmation_points, "confirmationPoints"),
  };
}

export function renderPlanArtifact(plan: PlanArtifact): string {
  const lines = [
    "# Plan Artifact v2",
    "",
    `Status: ${plan.status}`,
    `Goal: ${plan.goal}`,
    "",
    "## Scope",
    ...plan.scope.map((item) => `- ${item}`),
    "",
    "## Out of Scope",
    ...plan.outOfScope.map((item) => `- ${item}`),
    "",
    "## Steps",
  ];
  for (const step of plan.steps) {
    lines.push(`${step.index}. ${step.title}`);
    lines.push(`   Details: ${step.details}`);
    if (step.files.length > 0) lines.push(`   Files: ${step.files.join(", ")}`);
    lines.push(`   Acceptance: ${step.acceptance}`);
  }
  lines.push(
    "",
    "## Risks",
    ...plan.risks.map((item) => `- ${item}`),
    "",
    "## Test Plan",
    ...plan.testPlan.map((item) => `- ${item}`),
    "",
    "## Confirmation Points",
    ...plan.confirmationPoints.map((item) => `- ${item}`),
    "",
    "Execution handoff: wait for explicit user confirmation or switch to operate mode before changing files, running side-effect commands, or dispatching subagents.",
  );
  return lines.join("\n");
}

export function bindPlanToTaskTree(plan: PlanArtifact, registry: TaskRegistryLike) {
  const parent = registry.createLLMTask(`Plan: ${plan.goal}`);
  const stepTaskIds = plan.steps.map((step) => {
    const task = registry.createLLMTask(`Step ${step.index}: ${step.title}`, { parentTaskId: parent.taskId });
    return task.taskId;
  });
  return {
    parentTaskId: parent.taskId,
    stepTaskIds,
    status: plan.status,
  };
}
