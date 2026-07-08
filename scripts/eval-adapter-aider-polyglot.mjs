#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(__filename), "..");

export function parseAiderAdapterArgs(argv = process.argv.slice(2)) {
  const args = {
    benchmarkRoot: "",
    language: "javascript",
    limit: 5,
    output: ".cache/eval-agent/aider-polyglot-lite.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--benchmark-root") args.benchmarkRoot = requireValue(argv, ++i, arg);
    else if (arg === "--language") args.language = requireValue(argv, ++i, arg);
    else if (arg === "--limit") args.limit = parseLimit(requireValue(argv, ++i, arg), arg);
    else if (arg === "--output") args.output = requireValue(argv, ++i, arg);
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
    "Usage: node scripts/eval-adapter-aider-polyglot.mjs --benchmark-root <path> [options]",
    "",
    "Options:",
    "  --language <name>  Language track (default: javascript)",
    "  --limit <n>        Number of exercises to include (default: 5)",
    "  --output <path>    Manifest output path",
  ].join("\n");
}

export async function buildAiderPolyglotManifest(options) {
  if (!options.benchmarkRoot) throw new Error("--benchmark-root is required");
  const root = path.resolve(options.benchmarkRoot);
  const practiceDir = path.join(root, options.language, "exercises", "practice");
  const entries = await fsp.readdir(practiceDir, { withFileTypes: true });
  const exerciseNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .slice(0, options.limit > 0 ? options.limit : undefined);

  return {
    suite: `aider-polyglot-${options.language}-lite`,
    benchmark: "aider-polyglot",
    source: {
      repo: "https://github.com/Aider-AI/polyglot-benchmark",
      benchmarkRoot: root,
      language: options.language,
      generatedBy: "scripts/eval-adapter-aider-polyglot.mjs",
    },
    tasks: exerciseNames.map((name) => ({
      id: `${options.language}-${name}`,
      workspace: `{benchmarkRoot}/${options.language}/exercises/practice/${name}`,
      promptFile: `{benchmarkRoot}/${options.language}/exercises/practice/${name}/.docs/instructions.md`,
      setupCommand: setupCommandForLanguage(options.language),
      verifyCommand: verifyCommandForLanguage(options.language),
      setupTimeoutMs: 900000,
      timeoutMs: 900000,
      tags: ["public-benchmark", "aider-polyglot", options.language],
    })),
  };
}

function setupCommandForLanguage(language) {
  if (language === "javascript") return "npm install --no-audit --fund=false";
  return "";
}

function verifyCommandForLanguage(language) {
  if (language === "javascript") return "npm test";
  if (language === "python") return "pytest";
  if (language === "go") return "go test ./...";
  if (language === "rust") return "cargo test";
  if (language === "java") return "./gradlew test";
  if (language === "cpp") return "cmake --build . && ctest";
  return "echo \"No verifier configured for this language\" && exit 2";
}

async function main() {
  try {
    const args = parseAiderAdapterArgs();
    if (args.help) {
      console.log(helpText());
      return 0;
    }
    const manifest = await buildAiderPolyglotManifest(args);
    const output = path.isAbsolute(args.output) ? args.output : path.resolve(PROJECT_ROOT, args.output);
    await fsp.mkdir(path.dirname(output), { recursive: true });
    await fsp.writeFile(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
    console.log(`Wrote ${manifest.tasks.length} tasks to ${output}`);
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
