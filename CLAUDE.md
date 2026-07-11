# CLAUDE.md — 项目地图

## 我是谁

Satori —— 基于 Pi SDK 的 AI 编程助手 CLI，定位对标 Claude Code / OpenAI Codex CLI。

## 我在哪

- 代码：`core/`（引擎）、`lib/tools/`（工具）、`cli/`（入口）、`desktop/`（Electron UI）
- 当前分支：`git branch --show-current`（在 develop 或 iter/* 下工作）
- 技术栈：Node 24 + TypeScript + Pi SDK + SQLite

## 我要做什么

**当前任务**：完善 `doc/面试.md` — 面试材料准备。已暂停项目迭代开发。

**上一次做了什么**：最近的迭代在 `doc/iterations/` — 按日期文件名排序，读最新的几个

## 迭代文档标准

每个迭代完成后，必须在 `doc/iterations/` 下写记录文档。**这是面试和复盘的一手资料，不能敷衍。**

### 如果是改进现有方案
写四个部分：
1. **背景** — 详细描述了现有方案的架构、工作流、触发路径，让读者能理解"之前是什么样的"。
2. **问题分析** — 每个问题要有现象、根因、场景还原，不是一句话带过。分析**为什么**现有方案不行。
3. **参考实现** — 如果参考了其他项目（OpenCode、Claude Code 等），对比差异，说明借鉴了什么。
4. **改进设计与实现** — 每个改进要写：设计思路、为什么选这个实现方案、具体算法或代码逻辑、边界情况、踩过的坑（包括子 agent 复审发现的 bug）。
5. **改动文件清单 + 测试策略 + 设计权衡**

### 如果是全新功能
写清楚：设计思路、实现细节、架构决策、测试策略。不需要"之前 vs 之后"的对比。

### 格式参考
`doc/iterations/compaction-quality.md` 是标准模板。

---

## 协作铁律

### 动手之前
1. **先读后改** — 不是只读你要改的那个文件。读懂项目架构（文件间如何关联和耦合、是否符合模块化解耦）、读懂所有与改动相关的核心代码、参考现有的迭代过程（`doc/iterations/`）理解开发流程——理解代码工作流后才动手。
2. **先用脑子** — 复杂需求（多文件改动、架构决策、不确定方案）别直接写代码。你有两个工具 skills：
   - `compose:brainstorm` — 结构化需求澄清 + 方案对比，防止理解偏差
   - `grill-with-docs` — 对方案做追问式审查，同时产出 ADR 和词汇表
   - **动手前先问用户：要不要用 brainstorm/grill skills 协调好方案再写代码？**
3. **不降级** — 用最大努力解决，不主动降低方案，如果不得不降级就停下来询问我
4. **规划测试** — 实现不是一劳永逸的，很可能出错。设计完整的测试规划流程，参考 `tests/` 文件夹的现有测试模式和分层策略。

### 改动时
5. **奥卡姆剃刀** — 简单但有效，不引入不必要的复杂度
6. **精准改动** — 不改无关文件，不引入无关变化
7. **全面搜索** — 删/改模块时跨仓库 grep 所有引用（含 Desktop、测试文件），不遗漏任何调用点

### 改完之后
8. **跑验证才算完成** — `npm run typecheck`（0 errors）→ `npx vitest run tests/xxx.test.ts` → `npm test`（不引入新失败）
9. **终极验收** — `npm run build:renderer`（如果改了 Desktop）→ `npm start` 确认服务启动（14700 端口）。如果启动报错，读日志文件分析根因
10. **派子 agent 复审** — 调用 `compose:review` 或派遣子 agent 复审你的改动。重点查：是否少判断了几个文件的关联、是否忘了写前端/Desktop 逻辑、条件判断是否严谨。发现的问题继续修，修复同样遵循上述规则
11. **不凭感觉说"应该没问题"**

## Git 纪律

- **任何 git 提交、合并之前必须先问用户并得到确认。** 不准自行 commit / merge / push。
- 加新文件时只 stage 特定文件（`git add <文件>`），不准用 `git add -A` 或 `git add .`
- 迭代分支：`git checkout develop` → `git checkout -b iter/<name>` → 开发 → 验证 → 等用户确认 → 合回 develop
- 详细流程：`doc/git-工作流.md`

## 怎么测

- 单文件测试：`npx vitest run tests/xxx.test.ts`
- 全量测试：`npm test`
- 类型检查：`npm run typecheck`（含 3 个 tsconfig）
- Desktop 构建：`npm run build:renderer`
- 服务启动：`npm start`（确认 14700 端口正常，报错则查 log）
- 测试指南：`doc/测试指南.md`

## 出问题了

- 启动问题：`doc/启动指南.md` FAQ
- **杀进程前必须先问用户！** `Get-Process node,electron | Stop-Process` 会杀掉 Agent 自身进程。永远不要自行执行，提示用户手动操作。
- `npm start` 报错 → 读日志文件 + 结合代码分析根因