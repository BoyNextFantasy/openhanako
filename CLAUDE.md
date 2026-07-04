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

## 怎么改代码

- 加工具：改 `core/agent.ts` + `shared/tool-categories.ts` + `core/session-permission-mode.ts`
- 加模式：改 `core/session-coordinator.ts` + `core/session-permission-mode.ts`
- 改记忆：改 `core/session-compactor.ts` + `lib/memory/fact-store.ts`

### 改代码的铁律

1. **先读后改** — 理解现有逻辑再动手；先读 `tests/` 下对应测试文件
2. **不降级** — 用最大努力解决，不主动降低方案
3. **奥卡姆剃刀** — 最简方案
4. **精准改动** — 不改无关文件，不引入无关变化
5. **全面搜索** — 删/改模块时跨仓库 grep 所有引用
6. **跑验证才算完成** — 不凭感觉说"应该没问题"

## 怎么测

- 单文件测试：`npx vitest run tests/xxx.test.ts`
- 全量测试：`npm test`
- 类型检查：`npm run typecheck`（含 3 个 tsconfig）
- 测试指南：`doc/测试指南.md`

## 怎么提交

- 迭代分支：`git checkout develop` → `git checkout -b iter/<name>` → 开发 → 验证 → 提交 → 合回 develop
- Git 流程：`doc/git-工作流.md`

## 出问题了

- 启动问题：`doc/启动指南.md` FAQ
- **杀进程前必须先问用户！** `Get-Process node,electron | Stop-Process` 会杀掉 Agent 自身进程。永远不要自行执行，提示用户手动操作。
