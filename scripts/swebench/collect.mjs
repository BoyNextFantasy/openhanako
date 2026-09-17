#!/usr/bin/env node
/**
 * Collect git diffs from each SWE-bench workspace into the official
 * predictions JSONL schema: {instance_id, model_name_or_path, model_patch}.
 *
 * Uses `git add -A` + `git diff --cached` so new/deleted files are captured
 * while gitignored build artifacts stay out.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    suite: "",
    predictionsOut: "",
    modelName: "satori-codingplan",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--suite") args.suite = requireValue(argv, ++i, arg);
    else if (arg === "--predictions-out") args.predictionsOut = requireValue(argv, ++i, arg);
    else if (arg === "--model-name") args.modelName = requireValue(argv, ++i, arg);
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) throw new Error(`${flag} requires a value`);
  return argv[index];
}

function helpText() {
  return [
    "Usage: node scripts/swebench/collect.mjs --suite <manifest.json> [options]",
    "",
    "Options:",
    "  --suite <file>            Suite manifest from prepare.mjs (required)",
    "  --predictions-out <file>  Output JSONL (default: alongside the suite)",
    "  --model-name <name>       model_name_or_path value (default: satori-codingplan)",
  ].join("\n");
}

function gitPatch(workspaceDir) {
  execFileSync("git", ["-C", workspaceDir, "add", "-A"], { stdio: ["ignore", "ignore", "pipe"] });
  let diff = execFileSync("git", ["-C", workspaceDir, "diff", "--cached"], {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024,
  }).toString();
  // Windows 检出会把 CRLF 带进上下文行，统一转 LF，否则补丁在 Linux 容器里 apply 失败
  diff = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // unified diff 必须以换行结尾，缺尾换行会让 git apply 报 "unexpectedly ends in middle of line"
  if (diff && !diff.endsWith("\n")) diff += "\n";
  return diff;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return 0;
  }
  if (!args.suite) throw new Error("--suite is required");

  const suite = JSON.parse(fs.readFileSync(args.suite, "utf8"));
  const predictionsOut = path.resolve(
    args.predictionsOut || path.join(path.dirname(path.resolve(args.suite)), "predictions.jsonl"),
  );
  fs.mkdirSync(path.dirname(predictionsOut), { recursive: true });

  let withPatch = 0;
  const handle = fs.openSync(predictionsOut, "w", 0o644);
  try {
    for (const task of suite.tasks) {
      let patch = "";
      try {
        patch = gitPatch(task.workspace).trim();
      } catch (err) {
        console.error(`[warn] ${task.id}: git diff failed: ${err?.message || err}`);
      }
      if (patch) withPatch += 1;
      const record = {
        instance_id: task.id,
        model_name_or_path: args.modelName,
        model_patch: patch,
      };
      fs.writeSync(handle, `${JSON.stringify(record)}\n`);
      console.log(`[collect] ${task.id}: ${patch ? `${patch.length} chars` : "empty patch"}`);
    }
  } finally {
    fs.closeSync(handle);
  }
  console.log(`predictions: ${predictionsOut} (${suite.tasks.length} records, ${withPatch} with non-empty patches)`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main();
  process.exit(code);
}
