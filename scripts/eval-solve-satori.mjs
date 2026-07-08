#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HanaCliClient } from "../cli/client.ts";
import { resolveConnection } from "../cli/local-server.ts";
import { startLocalServerAndWait } from "../cli/server-runner.ts";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");

export function parseSolveArgs(argv = process.argv.slice(2)) {
  const args = {
    workspace: "",
    promptFile: "",
    timeoutMs: 30 * 60 * 1000,
    serverTimeoutMs: 120 * 1000,
    permissionMode: "operate",
    memoryEnabled: false,
    url: "",
    token: "",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--workspace") args.workspace = requireValue(argv, ++i, arg);
    else if (arg === "--prompt-file") args.promptFile = requireValue(argv, ++i, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = parsePositiveInt(requireValue(argv, ++i, arg), arg);
    else if (arg === "--server-timeout-ms") args.serverTimeoutMs = parsePositiveInt(requireValue(argv, ++i, arg), arg);
    else if (arg === "--permission-mode") args.permissionMode = requireValue(argv, ++i, arg);
    else if (arg === "--memory") args.memoryEnabled = true;
    else if (arg === "--url") args.url = requireValue(argv, ++i, arg);
    else if (arg === "--token") args.token = requireValue(argv, ++i, arg);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function parsePositiveInt(value, flag) {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`${flag} requires a positive integer`);
  return Number(value);
}

export function helpText() {
  return [
    "Usage: npm run eval:solve -- --workspace <dir> --prompt-file <file>",
    "",
    "Runs one non-interactive Satori solve turn for an eval task.",
    "",
    "Options:",
    "  --workspace <dir>          Task workspace to edit",
    "  --prompt-file <file>       Benchmark prompt/instructions file",
    "  --timeout-ms <n>           Turn timeout (default: 1800000)",
    "  --server-timeout-ms <n>    Server startup timeout (default: 120000)",
    "  --permission-mode <mode>   Session permission mode (default: operate)",
    "  --memory                   Enable session memory (default: off)",
    "  --url <url>                Existing HanaAgent Server URL",
    "  --token <token>            Bearer token for --url",
    "  --dry-run                  Print the prompt that would be submitted",
  ].join("\n");
}

export async function buildSolvePrompt({ workspace, promptFile }) {
  const prompt = await fs.readFile(promptFile, "utf8");
  return [
    "你正在参加公开 coding benchmark。请在当前 workspace 中完成题目。",
    "",
    `Workspace: ${workspace}`,
    `Prompt file: ${promptFile}`,
    "",
    "要求：",
    "- 读取题目和代码后，直接修改实现文件。",
    "- 不要修改测试文件，除非题目明确要求。",
    "- 可以运行测试命令定位问题。",
    "- 不要向用户反问；在当前回合内尽最大努力完成。",
    "- 完成后用很短的中文总结你改了什么。",
    "",
    "题面如下：",
    "",
    prompt,
  ].join("\n");
}

export async function solveWithSatori(options) {
  const workspace = path.resolve(options.workspace);
  const promptFile = path.resolve(options.promptFile);
  const prompt = await buildSolvePrompt({ workspace, promptFile });

  if (options.dryRun) {
    return { dryRun: true, workspace, promptFile, prompt };
  }

  let connection = resolveConnection({ url: options.url || undefined, token: options.token || undefined });
  if (!connection.ok) {
    connection = await startLocalServerAndWait({
      projectRoot: PROJECT_ROOT,
      timeoutMs: options.serverTimeoutMs || 120000,
    });
  }
  if (!connection.ok) throw new Error(connection.message || "HanaAgent Server unavailable");

  const client = new HanaCliClient(connection);
  const session = await client.request("/api/sessions/new-detached", {
    method: "POST",
    body: {
      cwd: workspace,
      memoryEnabled: options.memoryEnabled === true,
      permissionMode: options.permissionMode || "operate",
    },
  });
  if (!session?.path) throw new Error("Failed to create eval session");

  const ws = client.createWebSocket();
  const result = await submitPromptAndWait(ws, {
    sessionPath: session.path,
    text: prompt,
    timeoutMs: options.timeoutMs,
  });

  return {
    sessionPath: session.path,
    workspace,
    promptFile,
    ...result,
  };
}

function submitPromptAndWait(ws, { sessionPath, text, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;
    let sawStreamingStart = false;
    const timer = setTimeout(() => finish(new Error(`Satori eval solve timed out after ${timeoutMs}ms`)), timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      try { ws.close(); } catch {}
    }

    function finish(err, result = null) {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(result);
    }

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "prompt", text, sessionPath }));
    });
    ws.on("message", (data) => {
      const msg = safeParse(data.toString());
      if (!msg) return;
      if (msg.sessionPath && msg.sessionPath !== sessionPath) return;
      if (msg.type === "text_delta") output += msg.delta || "";
      else if (msg.type === "status" && msg.isStreaming === true) sawStreamingStart = true;
      else if (msg.type === "status" && msg.isStreaming === false && sawStreamingStart) {
        finish(null, { text: output.trim() || null });
      }
      else if (msg.type === "error") finish(new Error(msg.message || "Satori eval solve failed"));
    });
    ws.on("error", (err) => finish(err));
    ws.on("close", () => {
      if (!settled) finish(new Error("Satori eval solve websocket closed before turn_end"));
    });
  });
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function main() {
  try {
    const args = parseSolveArgs();
    if (args.help) {
      console.log(helpText());
      return 0;
    }
    if (!args.workspace) throw new Error("--workspace is required");
    if (!args.promptFile) throw new Error("--prompt-file is required");
    const result = await solveWithSatori(args);
    if (result.dryRun) {
      console.log(result.prompt);
    } else {
      console.log(JSON.stringify({
        sessionPath: result.sessionPath,
        text: result.text,
      }, null, 2));
    }
    return 0;
  } catch (err) {
    console.error(err?.stack || err?.message || String(err));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const code = await main();
  process.exit(code);
}
