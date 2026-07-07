# Compact Red Tests Fix

> 分支：`iter/compact-red-fixes`  
> 日期：2026-07-07  
> 范围：只修复复审阶段已经写出 RED 测试并确认失败的 4 个问题；不改动更重的 compact 后 system prompt / cache prefix 重新注入设计。

---

## 一、背景

`compaction-quality.md` 迭代为上下文压缩增加了三类保护：

1. `tool-output-pruner` 在 LLM 调用或 compact 前修剪旧轮次的大型 `toolResult`，避免旧工具输出挤占窗口。
2. `runCachePreservingCompactionForSession()` 在 bypass compact 路径上生成 cache-preserving summary，必要时 hard truncate，并用 `_compactionAttempts` 防止反复压缩。
3. Desktop 侧通过 WebSocket 同步 session 权限模式，使前端按钮、输入区和计划模式事件跟随后端状态。

这次复审不是重做 compact 架构，而是检查前一轮实现里的边界细节。复审阶段先新增 4 个主回归测试，分别证明：当前轮工具输出会被误剪、hard truncate 分支跳过防抖计数、`task` 工具没有透传 `event_summary`、Desktop 收到 `permission_mode: plan` 时不同步 store。子 agent 复审后又追加 1 个 store 层回归，覆盖新会话默认权限等不经过 WebSocket handler 的本地广播路径。

---

## 二、问题分析

### 2.1 当前轮 tool result 被误剪

**现象**：当消息里只有当前一轮用户输入和一个超大 `toolResult` 时，`pruneToolOutputs()` 会把这个 `toolResult` 替换为 `[工具输出已省略]`。

**根因**：算法逆向扫描最近 N 个 user turn。默认 `protectedTurns = 2`，但如果当前 compaction 边界之后不足 2 个 user turn，`cutoffIndex` 保持为 `messages.length`。第二阶段从 `cutoffIndex - 1` 开始扫描，等价于把当前轮也纳入候选。

**影响**：用户刚让 agent 读取的大文件可能在同轮内被删掉，后续模型调用看不到刚读取的内容，属于上下文正确性问题。

### 2.2 hard truncate 后不计入防抖

**现象**：cache-preserving 请求超窗时会走 hard truncate，但如果截断后上下文仍然接近满窗，`_compactionAttempts` 不会递增。

**根因**：post-compaction usage check 只放在 LLM summary 分支。hard truncate 分支 `appendCompactionResultToSession()` 后直接返回，绕过了后置检查。

**影响**：极端大尾部内容可能反复触发 hard truncate，防抖机制名义存在但覆盖不完整。

### 2.3 Task `event_summary` 契约断开

**现象**：`task` 工具 schema、说明和示例都声明 lifecycle 操作支持 `event_summary`，但 `block` 后 `get` 只看到 `"last_event": "blocked"`。

**根因**：`TaskRegistry` 的 `startLLMTask` / `blockLLMTask` / `unblockLLMTask` / `doneLLMTask` / `abandonLLMTask` 已支持 `{ eventSummary }`，但 `lib/tools/task-tool.ts` 执行分支没有把 `op.event_summary` 传下去。

**影响**：LLM 写任务状态时丢失关键原因，后续恢复或复盘任务树时信息变薄。

### 2.4 `permission_mode: plan` 前端同步漏白名单

**现象**：后端广播 `{ type: "permission_mode", mode: "plan" }` 时，Desktop store 不会更新为 `plan`。

**根因**：`ws-message-handler.ts` 的权限模式白名单仍是 `auto | operate | ask | read_only`，漏了后来加入的第五模式 `plan`。Mobile 初始化路径也有同样的 `isSessionPermissionMode()` 漏项。子 agent 复审还发现 `session-actions.ts` 的本地事件广播路径只把 `read_only` 视为 enabled，导致新会话默认值等非 WS 路径仍可能广播 `{ enabled: false, mode: "plan" }`。

**影响**：用户直接从前端按钮切 plan 时通常不明显，因为本地状态已先更新；但 session restore、远程端、后端规范化事件等路径会出现后端与 UI 状态不一致。

---

## 三、参考实现

本次没有引入新的外部参考实现，沿用上一轮 `compaction-quality.md` 已确定的设计：

- 工具输出修剪遵循 OpenCode 风格的“保护最近用户轮次 + 只修剪旧工具输出”原则。
- compact 防抖沿用上一轮设计的“压缩后仍超过 85% 窗口则累计 `_compactionAttempts`”原则。
- 权限模式同步沿用项目现有 `SessionPermissionMode = auto | operate | ask | read_only | plan` 类型定义，修正前端局部白名单与类型定义不一致。

---

## 四、改进设计与实现

### 4.1 `pruneToolOutputs()` 保护不足 N 轮的当前上下文

第一阶段扫描结束后，如果 `userTurnsLeft > 0`，说明当前 compaction 边界之后不足 `protectedTurns` 个 user turn。此时直接返回原消息数组，不进行任何修剪。

这个实现保持了原算法的意图：只有在确认找到保护边界后，边界之前的旧内容才可被修剪；如果边界不存在，默认保护全部当前上下文。

### 4.2 统一 compact 后置防抖检查

将原 LLM summary 分支里的 usage check 提取为 `updateCompactionAttemptsAfterCompaction(session)`，并在 hard truncate 分支返回前也调用。

该 helper 仍保持原有容错策略：

- `session.getContextUsage?.()` 不存在或抛错时忽略，不影响 compact 结果。
- `contextWindow <= 0` 时不更新计数。
- `tokens / contextWindow > 0.85` 时递增，否则归零。

### 4.3 Task lifecycle 透传 `event_summary`

`task` 工具执行 `start` / `block` / `unblock` / `done` / `abandon` 时，统一传入 `{ eventSummary: op.event_summary }`。

没有改 registry、状态机或输出格式；`get` 已经会把 `_llmLastEventKind` 和 `_llmLastEventSummary` 组合成 `last_event`。

### 4.4 前端 plan 权限模式同步

Desktop WebSocket handler 的 `syncSessionPermissionMode()` 接受 `plan`，并增加 `isPlanModeEnabled()`，让 `read_only` 与 `plan` 都在 `hana-plan-mode` 事件中表现为 enabled。

Mobile 初始化路径同步补齐 `plan` 白名单，并把 `plan` 视为 enabled。这样 session 列表/新会话创建返回 `permissionMode: plan` 时，移动端也不会丢状态。

子 agent 复审后又补了一条 Desktop 内部路径：`session-actions.ts` 的 `emitSessionPermissionMode()` 原本只把 `read_only` 视为 plan-mode enabled。这个路径不走 WebSocket handler，主要覆盖新会话草稿加载默认权限、session 切换和创建成功后的本地事件广播。现在统一把 `read_only` 与 `plan` 都作为 enabled，并新增 store 层回归测试覆盖 `permissionMode: plan` 默认值。

---

## 五、改动文件清单、测试策略与权衡

### 改动文件

| 文件 | 说明 |
|------|------|
| `core/tool-output-pruner.ts` | 当前边界不足 protected turns 时保护全部当前上下文 |
| `core/session-compactor.ts` | hard truncate 与 LLM summary 共用 compact 后置防抖检查 |
| `lib/tools/task-tool.ts` | lifecycle 操作透传 `event_summary` |
| `desktop/src/react/services/ws-message-handler.ts` | Desktop 接受并广播 `plan` 权限状态 |
| `desktop/src/react/mobile/mobile-init.ts` | Mobile 初始化权限白名单补齐 `plan` |
| `desktop/src/react/stores/session-actions.ts` | 新会话/切换会话等本地路径广播 `plan` enabled |
| `tests/tool-output-pruner.test.ts` | 新增当前轮保护回归 |
| `tests/session-compactor.test.ts` | 新增 hard truncate 防抖回归 |
| `tests/task-tool.test.ts` | 新增并扩展 `start/block/unblock/done/abandon` 的 `event_summary` 持久化回归 |
| `desktop/src/react/__tests__/app-init.test.ts` | 新增 `permission_mode: plan` WS 同步回归 |
| `desktop/src/react/__tests__/stores/session-actions.test.ts` | 新增新会话默认 `plan` 权限事件回归 |

### 测试结果

- `npx vitest run tests/task-tool.test.ts desktop/src/react/__tests__/stores/session-actions.test.ts`：99 passed。
- `npx vitest run tests/tool-output-pruner.test.ts tests/session-compactor.test.ts tests/task-tool.test.ts desktop/src/react/__tests__/app-init.test.ts desktop/src/react/__tests__/stores/session-actions.test.ts`：137 passed。
- `npm run build:renderer`：通过。
- `npm run typecheck`：失败于既有 `lib/memory/memory-search.ts` 两处 TS2554，当前分支未修改该文件。
- `npm test`：26 failed / 779 passed / 1 skipped test files；60 failed / 6892 passed / 10 skipped tests。失败集中在既有环境与历史问题，包括损坏的 `tests/config-loader.test.ts` 字符串、缺失 `lib/conversations/agent-phone-projection.ts`、Windows symlink 权限、phone/channel 相关旧契约、`python3` 缺失、`E:\tmp` 写权限等。当前新增和相关 compact/task/WS/store 测试均通过。

### 复审修正

子 agent 复审指出两处 P2：一是 Desktop store 本地广播路径漏把 `plan` 视为 enabled；二是 task tool 的红测只覆盖 `block`，不足以证明五个 lifecycle 分支都透传摘要。已分别补 `session-actions.ts` 实现与测试，并把 `tests/task-tool.test.ts` 扩展为覆盖 `start`、`block`、`unblock`、`done`、`abandon` 五条路径。

### 设计权衡

- 本轮不修 compact 后 system prompt / cache prefix 重注入。该问题仍需要 coordinator/engine 级方案设计，不能混在小修里。
- 不扩大修复到 phone/channel 等全量测试失败簇。它们与本次红测无关，且涉及更大模块边界。
- `plan` 同步虽不是 compact 本体，但已经有红测证明是权限模式契约漏洞，修复为一行级别白名单补齐，风险低。
