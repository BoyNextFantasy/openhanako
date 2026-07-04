# Task 树 — 持久化树形任务工具

- **日期**：2026-07-03
- **分支**：`iter/task-tree`
- **目标**：实现对标 MiMoCode 的持久化树形任务工具（5 状态生命周期 + 9 操作 + 自动 ID）

### 实现
- `lib/task-registry.ts` — 新增 11 个 LLM 任务方法（+141 行）：create/start/block/done/abandon/rename/list/get + 循环检测 + 自动 ID（T1/T1.1/T1.2）
- `lib/tools/task-tool.ts` — 新建 205 行，9 操作 discriminated union
- `tests/task-tool.test.ts` — 新建 337 行，33 测试
- 注册：`core/agent.ts` + `shared/tool-categories.ts` + `core/session-permission-mode.ts`

### 审查修复
- event_summary 未持久化 → `_llmLastEventKind` + `_llmLastEventSummary`
- start 非幂等 → 同 owner 重复 start no-op
- 重复测试/方法 → 清理

### 验证
- `npx tsc --noEmit` — 0 errors ✅
- `npx vitest run tests/task-tool.test.ts` — 33/33 pass ✅
- `npm test` — 无新增失败 ✅
- 端到端：agent 确认看到 task 工具全部 9 操作 ✅

### 已知限制
- 无 session 隔离、无自动归档、无 promptGuidelines
