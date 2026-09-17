#!/usr/bin/env node
/**
 * Prepare a stratified SWE-bench Lite sample for Satori headless solving.
 *
 * Steps:
 *   1. Read instances JSONL dumped by dump_dataset.py.
 *   2. Seeded stratified sample across repos (round-robin over per-repo
 *      seeded-shuffled lists).
 *   3. Per repo: one blobless clone (no checkout) under --root/repos.
 *   4. Per instance: detached git worktree at base_commit under
 *      --root/workspaces, plus a prompt file with the issue text.
 *   5. Emit a suite manifest for scripts/swebench/run.mjs.
 *
 * Everything defaults under E:/swe-bench-work so the C drive is untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = "E:/swe-bench-work";
const GITHUB = "https://github.com";

function parseArgs(argv) {
  const args = {
    instances: "",
    limit: 50,
    seed: 42,
    root: DEFAULT_ROOT,
    output: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--instances") args.instances = requireValue(argv, ++i, arg);
    else if (arg === "--limit") args.limit = requireInt(argv, ++i, arg);
    else if (arg === "--seed") args.seed = requireInt(argv, ++i, arg);
    else if (arg === "--root") args.root = requireValue(argv, ++i, arg);
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

function requireInt(argv, index, flag) {
  const value = requireValue(argv, index, flag);
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires an integer`);
  return Number(value);
}

function helpText() {
  return [
    "Usage: node scripts/swebench/prepare.mjs --instances <instances.jsonl> [options]",
    "",
    "Options:",
    "  --instances <file>    instances.jsonl dumped by dump_dataset.py (required)",
    "  --limit <n>           Sample size (default: 50)",
    "  --seed <n>            RNG seed for the stratified sample (default: 42)",
    "  --root <dir>          Work root (default: E:/swe-bench-work)",
    "  --output <file>       Suite manifest output (default: <root>/suite-swebench-lite.json)",
  ].join("\n");
}

/** Deterministic PRNG so the sample is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function readInstances(file) {
  const raw = fs.readFileSync(file, "utf8");
  const instances = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    instances.push(JSON.parse(trimmed));
  }
  if (instances.length === 0) throw new Error("instances file is empty");
  return instances;
}

/** Stratified round-robin: keeps the sample proportional to each repo's share. */
function stratifiedSample(instances, limit, seed) {
  const rng = mulberry32(seed);
  const byRepo = new Map();
  for (const instance of instances) {
    const list = byRepo.get(instance.repo) ?? [];
    list.push(instance);
    byRepo.set(instance.repo, list);
  }
  const repoOrder = shuffled([...byRepo.keys()], rng);
  for (const repo of repoOrder) byRepo.set(repo, shuffled(byRepo.get(repo), rng));

  const picked = [];
  let exhausted = false;
  while (picked.length < limit && !exhausted) {
    exhausted = true;
    for (const repo of repoOrder) {
      const list = byRepo.get(repo);
      if (list.length === 0) continue;
      exhausted = false;
      picked.push(list.shift());
      if (picked.length >= limit) break;
    }
  }
  return picked.sort((a, b) => a.instance_id.localeCompare(b.instance_id));
}

function runGit(args, options = {}) {
  return execFileSync("git", args, {
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  })
    .toString()
    .trim();
}

function ensureBloblessClone(repo, repoDir) {
  if (fs.existsSync(path.join(repoDir, ".git"))) return "exists";
  fs.mkdirSync(path.dirname(repoDir), { recursive: true });
  runGit(["clone", "--filter=blob:none", "--no-checkout", `${GITHUB}/${repo}.git`, repoDir]);
  return "cloned";
}

function ensureWorktree(repoDir, baseCommit, workspaceDir) {
  if (fs.existsSync(workspaceDir)) return "exists";
  runGit(["-C", repoDir, "worktree", "add", "--detach", workspaceDir, baseCommit]);
  return "created";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(helpText());
    return 0;
  }
  if (!args.instances) throw new Error("--instances is required");

  const root = path.resolve(args.root);
  const reposDir = path.join(root, "repos");
  const workspacesDir = path.join(root, "workspaces");
  const output = path.resolve(args.output || path.join(root, "suite-swebench-lite.json"));
  for (const dir of [root, reposDir, workspacesDir]) fs.mkdirSync(dir, { recursive: true });

  const all = readInstances(args.instances);
  const sample = stratifiedSample(all, args.limit, args.seed);
  console.log(`sampled ${sample.length}/${all.length} instances (seed=${args.seed}, repos=${new Set(sample.map((s) => s.repo)).size})`);

  const tasks = [];
  const failures = [];
  for (const instance of sample) {
    const repoDir = path.join(reposDir, instance.repo.replace("/", "__"));
    const workspaceDir = path.join(workspacesDir, instance.instance_id);
    const promptFile = path.join(workspacesDir, `${instance.instance_id}.prompt.txt`);
    try {
      const cloneState = ensureBloblessClone(instance.repo, repoDir);
      const worktreeState = ensureWorktree(repoDir, instance.base_commit, workspaceDir);
      fs.writeFileSync(promptFile, instance.problem_statement, "utf8");
      tasks.push({
        id: instance.instance_id,
        repo: instance.repo,
        baseCommit: instance.base_commit,
        workspace: workspaceDir,
        promptFile,
      });
      console.log(`[ok] ${instance.instance_id} (${cloneState}/${worktreeState})`);
    } catch (err) {
      failures.push({ id: instance.instance_id, error: String(err?.message || err) });
      console.error(`[fail] ${instance.instance_id}: ${err?.message || err}`);
    }
  }

  const manifest = {
    suite: `swebench-lite-seed${args.seed}-${tasks.length}`,
    benchmark: "swebench-lite",
    sample: { seed: args.seed, limit: args.limit, dumped: all.length, picked: tasks.length },
    tasks,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`manifest: ${output} (${tasks.length} tasks, ${failures.length} failures)`);
  return failures.length > 0 && tasks.length === 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main();
  process.exit(code);
}
