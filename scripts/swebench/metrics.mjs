#!/usr/bin/env node
/**
 * Compute acceptance metrics for a SWE-bench run (resume-bullet numbers):
 *
 *   - 故障恢复 A/N   : instances whose FAIL_TO_PASS tests all turned green (official `resolved`)
 *   - 新增回归 B/N   : instances where PASS_TO_PASS tests broke after the patch
 *   - 主工作区污染 C/N: instances where the agent touched files outside the gold
 *                      patch's file scope
 *
 * Inputs:
 *   --suite       suite manifest (task list) from prepare.mjs
 *   --predictions predictions.jsonl from collect.mjs (agent patches)
 *   --instances   instances.jsonl from dump_dataset.py (gold patch_files)
 *   --reports-dir directory the official harness wrote report.json files into
 *                 (searched recursively)
 * Output: metrics.json + console table.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    suite: "",
    predictions: "",
    instances: "",
    reportsDir: "",
    output: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--suite") args.suite = requireValue(argv, ++i, arg);
    else if (arg === "--predictions") args.predictions = requireValue(argv, ++i, arg);
    else if (arg === "--instances") args.instances = requireValue(argv, ++i, arg);
    else if (arg === "--reports-dir") args.reportsDir = requireValue(argv, ++i, arg);
    else if (arg === "--output") args.output = requireValue(argv, ++i, arg);
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
    "Usage: node scripts/swebench/metrics.mjs --suite <manifest> --predictions <jsonl> --instances <jsonl> --reports-dir <dir>",
    "",
    "Options:",
    "  --suite <file>          Suite manifest (task list)",
    "  --predictions <file>    predictions.jsonl (agent patches)",
    "  --instances <file>      instances.jsonl (gold patch_files field required)",
    "  --reports-dir <dir>     Official harness output dir (searched recursively for report.json)",
    "  --output <file>         metrics.json output (default: <reports-dir>/metrics.json)",
  ].join("\n");
}

function readJsonl(file) {
  const map = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = JSON.parse(trimmed);
    if (record.instance_id) map.set(record.instance_id, record);
  }
  return map;
}

/** File paths touched by a unified diff (a/... b/... header pairs). */
function diffFiles(patch) {
  const files = new Set();
  for (const m of (patch || "").matchAll(/^diff --git a\/(.+?) b\/(.+?)$/gm)) {
    files.add(m[2]);
  }
  for (const m of (patch || "").matchAll(/^\+\+\+ b\/(.+)$/gm)) {
    if (m[1] !== "/dev/null") files.add(m[1]);
  }
  return files;
}

function findReportFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findReportFiles(full, found);
    else if (entry.name === "report.json") found.push(full);
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return 0;
  }
  for (const [flag, value] of Object.entries(args)) {
    if (flag !== "output" && !value) throw new Error(`${flag} is required`);
  }

  const suite = JSON.parse(fs.readFileSync(args.suite, "utf8"));
  const gold = readJsonl(args.instances);
  const predictions = readJsonl(args.predictions);

  const reportFiles = findReportFiles(path.resolve(args.reportsDir));
  if (reportFiles.length === 0) throw new Error(`no report.json found under ${args.reportsDir}`);
  const reports = new Map();
  for (const file of reportFiles) {
    const instanceId = path.basename(path.dirname(file));
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    // 5.x 的 report.json 是嵌套结构：{ "<instance_id>": { resolved, tests_status, ... } }
    const rep = raw[instanceId] ?? raw;
    reports.set(instanceId, rep);
  }
  console.log(`reports found: ${reports.size} | predictions: ${predictions.size} | tasks: ${suite.tasks.length}`);

  const perInstance = [];
  const aggregate = {
    total: suite.tasks.length,
    evaluated: 0,
    resolved: 0,
    regressions: 0,
    polluted: 0,
  };

  for (const task of suite.tasks) {
    const id = task.id;
    const report = reports.get(id);
    const prediction = predictions.get(id);
    const goldMeta = gold.get(id);

    const resolved = report?.resolved === true;
    const p2pBroken = Object.values(report?.tests_status?.PASS_TO_PASS?.failure ?? {}).length > 0
      || (report?.tests_status?.PASS_TO_PASS?.failure?.length ?? 0) > 0;
    const agentFiles = diffFiles(prediction?.model_patch);
    const goldFiles = new Set(goldMeta?.patch_files ?? []);
    const outOfScope = [...agentFiles].filter((f) => !goldFiles.has(f));
    const polluted = outOfScope.length > 0;

    if (report) aggregate.evaluated += 1;
    if (resolved) aggregate.resolved += 1;
    if (p2pBroken) aggregate.regressions += 1;
    if (polluted) aggregate.polluted += 1;

    perInstance.push({
      id,
      evaluated: !!report,
      resolved,
      failToPass: report?.tests_status?.FAIL_TO_PASS ?? null,
      passToPassBroken: p2pBroken,
      passToPassFailureCount: report?.tests_status?.PASS_TO_PASS?.failure?.length ?? 0,
      agentChangedFiles: [...agentFiles],
      outOfScopeFiles: outOfScope,
      polluted,
    });
  }

  const solveRate = aggregate.evaluated > 0 ? (aggregate.resolved / aggregate.evaluated) * 100 : 0;
  const metrics = {
    generatedAt: new Date().toISOString(),
    summary: {
      "故障恢复(解决率)": `${aggregate.resolved}/${aggregate.evaluated} = ${solveRate.toFixed(1)}%`,
      "新增回归": `${aggregate.regressions}/${aggregate.evaluated}`,
      "主工作区污染": `${aggregate.polluted}/${aggregate.evaluated}`,
      evaluatedNote: "evaluated = 官方判分有 report 的实例数",
    },
    aggregate,
    solveRatePercent: Number(solveRate.toFixed(1)),
    perInstance,
  };

  const output = path.resolve(args.output || path.join(args.reportsDir, "metrics.json"));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(metrics, null, 2), "utf8");
  console.log("\n===== 评测指标 =====");
  console.log(`故障恢复(解决率): ${aggregate.resolved}/${aggregate.evaluated} = ${solveRate.toFixed(1)}%`);
  console.log(`新增回归: ${aggregate.regressions}/${aggregate.evaluated}`);
  console.log(`主工作区污染: ${aggregate.polluted}/${aggregate.evaluated}`);
  console.log(`metrics.json: ${output}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main();
  process.exit(code);
}
