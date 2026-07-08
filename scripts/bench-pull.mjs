#!/usr/bin/env node
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const AIDER_REPO = "https://github.com/Aider-AI/polyglot-benchmark";
const DEFAULT_ROOT = path.join(PROJECT_ROOT, ".cache", "eval-agent", "public", "aider-polyglot-benchmark");

export function parsePullArgs(argv = process.argv.slice(2)) {
  const args = {
    benchmarkRoot: DEFAULT_ROOT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--benchmark-root") args.benchmarkRoot = path.resolve(requireValue(argv, ++i, arg));
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

export function helpText() {
  return [
    "Usage: npm run bench:pull",
    "",
    "Pulls the public Aider Polyglot benchmark into .cache/eval-agent/public.",
  ].join("\n");
}

export async function ensureAiderPolyglotBenchmark({ benchmarkRoot = DEFAULT_ROOT } = {}) {
  const root = path.resolve(benchmarkRoot);
  const gitDir = path.join(root, ".git");
  if (await exists(gitDir)) {
    const pulled = await runCapture("git", ["-C", root, "pull", "--ff-only"]);
    if (pulled.code !== 0) {
      if (/dubious ownership/i.test(pulled.stderr)) {
        console.warn(`Aider Polyglot checkout exists but git refused to update it because of ownership. Reusing existing checkout: ${root}`);
        return root;
      }
      throw new Error(`git -C ${root} pull --ff-only exited with ${pulled.code}\n${pulled.stderr}`);
    }
    if (pulled.stdout.trim()) console.log(pulled.stdout.trim());
    return root;
  }
  await fsp.mkdir(path.dirname(root), { recursive: true });
  await run("git", ["clone", "--depth", "1", AIDER_REPO, root]);
  return root;
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", reject);
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  try {
    const args = parsePullArgs();
    if (args.help) {
      console.log(helpText());
      return 0;
    }
    const root = await ensureAiderPolyglotBenchmark(args);
    console.log(`Aider Polyglot benchmark ready: ${root}`);
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
