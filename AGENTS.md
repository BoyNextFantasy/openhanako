# AGENTS.md — 项目地图

## 我是谁

Satori —— 基于 Pi SDK 的 AI 编程助手 CLI，定位对标 Claude Code / OpenAI Codex CLI。

## 我在哪

- 代码：`core/`（引擎）、`lib/tools/`（工具）、`cli/`（入口）、`desktop/`（Electron UI）
- 当前分支：`git branch --show-current`（在 develop 或 iter/* 下工作）
- 技术栈：Node 24 + TypeScript + Pi SDK + SQLite

## 我要做什么

**当前活跃迭代**：见 `doc/迭代计划.md`

**上一次做了什么**：最近的迭代在 `doc/iterations/` — 按日期文件名排序，读最新的几个

## 协作铁律

### 动手之前
1. **先读后改** — 理解现有逻辑再动手；先读 `tests/` 下对应测试文件
2. **先用脑子** — 复杂需求（多文件改动、架构决策、不确定方案）别直接写代码。你有两个工具：
   - `compose:brainstorm` — 结构化需求澄清 + 方案对比，防止理解偏差
   - `grill-with-docs` — 对方案做追问式审查，同时产出 ADR 和词汇表
   - **动手前先问用户：要不要用 brainstorm/grill 协调好方案再写代码？**
3. **不降级** — 用最大努力解决，不主动降低方案

### 改动时
4. **奥卡姆剃刀** — 最简方案
5. **精准改动** — 不改无关文件，不引入无关变化
6. **全面搜索** — 删/改模块时跨仓库 grep 所有引用（含 Desktop、测试文件）

### 改完之后
7. **跑验证才算完成** — `npm run typecheck`（0 errors）→ `npx vitest run tests/xxx.test.ts` → `npm test`（不引入新失败）→ `npm start`（确认服务启动）
8. **不凭感觉说"应该没问题"**

## Git 纪律

- **任何 git 提交、合并之前必须先问用户并得到确认。** 不准自行 commit / merge / push。
- 加新文件时只 stage 特定文件（`git add <文件>`），不准用 `git add -A` 或 `git add .`
- 迭代分支：`git checkout develop` → `git checkout -b iter/<name>` → 开发 → 验证 → 等用户确认 → 合回 develop
- 详细流程：`doc/git-工作流.md`

## 怎么测

- 单文件测试：`npx vitest run tests/xxx.test.ts`
- 全量测试：`npm test`
- 类型检查：`npm run typecheck`（含 3 个 tsconfig）
- 测试指南：`doc/测试指南.md`

## 出问题了

- 启动问题：`doc/启动指南.md` FAQ
- **杀进程前必须先问用户！** `Get-Process node,electron | Stop-Process` 会杀掉 Agent 自身进程。永远不要自行执行，提示用户手动操作。
