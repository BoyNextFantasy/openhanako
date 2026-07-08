import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { loadSuite, parseEvalArgs, summarizeResults } from "../scripts/eval-agent.mjs";
import { buildAiderPolyglotManifest, parseAiderAdapterArgs } from "../scripts/eval-adapter-aider-polyglot.mjs";
import { buildSolvePrompt, parseSolveArgs } from "../scripts/eval-solve-satori.mjs";
import { parseBenchArgs } from "../scripts/bench-aider-polyglot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("eval-agent runner", () => {
  it("parses the local smoke suite", async () => {
    const suite = await loadSuite("eval/suites/local-smoke.json");
    assert.equal(suite.suite, "local-smoke");
    assert.equal(suite.tasks[0].id, "js-sum-001");
    assert.ok(path.isAbsolute(suite.tasks[0].workspace));
  });

  it("resolves public benchmark manifests through benchmarkRoot", async () => {
    const suite = await loadSuite("eval/examples/aider-polyglot.example.json", {
      benchmarkRoot: "E:/benchmarks/polyglot",
    });
    assert.equal(suite.tasks[0].workspace.replaceAll("\\", "/"), "E:/benchmarks/polyglot/materialized/js-example/workspace");
  });

  it("builds an Aider Polyglot manifest from a benchmark checkout", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aider-polyglot-"));
    const exercise = path.join(root, "javascript", "exercises", "practice", "binary");
    fs.mkdirSync(path.join(exercise, ".docs"), { recursive: true });
    fs.writeFileSync(path.join(exercise, ".docs", "instructions.md"), "Fix binary.", "utf8");
    fs.writeFileSync(path.join(exercise, "package.json"), "{\"scripts\":{\"test\":\"jest\"}}", "utf8");

    const manifest = await buildAiderPolyglotManifest({
      benchmarkRoot: root,
      language: "javascript",
      limit: 1,
    });

    assert.equal(manifest.suite, "aider-polyglot-javascript-lite");
    assert.equal(manifest.tasks[0].id, "javascript-binary");
    assert.equal(manifest.tasks[0].setupCommand, "npm install --no-audit --fund=false");
    assert.equal(manifest.tasks[0].verifyCommand, "npm test");
    assert.equal(manifest.tasks[0].workspace, "{benchmarkRoot}/javascript/exercises/practice/binary");
  });

  it("parses CLI options", () => {
    const args = parseEvalArgs(["--suite", "x.json", "--agent", "noop", "--limit", "2", "--dry-run"]);
    assert.equal(args.suite, "x.json");
    assert.equal(args.agent, "noop");
    assert.equal(args.limit, 2);
    assert.equal(args.dryRun, true);
  });

  it("rejects invalid limit values", () => {
    assert.throws(() => parseEvalArgs(["--limit", "three"]), /non-negative integer/);
    assert.throws(() => parseEvalArgs(["--limit", "-1"]), /non-negative integer/);
    assert.throws(() => parseAiderAdapterArgs(["--limit", "three"]), /non-negative integer/);
    assert.throws(() => parseBenchArgs(["--limit", "three"], {}), /non-negative integer/);
  });

  it("parses non-interactive solve options", () => {
    const args = parseSolveArgs([
      "--workspace",
      "work",
      "--prompt-file",
      "prompt.md",
      "--timeout-ms",
      "1000",
      "--dry-run",
    ]);
    assert.equal(args.workspace, "work");
    assert.equal(args.promptFile, "prompt.md");
    assert.equal(args.timeoutMs, 1000);
    assert.equal(args.dryRun, true);
  });

  it("builds a benchmark solve prompt from the public task prompt", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satori-solve-prompt-"));
    const promptFile = path.join(dir, "instructions.md");
    fs.writeFileSync(promptFile, "Implement Bob.", "utf8");

    const prompt = await buildSolvePrompt({
      workspace: path.join(dir, "workspace"),
      promptFile,
    });

    assert.match(prompt, /公开 coding benchmark/);
    assert.match(prompt, /不要修改测试文件/);
    assert.match(prompt, /Implement Bob\./);
  });

  it("summarizes pass rate and duration", () => {
    const summary = summarizeResults([
      { passed: true, durationMs: 10, promptChars: 5, patchStats: { filesChanged: 1 } },
      { passed: false, durationMs: 30, promptChars: 7, patchStats: { filesChanged: 3 } },
    ], { suite: "demo" });

    assert.equal(summary.suite, "demo");
    assert.equal(summary.total, 2);
    assert.equal(summary.passed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.passRate, 0.5);
    assert.equal(summary.avgDurationMs, 20);
    assert.equal(summary.avgFilesChanged, 2);
  });

  it("runs the local smoke suite and writes report artifacts", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "satori-eval-"));
    execFileSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      "eval/suites/local-smoke.json",
      "--agent",
      "oracle",
      "--output",
      out,
    ], { cwd: repoRoot, stdio: "pipe" });

    const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
    const report = fs.readFileSync(path.join(out, "report.md"), "utf8");
    assert.equal(summary.total, 1);
    assert.equal(summary.passed, 1);
    assert.match(report, /Pass rate: 100\.0%/);
  });

  it("quotes placeholder paths for command agents", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "satori eval spaced "));
    const out = path.join(parent, "run output");
    execFileSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      "eval/suites/local-smoke.json",
      "--agent",
      "command",
      "--agent-command",
      "node {taskDir}/solution.mjs {workspace}",
      "--output",
      out,
    ], { cwd: repoRoot, stdio: "pipe" });

    const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
    assert.equal(summary.total, 1);
    assert.equal(summary.passed, 1);
  });

  it("does not reuse stale workspace contents when output is reused", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "satori-eval-reuse-"));
    execFileSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      "eval/suites/local-smoke.json",
      "--agent",
      "oracle",
      "--output",
      out,
    ], { cwd: repoRoot, stdio: "pipe" });

    const second = spawnSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      "eval/suites/local-smoke.json",
      "--agent",
      "noop",
      "--output",
      out,
    ], { cwd: repoRoot, encoding: "utf8" });

    assert.notEqual(second.status, 0);
    const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
    assert.equal(summary.total, 1);
    assert.equal(summary.passed, 0);
  });

  it("marks a task failed when the agent command exits non-zero", () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "satori-eval-agent-fail-"));
    const result = spawnSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      "eval/suites/local-smoke.json",
      "--agent",
      "command",
      "--agent-command",
      "node {taskDir}/solution.mjs {workspace} && node -e \"process.exit(7)\"",
      "--output",
      out,
    ], { cwd: repoRoot, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    const summary = JSON.parse(fs.readFileSync(path.join(out, "summary.json"), "utf8"));
    const resultLine = fs.readFileSync(path.join(out, "results.jsonl"), "utf8").trim();
    const taskResult = JSON.parse(resultLine);
    assert.equal(summary.passed, 0);
    assert.equal(taskResult.agent.exitCode, 7);
    assert.equal(taskResult.verifier.exitCode, 0);
  });

  it("fails before agent execution when setup command fails", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "satori-eval-setup-fail-"));
    const workspace = path.join(parent, "workspace");
    const promptFile = path.join(parent, "prompt.md");
    const suiteFile = path.join(parent, "suite.json");
    const out = path.join(parent, "out");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(promptFile, "setup should fail", "utf8");
    fs.writeFileSync(path.join(workspace, "package.json"), "{\"type\":\"module\"}", "utf8");
    fs.writeFileSync(suiteFile, JSON.stringify({
      suite: "setup-fail",
      benchmark: "local",
      tasks: [{
        id: "setup-fail-001",
        workspace,
        promptFile,
        setupCommand: "node -e \"process.exit(9)\"",
        verifyCommand: "node -e \"process.exit(0)\"",
      }],
    }), "utf8");

    const result = spawnSync(process.execPath, [
      "scripts/eval-agent.mjs",
      "--suite",
      suiteFile,
      "--agent",
      "command",
      "--agent-command",
      "node -e \"process.exit(0)\"",
      "--output",
      out,
    ], { cwd: repoRoot, encoding: "utf8" });

    assert.notEqual(result.status, 0);
    const taskResult = JSON.parse(fs.readFileSync(path.join(out, "results.jsonl"), "utf8").trim());
    assert.equal(taskResult.setup.exitCode, 9);
    assert.equal(taskResult.agent.exitCode, null);
    assert.equal(taskResult.verifier.exitCode, null);
  });
});
