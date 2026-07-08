# Satori Agent Eval

Lightweight evaluation runner for Satori's agent framework.

This directory intentionally does not vendor public benchmark repositories. The
runner consumes small manifests that point at an external benchmark checkout or a
local smoke fixture, then records verifier results and framework telemetry.

## Smoke Run

```bash
npm run eval:agent -- --suite eval/suites/local-smoke.json --dry-run
npm run eval:agent -- --suite eval/suites/local-smoke.json --agent oracle --output .cache/eval-agent/local-smoke-latest
```

The smoke suite proves the runner, workspace copy, verifier, metrics, JSONL, and
Markdown report flow without calling an LLM.

## Public Benchmark Adapter Shape

Public benchmark tasks should be adapted into this manifest shape:

```json
{
  "suite": "polyglot-lite",
  "benchmark": "aider-polyglot",
  "tasks": [
    {
      "id": "js-example-001",
      "workspace": "{benchmarkRoot}/path/to/materialized/task",
      "promptFile": "{benchmarkRoot}/path/to/prompt.md",
      "verifyCommand": "benchmark-owned test command"
    }
  ]
}
```

The benchmark-owned verifier remains the source of truth. Satori only prepares a
workspace, runs an agent command, invokes the verifier, and records metrics.
Pass `--benchmark-root <path>` when a manifest uses `{benchmarkRoot}`.

## Aider Polyglot Manifest Generation

After cloning the public benchmark outside tracked source, generate a lightweight
manifest:

```bash
git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark .cache/eval-agent/public/aider-polyglot-benchmark
npm run eval:adapter:aider-polyglot -- --benchmark-root .cache/eval-agent/public/aider-polyglot-benchmark --language javascript --limit 3 --output .cache/eval-agent/aider-polyglot-js-lite.json
npm run eval:agent -- --suite .cache/eval-agent/aider-polyglot-js-lite.json --benchmark-root .cache/eval-agent/public/aider-polyglot-benchmark --dry-run
```

The dry-run should list the generated task ids without executing benchmark
dependencies or calling a model.

Running the generated tasks may require benchmark-owned dependencies such as
Jest, pytest, Go, Cargo, or Gradle. Keep that setup external to this repository.

## One-Line Public Benchmark Run

Pull or update the public benchmark checkout:

```bash
npm run bench:pull
```

Run a real one-task Aider Polyglot JavaScript eval with Satori:

```bash
npm run bench:aider-polyglot
```

The command prepares the public task, installs task dependencies inside the
copied workspace, submits the prompt to Satori through `eval:solve`, runs the
benchmark-owned verifier, and prints the report directory.

The default is intentionally small: JavaScript, `limit=1`. Use
`SATORI_BENCH_LIMIT=3 npm run bench:aider-polyglot` or
`npm run bench:aider-polyglot -- --limit 3` when you want a larger run.

## How The Public Benchmark Is Judged

`npm run bench:aider-polyglot` is a real public benchmark loop, but it is
intentionally small by default.

Default task selection:

- Benchmark repo: `https://github.com/Aider-AI/polyglot-benchmark`
- Language track: `javascript`
- Default task count: `1`
- Selection rule: list exercise directories, sort by name, then take the first
  `limit` tasks.
- Current first task: `javascript-affine-cipher`

That means the default command normally runs the same first task each time:
`javascript-affine-cipher`. To run more tasks:

```bash
npm run bench:aider-polyglot -- --limit 3
```

What the runner does for each task:

1. Copy the public task workspace into `.cache/eval-agent/<run>/<task-id>`.
2. Read the public task prompt from the task's `.docs/instructions.md`.
3. Run the task setup command, for JavaScript currently:
   `npm install --no-audit --fund=false`.
4. Start Satori through `scripts/eval-solve-satori.mjs`.
5. Submit the public task prompt to Satori.
6. Wait until the Satori session is no longer streaming.
7. Run the task's own verifier, for JavaScript currently: `npm test`.
8. Compare the copied workspace before and after the run to record how many
   files changed.
9. Write `results.jsonl`, `summary.json`, and `report.md`.

Pass/fail rule:

- `setupCommand` must exit with code `0`.
- The Satori agent command must exit with code `0`.
- The benchmark-owned `verifyCommand` must exit with code `0`.
- If setup fails, the task fails before any model call.
- If Satori exits non-zero, the task fails even if the verifier would pass.
- If the verifier exits non-zero, the task fails.

So the source of truth is the public task's own test command. Satori does not
grade itself, and this repo does not reimplement the answer checker.

The default run calls the configured LLM API because Satori really reads the
task and edits code. Use `--dry-run` when you only want to inspect which tasks
would be selected:

```bash
npm run bench:aider-polyglot -- --dry-run
```

Known limitation of the current lite setup: it is a lightweight acceptance
benchmark, not a leaderboard-grade score. The first verified run covered one
public JavaScript task. The verifier output for `javascript-affine-cipher`
reported `2 passed, 14 skipped`, because that public Exercism-style task keeps
some visible cases skipped by default. This still proves the real loop from
public task to Satori to benchmark-owned verifier, but it should be described as
a one-task public benchmark acceptance result, not as broad benchmark coverage.
