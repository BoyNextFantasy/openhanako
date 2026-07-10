import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_WORKFLOW_MODE,
  SESSION_WORKFLOW_MODES,
  effectiveSessionWorkflowMode,
  isComposeWorkflowMode,
  normalizeSessionWorkflowMode,
} from "../core/session-workflow-mode.ts";

describe("session workflow mode", () => {
  it("normalizes only normal and compose", () => {
    expect(DEFAULT_SESSION_WORKFLOW_MODE).toBe("normal");
    expect(SESSION_WORKFLOW_MODES.NORMAL).toBe("normal");
    expect(SESSION_WORKFLOW_MODES.COMPOSE).toBe("compose");
    expect(normalizeSessionWorkflowMode("normal")).toBe("normal");
    expect(normalizeSessionWorkflowMode("compose")).toBe("compose");
    expect(normalizeSessionWorkflowMode({ workflowMode: "compose" })).toBe("compose");
    expect(normalizeSessionWorkflowMode({ workflowMode: "plan" })).toBe("normal");
    expect(normalizeSessionWorkflowMode(null)).toBe("normal");
  });

  it("treats plan permission mode as effective normal", () => {
    expect(isComposeWorkflowMode("compose")).toBe(true);
    expect(effectiveSessionWorkflowMode("compose", "auto")).toBe("compose");
    expect(effectiveSessionWorkflowMode("compose", "plan")).toBe("normal");
  });
});
