# Satori 项目亮点与面试准备

## 简历摘要

Satori 是一个基于 TypeScript、Node 24、Pi SDK、SQLite 和 Electron 的 AI 编程助手，定位对标 Codex / OpenAI Codex CLI。项目重点不是简单聊天，而是围绕真实代码迭代构建 agent framework：长期记忆、Plan 工作流、上下文压缩、子 agent 协作、权限与沙箱、安全审计，以及轻量 benchmark 评测闭环。

可放简历的描述：

> 独立设计并实现 AI 编程助手 Satori，覆盖记忆系统、Plan 工作流、上下文压缩、子 agent 协作、权限/沙箱和 Electron Desktop。构建轻量 agent benchmark adapter，接入公开 coding/terminal benchmark 的任务与 verifier，已记录 pass rate、耗时、patch stats、prompt size，并预留 token、工具调用、compact、permission 等 telemetry 字段，用于评估 agent framework 的工程效果。

## 可量化指标

当前可引用或继续补强的指标：

| 指标 | 当前证据 | 面试表达 |
|------|----------|----------|
| 测试规模 | 本地 Vitest 全量发现约 806 个 test files / 6962 个 tests；存在历史失败簇 | 项目采用风险驱动测试，覆盖权限、沙箱、session、resource、plugin、Desktop 等边界 |
| Task 工具 | `task-tool.test.ts` 34 tests | LLM 可维护任务树，支持 create/list/get/start/block/unblock/done/abandon/rename |
| Question 工具 | `question-tool.test.ts` 22 tests | 支持结构化澄清和阻塞问题 |
| Compact 回归 | `session-compactor.test.ts` 16 tests，`tool-output-pruner.test.ts` 9 tests | 压缩后保护当前轮工具输出、防抖、防止重要上下文丢失 |
| 权限模式 | `session-permission-mode.test.ts`、`session-permission-wrapper.test.ts`、Desktop plan-mode tests | 支持 auto/operate/ask/read_only/plan，工具执行按模式拦截 |
| 沙箱测试 | Windows/Linux/macOS sandbox policy 相关测试 | 跨平台处理 shell、路径、写入边界和网络策略 |
| Eval runner | `tests/eval-agent.test.mjs` 13 tests；local smoke `Passed 1/1`；Aider Polyglot `javascript-affine-cipher` 真实跑分 `Passed 1/1` | 已有轻量评测入口和报告产物，公开 benchmark adapter 与 Satori 非交互解题链路已跑通 |

注意：全量测试当前仍有历史失败簇，面试时不要说“全量全绿”。更稳妥的说法是：项目规模较大，当前正在把关键能力沉淀成 focused contract tests 和评测报告。

## 五个核心系统

### 1. 记忆系统

亮点：

- 区分 agent master prompt、per-session prompt 和 memory toggle，避免 session 配置污染全局 agent。
- 有 memory compile、ticker orchestration、prompt boundary 等测试。
- 目标是把“长期事实”和“当前任务上下文”分层，降低错误召回和记忆污染。

面试回答：

> 我没有把记忆简单做成 prompt 拼接，而是关注作用域和污染问题。全局 agent 记忆、session 开关、当前任务上下文必须分开，否则长任务中很容易把临时状态写成长期事实。

### 2. Plan 系统

亮点：

- Plan 是第五种 permission mode，不只是 UI 状态。
- Plan 模式下工具执行按权限策略拦截，避免“规划阶段偷偷改文件”。
- Desktop/WebSocket/Mobile 都同步 plan 状态，避免 UI 和 runtime 不一致。

面试回答：

> 我把 Plan 设计成权限模式，而不是提示词约定。这样系统可以在工具层保证 planning 阶段无副作用，用户从需求澄清切到执行时才放开写操作。

### 3. 上下文压缩

亮点：

- 支持 cache-preserving compaction、post-compact re-injection、tool output pruning。
- 修复过当前轮 tool result 被误剪、hard truncate 不计防抖等边界 bug。
- 通过 focused tests 覆盖 compact 边界。

面试回答：

> 对 coding agent 来说，compact 不是简单摘要，而是状态保真问题。我重点保护当前任务、最近工具结果、权限状态和 system/tool 契约，避免压缩后 agent 失去正在做什么。

### 4. 子 agent

亮点：

- 已有 subagent tool、run store、thread store、schema/policy tests。
- 目标是把子 agent 用在复审、并行调查、独立阅读模块，而不是开多个聊天窗口。
- 后续指标可记录 subagent review count、finding count、accepted finding count。

面试回答：

> 子 agent 的关键不是并发数量，而是上下文边界和结果结构化。我更关心它拿到的上下文是否正确、能否返回 evidence、主 agent 能否审查和合并结论。

### 5. 权限、安全与沙箱

亮点：

- 有 session permission wrapper、capability policy、ResourceIO、security principal、sandbox policy 等边界。
- Windows shell/sandbox 是重点，因为编码 agent 很容易在 Windows 上被路径、cmd、PowerShell 语义绊倒。
- 安全目标是 false allow 接近 0，同时降低正常开发操作的误拦截。

面试回答：

> 我把权限放在工具和 resource 边界，而不是只靠模型自觉。特别是 plan/read-only/ask 模式、ResourceIO authority、shell sandbox 都是为了让 agent 能在真实机器上运行。

## 评测系统

当前实现：

- `npm run eval:agent`
- `npm run eval:adapter:aider-polyglot`
- `npm run eval:solve`
- `npm run bench:pull`
- `npm run bench:aider-polyglot`
- manifest-driven suite
- local smoke fixture
- Aider Polyglot JavaScript lite manifest generation
- JSONL / summary JSON / Markdown report
- 已采集 pass rate、耗时、patch stats、prompt size；预留 token、tool calls、compact、permission、subagent telemetry 字段
- 支持 `oracle`、`noop`、`command` 三种执行模式

面试表达：

> 我没有从零造题库，而是做 benchmark adapter。公开 benchmark 的 verifier 仍然是权威，Satori 只负责执行 agent、收集 patch/test/trace/telemetry，避免自己出题自己判。

当前验证口径：

- 本地 smoke：`Passed 1/1`，用于证明 runner、workspace copy、oracle、verifier、report 产物链路。
- 单测：`tests/eval-agent.test.mjs` 13 tests passed，覆盖 runner、Aider adapter、带空格路径的 command agent 占位符、复用输出目录清理、agent 失败判定、setup 失败短路和 `eval:solve` prompt 构造。
- 公开 benchmark 接入：Aider Polyglot JavaScript lite manifest 已从外部 checkout 生成任务，并通过 Satori runner dry-run。
- 真实公开跑分：`npm run bench:aider-polyglot -- --skip-pull --limit 1` 跑通 `javascript-affine-cipher`，由公开题自带 `npm test` 判定 `Passed 1/1`。
- 边界：这不是大规模排行榜结果，目前是 lite public benchmark 的真实闭环样例。

## 面试官可能追问

### Q1：你这个项目和普通 ChatGPT wrapper 有什么区别？

A：普通 wrapper 主要是消息转发。Satori 的重点是 agent framework：session 生命周期、工具权限、上下文压缩、记忆作用域、子 agent、ResourceIO、安全沙箱和评测指标。它处理的是“长任务如何可靠完成”，不是“怎么调用模型”。

### Q2：为什么 Plan 要做成权限模式？

A：因为提示词约定不可靠。Plan 阶段的核心 invariant 是不能产生副作用，所以必须在工具层拦截写文件、命令执行等操作。这样即使模型想调用工具，也会被系统边界挡住。

### Q3：Compact 最难的地方是什么？

A：不是压小，而是压缩后仍然知道自己在干什么。当前任务、失败测试、最近工具输出、权限状态、system/tool 契约都可能影响下一步。项目里专门写了工具输出保护、hard truncate 防抖和 post-compact re-injection 的回归测试。

### Q4：记忆系统怎么避免污染？

A：用作用域隔离。长期 agent memory、session 状态、当前 turn context、workspace instruction 是不同层级。临时任务信息不能直接写成长期事实，session 关闭记忆也不能污染 agent master prompt。

### Q5：子 agent 有什么实际价值？

A：实际价值是复审和并行调查。比如主 agent 做实现，子 agent 独立读 diff 找边界 bug，返回 evidence。这样比单线程 agent 自信地犯错更可靠。

### Q6：你怎么证明这些设计有效？

A：一方面用 focused contract tests 保护关键边界；另一方面新增轻量 benchmark adapter，接公开 coding/terminal benchmark，在固定模型下记录 pass rate、耗时、patch stats、prompt size，并预留工具调用、token、compact、permission 等 telemetry 字段。当前已经用 Aider Polyglot JavaScript 小题跑通过一次真实闭环：Satori 解题、改代码、公开 verifier 判定通过。目标是评估 framework，而不是模型。

现在已经跑通的是 lite 真实链路：本地 smoke 1/1 通过，Aider Polyglot JavaScript 公开题 1/1 通过。下一步是扩大到 3-5 个任务，并接入 token/tool/compact telemetry。

### Q7：为什么不直接跑 SWE-bench？

A：SWE-bench 很有价值，但第一阶段太重，环境适配成本高。我的目标是简历和工程展示，所以先选 Aider Polyglot 和 Terminal-Bench 小子集，快速证明评测闭环。后续可以加 SWE-bench smoke 作为补充。

### Q8：项目最大的工程挑战是什么？

A：多层状态一致性。Desktop、CLI、server、session、agent、tool snapshot、permission mode、memory toggle 都会影响一次执行。很多 bug 不是算法问题，而是状态在某条路径上没同步。

### Q9：你会怎么继续优化？

A：先把 eval runner 接到真实公开任务，再把 usage ledger、tool trace、compact count、permission prompt count 接进报告。之后用报告指导优化，而不是凭感觉说某个功能更强。

## 简历 Bullet 版本

- Built Satori, a TypeScript/Node AI coding-agent CLI + Electron desktop app, with scoped memory, plan-mode permission control, context compaction, sub-agent review, ResourceIO, and cross-platform sandbox policies.
- Designed context compaction safeguards for long coding sessions, including current-turn tool-output protection, cache-preserving summaries, anti-thrashing counters, and post-compact state re-injection.
- Implemented a lightweight benchmark adapter that reuses public coding/terminal benchmark verifiers, with a one-command Aider Polyglot run that produced a real `Passed 1/1` public-task report.
- Added risk-driven contract/regression tests across task planning, permissions, sandboxing, session lifecycle, compaction, and Desktop/WebSocket synchronization.
