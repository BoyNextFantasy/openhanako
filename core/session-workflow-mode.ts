import { SESSION_PERMISSION_MODES, normalizeSessionPermissionMode } from "./session-permission-mode.ts";

export const SESSION_WORKFLOW_MODES = {
  NORMAL: "normal",
  COMPOSE: "compose",
} as const;

export type SessionWorkflowMode = typeof SESSION_WORKFLOW_MODES[keyof typeof SESSION_WORKFLOW_MODES];

export const DEFAULT_SESSION_WORKFLOW_MODE: SessionWorkflowMode = SESSION_WORKFLOW_MODES.NORMAL;

export function normalizeSessionWorkflowMode(value: unknown): SessionWorkflowMode {
  const raw = typeof value === "string"
    ? value
    : (value && typeof value === "object" && typeof (value as any).workflowMode === "string"
      ? (value as any).workflowMode
      : null);
  return raw === SESSION_WORKFLOW_MODES.COMPOSE
    ? SESSION_WORKFLOW_MODES.COMPOSE
    : SESSION_WORKFLOW_MODES.NORMAL;
}

export function isComposeWorkflowMode(value: unknown): boolean {
  return normalizeSessionWorkflowMode(value) === SESSION_WORKFLOW_MODES.COMPOSE;
}

export function effectiveSessionWorkflowMode(workflowMode: unknown, permissionMode: unknown): SessionWorkflowMode {
  const normalized = normalizeSessionWorkflowMode(workflowMode);
  const permission = normalizeSessionPermissionMode(permissionMode);
  if (permission === SESSION_PERMISSION_MODES.PLAN) return SESSION_WORKFLOW_MODES.NORMAL;
  return normalized;
}
