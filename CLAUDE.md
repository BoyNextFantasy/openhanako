# Satori — AI 编程助手

## 这是什么
基于 HanaAgent/Hanako 改造的 CLI 编程助手，定位对标 Claude Code / OpenAI Codex CLI。

## 核心架构
```
cli/        — CLI 入口（主要使用方式）
server/     — Hono 服务端
core/       — 引擎核心（agent-manager, engine, 等）
lib/        — 库（memory, skills, tools, sandbox）
desktop/    — Electron 桌面（可选 UI）
doc/        — 使用文档
docs/       — 迭代计划与记录
```

## 基础技术栈
- Node 24 + TypeScript
- Hono + `@hono/node-server`
- Electron（可选桌面端）
- Pi SDK（`@mariozechner/pi-*`）— AI 运行时底层
- SQLite（better-sqlite3）— 数据持久化

## Git 工作流

### 分支结构
```
main            — 只同步官方上游代码，永远不直接修改
develop         — 主开发分支，所有迭代的合集，永远处于可运行状态
iter/<迭代名>    — 每轮迭代的独立工作分支，从 develop 分出
```

**`main` 只用来从 `upstream` 同步官方 HanaAgent 代码，从不直接写代码。**

**`develop` 是个人改动的全集**：两条迭代分支完成 → 内容汇总到 develop。后续所有新迭代从 develop 分出。

如果迭代分支开发成功 → 合并回 `develop`（或 squash 成一个 commit）。如果出问题 → 直接丢弃 `iter/xxx`，`develop` 不受影响。

### 每次迭代流程
1. **开分支** — `git checkout develop` → `git checkout -b iter/<迭代名>`
2. **开发** — 在迭代分支上改动
3. **用户审核** — Agent 告知改动清单，用户决定是否提交
4. **合并/存档** — 成功后合并回 develop → 推送 `origin/develop`；`iter/*` 可选推送存档

### 推送
- **`develop` 每次有合并/提交后都推送到 `origin/develop`**，保持远端即最新合集
- `iter/*` 可选推送（`origin/iter/<迭代名>`）存档，非必须
- **用户决定何时提交和推送**，Agent 不主动 commit / push

## AI 协作规则（每个 Agent 必须遵守）

### 协作铁律
1. **不降级** — 用最大努力解决用户要求，不允许主动降级方案
2. **直到不能为止** — 持续尝试，只有当完全做不到了才停下来，另寻他法并询问用户是否实现
3. **奥卡姆剃刀** — 修改代码以最简单、最有效的方案为目标

### 每次会话开始前
1. 确认当前在正确的迭代分支（非 main；develop 和 iter/* 都可以工作）
2. 读 `docs/迭代计划.md` — 了解当前优先级和待办
3. 读 `docs/迭代记录.md` — 了解已完成的工作
4. 在 CLAUDE.md 声明"本次迭代目标"

> **新功能/大改动前** — 先 invoke `brainstorming` skill 出设计文档，再用 `writing-plans` skill 拆实现计划。如果方案本身不清晰，可先用 `grill-with-docs` skill 做结构化追问并产出 ADR/词汇表。

### 测试须知（重要！）
项目已有 **802 个测试文件、6874 个测试**，用 vitest 运行。不要自己猜测试方法，先读 `tests/README.md` 和 `doc/测试指南.md`。

**不要这样做验证：** 启动服务器 → curl API → 人工观察。这既慢又不可靠，而且工具逻辑埋在 LLM 调用链里根本测不到。

**正确的做法：**
- `npx vitest run tests/xxx.test.ts` — 单文件先跑
- `npx tsc --noEmit` — 然后类型检查
- `npm test` — 最后全量回归

不要跳过第一步直接上全量。

### 每次改代码时
1. 先读后改 — 理解现有逻辑再动手。尤其要读 `tests/` 下对应的测试文件，了解测试模式
2. 不改的目录不做任何修改（除非迭代计划指定）
3. 精准改动，不引入无关变化
4. 不额外加注释
5. **全面搜索** — 删除/修改模块时，跨仓库 grep 所有引用（含 Desktop、测试文件、CSS 注释），不遗漏任何调用点

> **遇到 bug 或测试失败** — 先 invoke `systematic-debugging` skill 找根因，不要猜修。

### 每次改完后
0. **先代码审查再写文档** — 任何改动完成后，先派子 agent 做代码审查（`requesting-code-review` skill），修复所有 Critical + Important 问题后，才能写迭代记录/迭代计划。不要让未经审查的改动流入文档。
1. 更新 `docs/迭代记录.md`（日期、分支、改动、验证）
2. 更新 `docs/迭代计划.md` 进度（打勾已完成项）
3. **跑验证命令** — 按改动类型执行对应检查，拿到输出结果后才算完成：

   | 改动范围 | 必跑命令 |
   |---------|---------|
   | 任何代码改动 | `npm run typecheck`（含 3 个 tsconfig） |
   | 改了 Desktop/前端 | 额外跑 `npm run build:renderer` |
   | 所有改动 | `npm start` 确认服务能启动（14700 端口） |
   | 改动了工具/agent/核心逻辑 | 额外跑 `npm test` |

4. 列出改动清单，等待用户决定提交或继续

> **合入阶段** — 全部测试通过后，invoke `verification-before-completion` skill 做最终验证（确保验证命令确实跑过并看到输出），再用 `finishing-a-development-branch` skill 选择合入/推 PR/保留/丢弃。

> 如果不知道跑什么，先查 `package.json#scripts` 或问用户。**跑完验证拿到实际输出再报告"完成"**，不要凭感觉说"代码应该没问题"。

### 品牌命名
- 项目名：Satori
- npm 包名：`satori-cli`
- 环境变量：`SATORI_HOME`
- CLI 命令：`satori`
- 包内保留 `hanako` / `HANA` 的代码引用不改（底层沿用原实现）

## 关键文件索引
| 文件 | 作用 |
|------|------|
| `cli/entry.ts` | CLI 主入口 |
| `server/index.ts` | 服务端启动 |
| `core/engine.ts` | 总引擎 |
| `lib/tools/` | 工具目录（从这里加功能） |
| `doc/启动指南.md` | 首次运行指引 |
| `doc/git-工作流.md` | Git 协作流程 |
| `docs/迭代计划.md` | 当前 TODO |
| `docs/迭代记录.md` | 迭代历史 |
| `doc/测试指南.md` | 测试方法论与最佳实践 |
| `tests/README.md` | 官方测试分层策略 |

## 当前迭代目标
`iter/task-tree` — Task 树：TaskRegistry 增加 parent_task_id + LLM 可见 task 工具
