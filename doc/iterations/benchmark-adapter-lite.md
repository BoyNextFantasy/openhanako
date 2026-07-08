# Benchmark Adapter Lite

> 分支：`iter/benchmark-adapter-lite`  
> 日期：2026-07-07  
> 目标：接入轻量现成 benchmark 的评测环节，用固定模型评估 Satori agent framework，而不是做自建题库或打榜平台。

---

## 一、背景

Satori 已经具备个人开发助手的核心构件：记忆系统、Plan 工作流、上下文压缩、子 agent、权限与沙箱。下一步的关键不是继续堆功能，而是证明这些框架能力不是玩具功能：它们能在真实或接近真实的开发任务中形成可量化结果。

用户明确修正了方向：不需要 baseline/full-lite 配置对照，第一阶段只需要有一个轻量评测环节，尽量利用公开 benchmark 脚本，跑通并产出可用于简历和面试交流的材料。

---

## 二、设计目标

### 2.1 做什么

1. 增加 `npm run eval:agent` 离线评测入口。
2. 用 manifest 描述公开 benchmark 的任务、workspace、prompt 和 verifier。
3. 不 vendor 公开 benchmark 仓库；由用户本地 clone 或安装后，通过 manifest 指向它们。
4. 运行后输出：
   - `results.jsonl`
   - `summary.json`
   - `report.md`
5. 记录适合 agent framework 的指标：pass rate、耗时、patch 文件数、prompt 字符数，后续可接 token、tool call、compact、permission、subagent telemetry。

### 2.2 不做什么

1. 不实现 SWE-bench full runner。
2. 不自建大规模 golden scenarios。
3. 不复制 Aider Polyglot 或 Terminal-Bench 的任务仓库。
4. 不把评测 runner 放进产品主路径。
5. 不强制做配置消融对照。后续可以做，但第一版目标只是评测环节跑通。

---

## 三、公开 Benchmark 接入策略

### 3.1 Aider Polyglot

用途：轻量代码修复/编程任务，适合低成本证明 Satori 能完成小型代码任务。

接入方式：本项目只保存 manifest adapter。公开 benchmark 的任务文件由外部 checkout 提供，manifest 中的 `workspace` 指向 materialized task，`promptFile` 指向题面，`verifyCommand` 使用该任务自己的测试命令。Satori runner 不重新实现判题逻辑。

参考仓库：`https://github.com/Aider-AI/polyglot-benchmark`

### 3.2 Terminal-Bench

用途：更贴近 agent harness 评测，覆盖终端操作、环境探索和命令执行能力。

接入方式：Terminal-Bench 的官方脚本或命令仍作为任务/verifier 的权威入口。Satori runner 只负责包装一次 agent 执行、记录输出、收集结果。第一版不锁死 Terminal-Bench CLI 参数，因为外部工具版本可能变化；manifest 的 `verifyCommand` 作为兼容层。

参考仓库：`https://github.com/laude-institute/terminal-bench`

---

## 四、实现结构

| 文件 | 职责 |
|------|------|
| `scripts/eval-agent.mjs` | 评测 CLI：解析参数、读取 suite、复制 workspace、执行 agent/verifier、写报告 |
| `scripts/eval-adapter-aider-polyglot.mjs` | 从 Aider Polyglot 公开 checkout 生成轻量 manifest |
| `scripts/eval-solve-satori.mjs` | Satori 非交互解题入口：创建 eval session、提交题面、等待 session 结束 |
| `scripts/bench-pull.mjs` | 一行拉取/准备公开 Aider Polyglot benchmark |
| `scripts/bench-aider-polyglot.mjs` | 一行真实跑公开 Aider Polyglot 小子集 |
| `eval/suites/local-smoke.json` | 本地 smoke suite，证明链路跑通 |
| `eval/fixtures/js-sum/` | 极小 JS fixture，不调用模型，只验证 runner |
| `eval/README.md` | 使用方式与公开 benchmark manifest 形状 |
| `tests/eval-agent.test.mjs` | runner 解析、汇总、端到端 smoke 测试 |
| `doc/interview/satori-agent-framework-highlights.md` | 简历亮点、量化指标、面试问答 |

---

## 五、复审修复

子 agent 复审后发现了几个会影响评测可信度的边界问题，本轮已一起修复：

1. 复用 `--output` 时，旧 workspace 可能污染下一次运行。现在每个 task 运行前会清理自己的输出目录，避免 noop 或失败 agent 继承上一次修好的代码。
2. agent 命令非 0 退出时，以前只要 verifier 通过就会算 pass。现在必须 agent exit code 和 verifier exit code 都为 0 才算通过。
3. timeout 以前只杀 shell 进程，容易留下子进程。现在 Windows 走 `taskkill /T /F`，POSIX 走进程组终止。
4. `--limit three` 或负数以前会静默变成无限制。现在 `eval:agent` 和 `eval:adapter:aider-polyglot` 都要求非负整数。
5. `{workspace}`、`{taskDir}` 等 command 占位符现在会做 shell quote，覆盖常见带空格路径。
6. 简历材料中将 token/tool/compact/permission 指标改为“预留/后续接入”，不再表达成已完整采集。
7. Satori 非交互解题入口最初等待第一个 `turn_end` 就退出，会导致 verifier 抢在工具写文件前运行。现在改为等待目标 session 的 `status: isStreaming=false`。
8. 公开题依赖安装最初使用用户级 npm cache，沙箱下会遇到 `EPERM`。现在每个 copied workspace 使用自己的 `.npm-cache`，并且 patch 快照忽略该目录。
9. 固定 `latest` 输出目录可能被仍在运行的 Satori session 锁住。`bench:aider-polyglot` 默认改为每次生成新的 timestamp 输出目录。

---

## 六、Runner 工作流

1. 读取 suite manifest。
2. 将 task workspace 复制到 `.cache/eval-agent/<run>/...`。
3. 根据 `--agent` 执行：
   - `oracle`：用于本地 smoke，执行 task 的 `oracleCommand`。
   - `noop`：不改文件，用于验证失败链路。
   - `command`：执行用户提供的 `--agent-command`；`bench:aider-polyglot` 会调用 `eval:solve` 让 Satori 真解题。
4. 如果任务声明 `setupCommand`，先安装依赖；setup 失败则不调用模型，直接记录失败。
5. 执行 `verifyCommand`。
6. 比较 workspace 前后文本快照，生成 patch stats。
7. 写出 JSONL、summary JSON 和 Markdown report。

---

## 七、判题机制与黑箱拆解

这轮评测最容易被误解成“脚本自己说通过”，所以这里把判断链路拆开。

### 7.1 题目从哪里来

`npm run bench:pull` 会准备 Aider Polyglot 的公开仓库：

```text
.cache/eval-agent/public/aider-polyglot-benchmark
```

`npm run bench:aider-polyglot` 默认使用：

- benchmark：Aider Polyglot public benchmark
- language：`javascript`
- limit：`1`
- 选题规则：读取 `javascript/exercises/practice/` 目录，按目录名排序，取前 `limit` 个
- 当前默认第一题：`javascript-affine-cipher`

因此默认命令每次基本都会跑同一道题：`javascript-affine-cipher`。这不是随机抽题。想跑多题需要显式传参：

```bash
npm run bench:aider-polyglot -- --limit 3
```

`javascript-affine-cipher` 的题面来自公开题目自己的：

```text
.docs/instructions.md
```

题目要求实现仿射加密/解密逻辑：对字母按公式变换，处理数字、空格、标点和非法参数。Satori 读取的就是这个公开题面，而不是本项目里手写的答案提示。

### 7.2 一道题具体怎么跑

单题执行顺序：

1. runner 将公开题目的 workspace 复制到本次运行目录，例如：
   `.cache/eval-agent/2026-07-08T02-17-07-244Z/javascript-affine-cipher`
2. runner 记录复制后 workspace 的文本快照，用于后续统计改了几个文件。
3. 如果任务声明了 `setupCommand`，先执行 setup。JavaScript 当前是：
   `npm install --no-audit --fund=false`
4. setup 成功后，runner 调用：
   `scripts/eval-solve-satori.mjs`
5. `eval-solve-satori.mjs` 创建一个非交互 Satori session，把题面提交给 Satori。
6. 这一步会调用用户配置的 LLM API，因为 Satori 需要真实读题、思考并改代码。
7. runner 等到目标 Satori session 的 `isStreaming=false`，避免 agent 工具还没写完文件就提前验收。
8. runner 执行公开题目自己的 `verifyCommand`。JavaScript 当前是：
   `npm test`
9. runner 再比较 workspace 前后快照，记录 `filesChanged`、`insertions`、`deletions`。
10. 最后写出 `results.jsonl`、`summary.json`、`report.md`。

### 7.3 成功/失败怎么判定

单题必须同时满足三个条件才算通过：

1. `setupCommand` 退出码为 `0`。
2. Satori agent 命令退出码为 `0`。
3. 公开题目自己的 `verifyCommand` 退出码为 `0`。

任一失败都算失败：

- setup 失败：依赖没装好，不调用模型，任务失败。
- Satori 失败：即使测试碰巧能过，也不算通过。
- verifier 失败：Satori 改了代码但公开题测试不通过，任务失败。

所以权威判题方是公开题目自己的测试命令，不是 Satori 自评，也不是 runner 主观判断。runner 只负责复制环境、调用 agent、调用 verifier、记录结果。

### 7.4 这次真实验收结果

用户本机运行：

```bash
npm run bench:pull
npm run bench:aider-polyglot
```

输出：

```text
Public benchmark eval complete: E:\AI_agent\openhanako\.cache\eval-agent\2026-07-08T02-17-07-244Z
Passed 1/1
```

报告显示：

- task：`javascript-affine-cipher`
- result：`PASS`
- duration：`109170 ms`
- files changed：`1`
- setup exit code：`0`
- agent exit code：`0`
- verifier exit code：`0`

verifier 是题目自己的 `npm test`。该次输出中 Jest 报告：

```text
Test Suites: 1 passed, 1 total
Tests: 14 skipped, 2 passed, 16 total
```

这里要如实记录边界：这证明了公开题库闭环可以真实跑通，并且 Satori 在该任务的 benchmark-owned verifier 下通过；但它不是大规模排行榜分数，也不是完整隐藏测试覆盖。Aider Polyglot 当前接入的默认配置是轻量验收，默认只跑 1 道题，且该 Exercism 风格题目存在默认 skipped 的可见用例。

### 7.5 为什么这不是玩具测试

本项目里仍然保留了 local smoke fixture，它的作用是测试 runner 自身，不调用模型，不代表 agent 能力。

而 `bench:aider-polyglot` 的不同点是：

- 题目来自公开 benchmark checkout。
- 题面来自公开任务文件。
- workspace 是公开题目的真实代码目录。
- Satori 通过 LLM API 实际解题并改文件。
- 判题使用公开题目自己的测试命令。
- 结果写入可追溯的 report 和 JSONL。

因此这轮可以作为“轻量公开 benchmark 接入与单题真实验收”的项目亮点，但简历或面试中应避免夸大成“完整 benchmark 排名”。

---

## 八、当前跑通结果

命令：

```bash
npm run eval:agent -- --suite eval/suites/local-smoke.json --dry-run
npm run eval:agent -- --suite eval/suites/local-smoke.json --agent oracle --output .cache/eval-agent/local-smoke-latest
npm run eval:adapter:aider-polyglot -- --benchmark-root .cache/eval-agent/public/aider-polyglot-benchmark --language javascript --limit 3 --output .cache/eval-agent/aider-polyglot-js-lite.json
npm run eval:agent -- --suite .cache/eval-agent/aider-polyglot-js-lite.json --benchmark-root .cache/eval-agent/public/aider-polyglot-benchmark --dry-run
npm run bench:pull
npm run bench:aider-polyglot -- --skip-pull --limit 1
npx vitest run tests/eval-agent.test.mjs
npm run typecheck
```

结果：

- dry-run 正确列出 `js-sum-001`。
- local smoke 生成 `.cache/eval-agent/local-smoke-latest/report.md`。
- `Passed 1/1`，报告 pass rate 为 `100.0%`。
- `tests/eval-agent.test.mjs`：13 tests passed，覆盖 runner 参数解析、suite 读取、summary 计算、`{benchmarkRoot}` 解析、Aider manifest 生成、占位符路径 quote、复用输出目录清理、agent 失败判定、setup 失败短路、`eval:solve` prompt 构造和端到端 smoke。
- 已用 `git clone --depth 1 https://github.com/Aider-AI/polyglot-benchmark` 将公开 benchmark 浅克隆到 `.cache/eval-agent/public/aider-polyglot-benchmark`，并确认其 JavaScript track 是 Exercism practice 任务目录。
- `eval:adapter:aider-polyglot` 已从公开 checkout 生成 3 个 JavaScript 任务的 manifest：`javascript-affine-cipher`、`javascript-alphametics`、`javascript-beer-song`。
- 生成后的 Aider manifest 已通过 runner dry-run，证明公开 benchmark checkout -> adapter manifest -> Satori eval runner 的任务发现和路径解析链路可以跑通。
- `npm run bench:pull` 可以一行准备公开题库；当前环境因为 checkout ownership 不允许更新时，会复用已有 `.cache` checkout，而不是要求用户手动改全局 git。
- `npm run bench:aider-polyglot -- --skip-pull --limit 1` 已真实调用 Satori 解 Aider Polyglot 的 `javascript-affine-cipher`，并由 benchmark-owned `npm test` 判定通过。
- 真实跑分报告：`.cache/eval-agent/2026-07-08T01-02-50-525Z/report.md`，`Passed 1/1`，pass rate `100.0%`，avg duration `130714 ms`，files changed `1`。
- `git diff --check` 通过，仅有 Windows 下 `package.json` LF/CRLF 提示。
- `npm run typecheck` 当前仍阻塞在既有问题：`lib/memory/memory-search.ts(71,33)` 和 `(82,33)` 的 TS2554，本次评测迭代未修改该文件。

该结果证明了 lite 公开 benchmark 的真实闭环：公开题库 checkout -> manifest -> copied workspace -> dependency setup -> Satori 非交互解题 -> benchmark verifier -> report。它不是大规模榜单结果，目前只代表 1 道 Aider Polyglot JavaScript 任务的真实跑分。

---

## 九、后续计划

1. 接 usage ledger / trace，将 token、tool calls、compact count、permission prompt、subagent review count 等指标写入 result。
2. 在依赖和 token 成本可控的前提下，将默认公开题数量从 1 扩到 3。
3. 基于 `eval/examples/terminal-bench.example.json`，为 Terminal-Bench 小任务编写真实 wrapper manifest。
4. 视磁盘和依赖成本，再考虑 SWE-bench smoke 或 Terminal-Bench 官方 harness 的更深接入。
