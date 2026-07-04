# Question 工具 — 完整实现

- **日期**：2026-07-01 ~ 2026-07-02
- **分支**：`iter/mode-switching`
- **目标**：实现 Satori 版 Question 工具（LLM 结构化提问，仿 OpenCode 的 Deferred 模式）

### 设计
- 仿 OpenCode：QuestionService（`lib/question/question-service.ts`），Deferred 模式挂起等待
- Desktop 用 Modal 弹窗渲染，CLI 一期不做
- 与 Agent 对话中直接提问并存

### 实现（8 个新建 + 11 个修改）
- **核心**：`lib/question/types.ts` + `question-service.ts` + `lib/tools/question-tool.ts`
- **注册**：`core/engine.ts`（emitEvent）、`shared/tool-categories.ts`、`core/session-permission-mode.ts`、`core/agent.ts`
- **Server**：`server/routes/chat.ts` + `server/ws-scope.ts`
- **Desktop**：`QuestionModal.tsx` + `chat-types.ts` + `session-slice.ts` + `ws-message-handler.ts` + `App.tsx`
- **i18n**：en.json + zh.json

### 代码审查修复（5 Critical + 1 Important）
| 问题 | 修复 |
|------|------|
| Dismiss 发 reply([]) 非 reject | 改发 question_reject → `reject()` |
| canConfirm 允许未答 | `every(q.multiple OR answers[i] > 0)` |
| entries[0] 多 session 竞争 | 按 currentSessionPath 匹配 |
| reply() 不校验长度 | 长度不匹配返回 false |
| 无超时 | 5 分钟 auto-reject |
| 硬编码英文 | t() + locale JSON |

### 端到端修复
- Modal sessionPath key 不匹配 → `sessionScopedValue()`
- React Hooks 顺序不一致 → 统一在 return 前调用
- signal.aborted 预检查 → 移除，只监听 future abort
- Desktop 构建 EPERM → 手动清理 dist-renderer

### 美化
- 移除全屏 Overlay → flow 布局
- CSS Module 对齐项目设计 token
- 自定义文本输入 + 互斥逻辑

### 验证
- `npx vitest run tests/question-tool.test.ts` — **22/22 pass** ✅
- `npx tsc --noEmit` — 0 errors ✅
- `npm run build:renderer` — 通过 ✅
- 端到端：石头剪刀布弹窗正常 ✅ 新对话无错误 ✅
