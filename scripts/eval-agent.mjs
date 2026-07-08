#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");

export function parseEvalArgs(argv = process.argv.slice(2)) {
  const args = {
    suite: "eval/suites/local-smoke.json",
    agent: "oracle",
    output: "",
    limit: 0,
    dryRun: false,
    benchmarkRoot: "",
    agentCommand: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--suite") args.suite = requireValue(argv, ++i, arg);
    else if (arg === "--agent") args.agent = requireValue(argv, ++i, arg);
    else if (arg === "--output") args.output = requireValue(argv, ++i, arg);
    else if (arg === "--limit") args.limit = parseLimit(requireValue(argv, ++i, arg), arg);
    else if (arg === "--benchmark-root") args.benchmarkRoot = requireValue(argv, ++i, arg);
    else if (arg === "--agent-command") args.agentCommand = requireValue(argv, ++i, arg);
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

function parseLimit(value, flag) {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a non-negative integer`);
  return Number(value);
}

export function helpText() {
  return [
    "Usage: npm run eval:agent -- --suite <manifest.json> [options]",
    "",
    "Options:",
    "  --suite <path>             Suite manifest path (default: eval/suites/local-smoke.json)",
    "  --agent <oracle|noop|command>  Execution mode (default: oracle)",
    "  --agent-command <cmd>      Command template for --agent command",
    "  --benchmark-root <path>    External benchmark checkout path recorded in metadata",
    "  --output <dir>             Output directory (default: .cache/eval-agent/<timestamp>)",
    "  --limit <n>                Limit tasks",
    "  --dry-run                  Print tasks without executing",
  ].join("\n");
}

export async function loadSuite(suitePath, options = {}) {
  const resolved = path.resolve(PROJECT_ROOT, suitePath);
  const raw = await fsp.readFile(resolved, "utf8");
  const suite = JSON.parse(raw);
  if (!suite || typeof suite !== "object") throw new Error("Suite manifest must be an object");
  if (!Array.isArray(suite.tasks)) throw new Error("Suite manifest requires tasks[]");
  const baseDir = path.dirname(resolved);
  return {
    ...suite,
    manifestPath: resolved,
    baseDir,
    tasks: suite.tasks.map((task) => normalizeTask(task, baseDir, suite, options)),
  };
}

function normalizeTask(task, baseDir, suite, options = {}) {
  if (!task?.id) throw new Error("Task requires id");
  if (!task?.workspace) throw new Error(`Task ${task.id} requires workspace`);
  if (!task?.verifyCommand) throw new Error(`Task ${task.id} requires verifyCommand`);
  return {
    ...task,
    suite: task.suite || suite.suite,
    benchmark: task.benchmark || suite.benchmark || suite.suite,
    taskDir: resolveManifestPath(task.taskDir || ".", baseDir, options),
    workspace: resolveManifestPath(task.workspace, baseDir, options),
    promptFile: task.promptFile ? resolveManifestPath(task.promptFile, baseDir, options) : "",
  };
}

function resolveManifestPath(value, baseDir, options = {}) {
  const raw = String(value || "");
  const benchmarkRoot = options.benchmarkRoot ? path.resolve(options.benchmarkRoot) : "";
  if (raw.includes("{benchmarkRoot}")) {
    if (!benchmarkRoot) throw new Error(`Path uses {benchmarkRoot} but --benchmark-root was not provided: ${raw}`);
    return path.normalize(raw.replaceAll("{benchmarkRoot}", benchmarkRoot));
  }
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
}

export async function runSuite(options) {
  const suite = await loadSuite(options.suite, options);
  const tasks = options.limit > 0 ? suite.tasks.slice(0, options.limit) : suite.tasks;
  if (options.dryRun) {
    return {
      suite: suite.suite,
      dryRun: true,
      tasks: tasks.map((task) => ({
        id: task.id,
        benchmark: task.benchmark,
        verifyCommand: task.verifyCommand,
      })),
    };
  }

  const outputDir = resolveOutputDir(options.output || defaultOutputDir());
  await fsp.mkdir(outputDir, { recursive: true });
  const results = [];
  for (const task of tasks) {
    results.push(await runTask(task, { ...options, outputDir, suite }));
  }
  const summary = summarizeResults(results, {
    suite: suite.suite,
    agent: options.agent,
    benchmarkRoot: options.benchmarkRoot || null,
  });
  await writeReports(outputDir, results, summary);
  return { outputDir, results, summary };
}

function defaultOutputDir() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(".cache", "eval-agent", stamp);
}

function resolveOutputDir(output) {
  return path.isAbsolute(output) ? output : path.resolve(PROJECT_ROOT, output);
}

async function runTask(task, options) {
  const taskOutputDir = path.join(options.outputDir, safeName(task.id));
  const workspaceDir = path.join(taskOutputDir, "workspace");
  await fsp.rm(taskOutputDir, { recursive: true, force: true });
  await fsp.mkdir(taskOutputDir, { recursive: true });
  await fsp.cp(task.workspace, workspaceDir, { recursive: true });

  const setupResult = task.setupCommand
    ? await runCommand(interpolate(task.setupCommand, task, workspaceDir, options), {
      cwd: workspaceDir,
      timeoutMs: task.setupTimeoutMs || task.timeoutMs || 600000,
      env: buildTaskEnv(task, workspaceDir, options),
    })
    : { exitCode: 0, durationMs: 0 };
  const before = await snapshotWorkspace(workspaceDir);
  const start = performance.now();
  if (setupResult.exitCode !== 0) {
    const prompt = task.promptFile && fs.existsSync(task.promptFile)
      ? await fsp.readFile(task.promptFile, "utf8")
      : "";
    return {
      taskId: task.id,
      suite: task.suite,
      benchmark: task.benchmark,
      passed: false,
      durationMs: setupResult.durationMs,
      promptChars: prompt.length,
      setupCommand: task.setupCommand || null,
      verifyCommand: task.verifyCommand,
      setup: {
        exitCode: setupResult.exitCode,
        durationMs: setupResult.durationMs,
        stdout: setupResult.stdout || "",
        stderr: setupResult.stderr || "",
      },
      agent: {
        name: options.agent,
        mode: options.agent,
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "",
      },
      verifier: {
        exitCode: null,
        durationMs: 0,
        stdout: "",
        stderr: "",
      },
      tokens: null,
      toolCalls: null,
      testAttempts: 0,
      compactCount: null,
      permissionPrompts: null,
      permissionDenials: null,
      subagentReviews: null,
      planStepsCompleted: null,
      patchStats: diffSnapshots(before, before),
      outputDir: taskOutputDir,
    };
  }

  const agentResult = await runAgent(task, workspaceDir, options);
  const verifyResult = await runCommand(task.verifyCommand, {
    cwd: workspaceDir,
    timeoutMs: task.timeoutMs || 600000,
    env: buildTaskEnv(task, workspaceDir, options),
  });
  const durationMs = Math.round(performance.now() - start);
  const after = await snapshotWorkspace(workspaceDir);
  const patchStats = diffSnapshots(before, after);
  const prompt = task.promptFile && fs.existsSync(task.promptFile)
    ? await fsp.readFile(task.promptFile, "utf8")
    : "";

  return {
    taskId: task.id,
    suite: task.suite,
    benchmark: task.benchmark,
    passed: agentResult.exitCode === 0 && verifyResult.exitCode === 0,
    durationMs,
    promptChars: prompt.length,
    setupCommand: task.setupCommand || null,
    verifyCommand: task.verifyCommand,
    setup: {
      exitCode: setupResult.exitCode,
      durationMs: setupResult.durationMs,
      stdout: setupResult.stdout || "",
      stderr: setupResult.stderr || "",
    },
    agent: {
      name: options.agent,
      mode: options.agent,
      exitCode: agentResult.exitCode,
      durationMs: agentResult.durationMs,
      stdout: agentResult.stdout || "",
      stderr: agentResult.stderr || "",
    },
    verifier: {
      exitCode: verifyResult.exitCode,
      durationMs: verifyResult.durationMs,
      stdout: verifyResult.stdout || "",
      stderr: verifyResult.stderr || "",
    },
    tokens: null,
    toolCalls: null,
    testAttempts: 1,
    compactCount: null,
    permissionPrompts: null,
    permissionDenials: null,
    subagentReviews: null,
    planStepsCompleted: null,
    patchStats,
    outputDir: taskOutputDir,
  };
}

async function runAgent(task, workspaceDir, options) {
  if (options.agent === "noop") {
    return { exitCode: 0, durationMs: 0 };
  }
  if (options.agent === "oracle") {
    if (!task.oracleCommand) {
      return { exitCode: 0, durationMs: 0 };
    }
    return runCommand(interpolate(task.oracleCommand, task, workspaceDir, options), {
      cwd: workspaceDir,
      timeoutMs: task.timeoutMs || 600000,
      env: buildTaskEnv(task, workspaceDir, options),
    });
  }
  if (options.agent === "command") {
    if (!options.agentCommand) throw new Error("--agent command requires --agent-command");
    return runCommand(interpolate(options.agentCommand, task, workspaceDir, options), {
      cwd: workspaceDir,
      timeoutMs: task.timeoutMs || 600000,
      env: buildTaskEnv(task, workspaceDir, options),
    });
  }
  throw new Error(`Unknown agent mode: ${options.agent}`);
}

function interpolate(command, task, workspaceDir, options) {
  return command
    .replaceAll("{workspace}", shellQuote(workspaceDir))
    .replaceAll("{taskDir}", shellQuote(task.taskDir))
    .replaceAll("{promptFile}", shellQuote(task.promptFile || ""))
    .replaceAll("{benchmarkRoot}", shellQuote(options.benchmarkRoot || ""));
}

function shellQuote(value) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (process.platform === "win32") {
    return `"${normalized
      .replaceAll("^", "^^")
      .replaceAll("%", "^%")
      .replaceAll("!", "^!")
      .replaceAll('"', '\\"')}"`;
  }
  return `'${normalized.replaceAll("'", "'\\''")}'`;
}

function buildTaskEnv(task, workspaceDir, options) {
  return {
    ...process.env,
    npm_config_cache: path.join(workspaceDir, ".npm-cache"),
    NPM_CONFIG_CACHE: path.join(workspaceDir, ".npm-cache"),
    SATORI_EVAL_TASK_ID: task.id,
    SATORI_EVAL_SUITE: task.suite || "",
    SATORI_EVAL_WORKSPACE: workspaceDir,
    SATORI_EVAL_PROMPT_FILE: task.promptFile || "",
    SATORI_EVAL_BENCHMARK_ROOT: options.benchmarkRoot || "",
  };
}

async function runCommand(command, { cwd, timeoutMs, env }) {
  const start = performance.now();
  const child = spawn(command, {
    cwd,
    env,
    shell: true,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const exitCode = await new Promise((resolve) => {
    let settled = false;
    const settle = (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => settle(124));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      settle(code ?? 1);
    });
    child.on("error", () => {
      clearTimeout(timer);
      settle(1);
    });
  });
  return {
    exitCode,
    durationMs: Math.round(performance.now() - start),
    stdout: truncate(stdout),
    stderr: truncate(stderr),
  };
}

async function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("exit", resolve);
      killer.on("error", resolve);
    });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

function truncate(text, max = 12000) {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

async function snapshotWorkspace(root) {
  const files = new Map();
  await walk(root, async (filePath) => {
    const rel = path.relative(root, filePath).replaceAll("\\", "/");
    const text = await fsp.readFile(filePath, "utf8").catch(() => null);
    if (text !== null) files.set(rel, text);
  });
  return files;
}

async function walk(dir, visit) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".npm-cache") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visit);
    else if (entry.isFile()) await visit(full);
  }
}

function diffSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;
  for (const file of paths) {
    const left = before.get(file);
    const right = after.get(file);
    if (left === right) continue;
    filesChanged += 1;
    const leftLines = left === undefined ? [] : left.split(/\r?\n/);
    const rightLines = right === undefined ? [] : right.split(/\r?\n/);
    if (left === undefined) insertions += rightLines.length;
    else if (right === undefined) deletions += leftLines.length;
    else {
      insertions += Math.max(0, rightLines.length - leftLines.length);
      deletions += Math.max(0, leftLines.length - rightLines.length);
      if (rightLines.length === leftLines.length) insertions += 1;
    }
  }
  return { filesChanged, insertions, deletions };
}

export function summarizeResults(results, metadata = {}) {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const avg = (values) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  return {
    ...metadata,
    total,
    passed,
    failed: total - passed,
    passRate: total ? passed / total : 0,
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    avgPromptChars: avg(results.map((r) => r.promptChars || 0)),
    avgFilesChanged: avg(results.map((r) => r.patchStats?.filesChanged || 0)),
  };
}

async function writeReports(outputDir, results, summary) {
  await fsp.writeFile(
    path.join(outputDir, "results.jsonl"),
    results.map((r) => JSON.stringify(r)).join("\n") + "\n",
    "utf8",
  );
  await fsp.writeFile(path.join(outputDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  await fsp.writeFile(path.join(outputDir, "report.md"), renderMarkdownReport(summary, results), "utf8");
}

export function renderMarkdownReport(summary, results) {
  const rows = results.map((r) => (
    `| ${r.taskId} | ${r.benchmark} | ${r.passed ? "PASS" : "FAIL"} | ${r.durationMs} | ${r.patchStats.filesChanged} |`
  ));
  return [
    "# Satori Agent Eval Report",
    "",
    `- Suite: ${summary.suite || ""}`,
    `- Agent: ${summary.agent || ""}`,
    `- Tasks: ${summary.total}`,
    `- Passed: ${summary.passed}`,
    `- Pass rate: ${(summary.passRate * 100).toFixed(1)}%`,
    `- Avg duration: ${summary.avgDurationMs} ms`,
    "",
    "| Task | Benchmark | Result | Duration ms | Files Changed |",
    "|---|---|---:|---:|---:|",
    ...rows,
    "",
  ].join("\n");
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function main() {
  try {
    const args = parseEvalArgs();
    if (args.help) {
      console.log(helpText());
      return 0;
    }
    const result = await runSuite(args);
    if (args.dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`Eval complete: ${result.outputDir}`);
    console.log(`Passed ${result.summary.passed}/${result.summary.total}`);
    return result.summary.failed === 0 ? 0 : 1;
  } catch (err) {
    console.error(err?.stack || err?.message || String(err));
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const code = await main();
  process.exit(code);
}
