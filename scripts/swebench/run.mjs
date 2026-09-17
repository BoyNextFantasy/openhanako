#!/usr/bin/env node
/**
 * Run Satori headless over a SWE-bench suite manifest with bounded concurrency.
 *
 * Each task runs one detached Satori session (operate mode, memory off) inside
 * the instance worktree. Progress is appended to progress.jsonl so interrupted
 * runs can be resumed with --resume.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { solveWithSatori } from "../eval-solve-satori.mjs";

function parseArgs(argv) {
  const args = {
    suite: "",
    concurrency: 2,
    timeoutMs: 30 * 60 * 1000,
    outDir: "",
    limit: 0,
    only: "",
    resume: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--suite") args.suite = requireValue(argv, ++i, arg);
    else if (arg === "--concurrency") args.concurrency = requireInt(argv, ++i, arg);
    else if (arg === "--timeout-ms") args.timeoutMs = requireInt(argv, ++i, arg);
    else if (arg === "--out-dir") args.outDir = requireValue(argv, ++i, arg);
    else if (arg === "--limit") args.limit = requireInt(argv, ++i, arg);
    else if (arg === "--only") args.only = requireValue(argv, ++i, arg);
    else if (arg === "--resume") args.resume = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function requireInt(argv, index, flag) {
  const value = requireValue(argv, index, flag);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires an integer`);
  return Number(value);
}

function helpText() {
  return [
    "Usage: node scripts/swebench/run.mjs --suite <manifest.json> [options]",
    "",
    "Options:",
    "  --suite <file>         Suite manifest from prepare.mjs (required)",
    "  --concurrency <n>      Parallel Satori sessions (default: 2)",
    "  --timeout-ms <n>       Per-instance timeout (default: 1800000)",
    "  --out-dir <dir>        Run output dir (default: .cache/swebench/run-<ts>)",
    "  --limit <n>            Only run the first N tasks",
    "  --only <id>            Run a single instance id (debug)",
    "  --resume               Skip ids already recorded in progress.jsonl",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return 0;
  }
  if (!args.suite) throw new Error("--suite is required");

  const suite = JSON.parse(fs.readFileSync(args.suite, "utf8"));
  let tasks = suite.tasks;
  if (args.only) tasks = tasks.filter((t) => t.id === args.only);
  if (args.limit > 0) tasks = tasks.slice(0, args.limit);
  if (tasks.length === 0) throw new Error("no tasks to run");

  const outDir = path.resolve(args.outDir || path.join(".cache", "swebench", `run-${Date.now()}`));
  await fsp.mkdir(outDir, { recursive: true });
  const progressFile = path.join(outDir, "progress.jsonl");

  const done = new Set();
  if (args.resume && fs.existsSync(progressFile)) {
    for (const line of fs.readFileSync(progressFile, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        done.add(JSON.parse(trimmed).id);
      } catch {}
    }
  }
  const pending = tasks.filter((t) => !done.has(t.id));
  console.log(`tasks: ${tasks.length} total, ${pending.length} pending (${done.size} already done) -> ${outDir}`);

  let okCount = 0;
  let failCount = 0;
  const startedAt = Date.now();
  let cursor = 0;

  async function worker(workerId) {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= pending.length) return;
      const task = pending[index];
      const started = Date.now();
      process.stdout.write(`[w${workerId}] start ${task.id} (${index + 1}/${pending.length})\n`);
      let line;
      try {
        await solveWithSatori({
          workspace: task.workspace,
          promptFile: task.promptFile,
          permissionMode: "operate",
          timeoutMs: args.timeoutMs,
        });
        line = { id: task.id, ok: true, seconds: Math.round((Date.now() - started) / 1000) };
        okCount += 1;
        process.stdout.write(`[w${workerId}] done  ${task.id} in ${line.seconds}s\n`);
      } catch (err) {
        line = { id: task.id, ok: false, seconds: Math.round((Date.now() - started) / 1000), error: String(err?.message || err) };
        failCount += 1;
        process.stdout.write(`[w${workerId}] FAIL  ${task.id}: ${line.error}\n`);
      }
      fs.appendFileSync(progressFile, `${JSON.stringify(line)}\n`, "utf8");
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, (_, i) => worker(i + 1)));

  const summary = {
    suite: args.suite,
    total: pending.length,
    ok: okCount,
    failed: failCount,
    secondsTotal: Math.round((Date.now() - startedAt) / 1000),
    outDir,
  };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`summary: ${JSON.stringify(summary)}`);
  return okCount + failCount === pending.length && failCount === 0 ? 0 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main();
  process.exit(code);
}
