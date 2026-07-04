# Plan 模式 — 第五模式 + 系统提示注入 + 全工具拦截

- **日期**：2026-07-03
- **分支**：`iter/plan-workflow`
- **目标**：在现有 4 个权限模式上增加"规划模式"——agent 先提问、输出计划，确认后才能执行

### 设计决策
- Plan 作为第五个模式选项（非 toggle），通过现有权限模式切换机制驱动
- 系统提示强调 question 工具主动提问，禁止猜测用户意图
- Plan 模式下工具限制等同于只读模式

### 实现
**服务端：** `SESSION_PERMISSION_MODES.PLAN` + 8 个 handler 函数全部 `isReadOnlyPermissionMode()` 拦截 + `buildSystemPrompt` 注入 Plan 专用提示
**Desktop：** PlanModeButton 第 5 选项 + clipboard 图标 + i18n + 2 处 store Set 加 `'plan'`

### 调试经验
**Bug 1：Desktop 点击无响应** — `session-slice.ts`/`session-actions.ts` 本地 Set 只认 4 个值，`'plan'` 被静默回退
**Bug 2：Plan 模式仍能执行** — 8 个 handler 函数各自写死 `mode === READ_ONLY`，不认识 `'plan'`。agent 调 bash 走 `classifyExecCommandAction`，fallthrough 到 `allow`
**Bug 3：编辑工具误删代码** — 在大文件中 `edit` 时 old_string 边界不精确，误删相邻代码块

### 验证
- `npx tsc --noEmit` — 0 errors ✅
- `npx vitest run tests/session-permission-mode.test.ts` — 11/11 pass ✅
- `npm test` — 无新增失败（781 pass）✅
- 端到端：提问 ✅ block ✅ 切回执行 ✅
