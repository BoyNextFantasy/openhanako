import { getToolSessionPath } from "../tools/tool-session.ts";
import {
  extractExitCode,
  firstText,
  jsonResult,
  mergeExecDetails,
  textResult,
} from "./schema.ts";

function truncateText(text: string, maxOutputTokens: number) {
  const maxChars = Math.max(1000, Math.floor(maxOutputTokens * 4));
  if (String(text || "").length <= maxChars) return text;
  return String(text).slice(0, maxChars) + "\n\n[exec_command output truncated]";
}

function normalizeThrownToolError(err: any, maxOutputTokens: number) {
  const text = err?.message || String(err);
  return truncateText(text, maxOutputTokens);
}

export async function runExecCommandOnce({
  bashTool,
  toolCallId,
  command,
  timeout,
  signal,
  onUpdate,
  ctx,
  execDetails,
  maxOutputTokens,
}: any) {
  try {
    const params: any = { command };
    if (timeout) params.timeout = timeout;
    const result = await bashTool.execute(toolCallId, params, signal, onUpdate, ctx);
    const text = firstText(result);
    const exitCode = extractExitCode(text) ?? 0;
    return mergeExecDetails(result, {
      ...execDetails,
      ok: exitCode === 0,
      exitCode,
      transportError: false,
    });
  } catch (err) {
    const output = normalizeThrownToolError(err, maxOutputTokens);
    const exitCode = extractExitCode(output);
    return textResult(output, {
      execCommand: {
        ...execDetails,
        ok: false,
        exitCode,
        transportError: false,
        errorCode: execDetails?.classification?.kind === "probe"
          ? "EXEC_COMMAND_DEPENDENCY_MISSING"
          : "EXEC_COMMAND_EXIT_NONZERO",
      },
    });
  }
}

export async function startExecCommandTty({
  manager,
  getAgentId,
  getCwd,
  command,
  workdir,
  label,
  ctx,
  execDetails,
  cols = 80,
  rows = 24,
}: any) {
  const sessionPath = getToolSessionPath(ctx);
  if (!sessionPath) {
    return textResult("current session is required to start an interactive command", {
      errorCode: "EXEC_COMMAND_SESSION_REQUIRED",
      execCommand: execDetails,
    });
  }
  if (!manager) {
    return textResult("terminal manager unavailable", {
      errorCode: "EXEC_COMMAND_TERMINAL_MANAGER_UNAVAILABLE",
      execCommand: execDetails,
    });
  }
  const result = await manager.start({
    sessionPath,
    agentId: getAgentId?.() || "",
    cwd: workdir || ctx?.sessionManager?.getCwd?.() || getCwd?.() || process.cwd(),
    command,
    label: label || "exec_command",
    cols,
    rows,
  });
  return jsonResult({
    ...result,
    processId: result.terminalId,
    process_id: result.terminalId,
    execCommand: {
      ...execDetails,
      ok: true,
      processId: result.terminalId,
      terminalId: result.terminalId,
      transportError: false,
    },
  });
}
