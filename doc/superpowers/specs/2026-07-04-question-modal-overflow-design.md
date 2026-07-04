# Question Modal 溢出修复 — 设计文档

- **日期**: 2026-07-04
- **类型**: Bug 修复
- **影响范围**: Desktop 仅限

## 问题

AI 一次性问多个问题时，QuestionModal 的 panel 高度超出视口，底部的 Confirm / Dismiss 按钮不可见。

## 根因

`.panel` 无高度约束（无 `max-height` / `overflow`），在正常文档流中随内容撑高，底部 actions 被推出视口外。

## 方案 A（选定）

### 改动

**`QuestionModal.module.css`**:
- `.panel`: 改为 `display: flex; flex-direction: column; max-height: 70vh; overflow: hidden;`
- 新增 `.questionsScroll`: `overflow-y: auto; flex: 1;`

**`QuestionModal.tsx`**:
- 在 `.panel` 内将 questions map 包裹在 `<div className={s.questionsScroll}>` 中
- `.actions` 保持同级，利用 flexbox 固定在底部

### 效果

- questions 区域超出时独立滚动
- Confirm / Dismiss 按钮始终可见
- 背板 `.backdrop` 不受影响

### 不涉及

- `question-service.ts` / `question-tool.ts` / `server/routes/chat.ts` — 0 改动
- 测试不变（纯 UI 修复，无逻辑变更）
- i18n / types / stores — 0 改动

## 验证

1. `npm run build:renderer` — 构建通过
2. `npx vitest run tests/question-tool.test.ts` — 现有测试通过
3. 手动确认：发起多问题 → 按钮可见且操作正常
