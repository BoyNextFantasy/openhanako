#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAiderPolyglotManifest } from "./eval-adapter-aider-polyglot.mjs";
import { runSuite } from "./eval-agent.mjs";
import { ensureAiderPolyglotBenchmark } from "./bench-pull.mjs";
import fsp from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");
const DEFAULT_BENCHMARK_ROOT = path.join(PROJECT_ROOT, ".cache", "eval-agent", "public", "aider-polyglot-benchmark");
const DEFAULT_SUITE = path.join(PROJECT_ROOT, ".cache", "eval-agent", "aider-polyglot-js-real.json");

export function parseBenchArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {
    benchmarkRoot: DEFAULT_BENCHMARK_ROOT,
    language: env.SATORI_BENCH_LANGUAGE || "javascript",
    limit: parseLimit(env.SATORI_BENCH_LIMIT || "1", "SATORI_BENCH_LIMIT"),
    output: "",
    suiteOutput: DEFAULT_SUITE,
    dryRun: false,
    skipPull: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--benchmark-root") args.benchmarkRoot = path.resolve(requireValue(argv, ++i, arg));
    else if (arg === "--language") args.language = requireValue(argv, ++i, arg);
    else if (arg === "--limit") args.limit = parseLimit(requireValue(argv, ++i, arg), arg);
    else if (arg === "--output") args.output = path.resolve(requireValue(argv, ++i, arg));
    else if (arg === "--suite-output") args.suiteOutput = path.resolve(requireValue(argv, ++i, arg));
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--skip-pull") args.skipPull = true;
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
  if (!/^\d+$/.test(String(value))) throw new Error(`${flag} requires a non-negative integer`);
  return Number(value);
}

export function helpText() {
  return [
    "Usage: npm run bench:aider-polyglot",
    "",
    "Runs a real Satori eval against a small public Aider Polyglot suite.",
    "",
    "Defaults:",
    "  language: javascript",
    "  limit: 1 (override with SATORI_BENCH_LIMIT=3 or -- --limit 3)",
    "",
    "Options:",
    "  --limit <n>          Number of public tasks to run",
    "  --language <name>    Language track",
    "  --dry-run            Build the suite and list tasks without model calls",
    "  --skip-pull          Do not clone/pull the public benchmark first",
  ].join("\n");
}

export async function runAiderPolyglotBench(options) {
  const benchmarkRoot = options.skipPull
    ? path.resolve(options.benchmarkRoot)
    : await ensureAiderPolyglotBenchmark({ benchmarkRoot: options.benchmarkRoot });
  const manifest = await buildAiderPolyglotManifest({
    benchmarkRoot,
    language: options.language,
    limit: options.limit,
  });
  await fsp.mkdir(path.dirname(options.suiteOutput), { recursive: true });
  await fsp.writeFile(options.suiteOutput, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  const solveScript = path.join(PROJECT_ROOT, "scripts", "eval-solve-satori.mjs").replaceAll("\\", "/");
  const node = process.execPath.replaceAll("\\", "/");
  const agentCommand = `"${node}" "${solveScript}" --workspace {workspace} --prompt-file {promptFile}`;

  return runSuite({
    suite: options.suiteOutput,
    benchmarkRoot,
    agent: options.dryRun ? "noop" : "command",
    agentCommand,
    output: options.output,
    limit: options.limit,
    dryRun: options.dryRun,
  });
}

async function main() {
  try {
    const args = parseBenchArgs();
    if (args.help) {
      console.log(helpText());
      return 0;
    }
    const result = await runAiderPolyglotBench(args);
    if (args.dryRun) {
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    console.log(`Public benchmark eval complete: ${result.outputDir}`);
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
