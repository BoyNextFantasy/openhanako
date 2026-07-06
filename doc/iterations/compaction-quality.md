# 上下文压缩质量优化

> 分支：`iter/compaction-quality` → `develop`
> 日期：2026-01-06

## 背景

Satori 已有 cache-preserving compaction（三层防护：L1 tool_result 截断、L2 reserveTokens 提前触发、L3 预判+硬截断），但存在三个问题：

1. **压缩后丢上下文**：LLM 生成摘要可能遗漏 CLAUDE.md 约束、记忆内容等。多次压缩后摘要层层衰减。
2. **不必要的 LLM 压缩**：旧轮次的大 tool_result 文本直接进入 LLM 摘要，触发昂贵调用。
3. **死循环风险**：压缩后上下文仍满时无限重试。

## 改进

参考 OpenCode 和 Claude Code 的设计，在现有压缩管道内落地三项改进：

### P0 — 压缩后重新注入持久上下文

- **机制**：压缩完成后，从磁盘重读 CLAUDE.md、记忆文件、技能，重建 system prompt
- **效果**：无论压缩多少次，持久指令永远是最新版本，不受 LLM 摘要衰减影响
- **注入点**：`session_compact` 事件 handler（覆盖所有压缩路径：自动触发、模型切换、手动 /compact）

### P1a — 工具输出修剪

- **机制**：逆向扫描对话，保护最近 2 轮，清除旧轮次 tool_result 文本（40K token 保护预算，至少省 20K 才执行）
- **效果**：很多情况下修剪后无需 LLM 摘要，减少不必要压缩
- **注入点**：`context` 事件（常规 LLM 调用前）+ `session_before_compact` 事件（压缩准备前）

### P1b — 防抖动

- **机制**：压缩后检查窗口占用，超 85% 则计数器 +1，累�� 3 次后拒绝再压缩
- **效果**：防止极端场景下压缩死循环

## 改动文件

| 文件 | 改动 |
|------|------|
| `core/session-compactor.ts` | P1b 防抖 guard（+30 行） |
| `core/tool-output-pruner.ts` | **新建** 修剪算法纯函数（85 行） |
| `lib/extensions/tool-output-prune-ext.ts` | **新建** Pi SDK 扩展（61 行） |
| `lib/extensions/compaction-guard-ext.ts` | P0 `session_compact` handler（+12 行） |
| `server/index.ts` | P1a 注册 + P0 回调（+20 行） |
| `tests/tool-output-pruner.test.ts` | **新建** 8 个测试（111 行） |

## 验证

- 75 个相关测试全部通过
- 全量 6957 测试，44 个已有失败（与改动无关），无新回归
- 子 agent 复审确认逻辑正确性
