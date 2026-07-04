# 模块分析 + 迭代计划重构

- **日期**：2026-06-30 ~ 2026-07-01
- **分支**：`iter/brand-satori` → `iter/remove-channels`
- **目标**：调研待剥离模块 + 全代码库功能评估 + 重构迭代计划

### 模块调研（5 个）
调研 `core/media/`、`core/speech-recognition/`、`lib/channels/`、`lib/bridge/`、`core/computer-use/`，每个模块记录功能描述、影响面、测试文件清单。

### 代码库功能调研（8 方向）
| 方向 | 成熟度 | 结论 |
|------|--------|------|
| Plan 工作流 | ⚠️ 半成品 | plan = read_only 别名 |
| 权限设计 | ✅ 完整 | 4 层防护 |
| 上下文压缩 | ✅ 完整 | 多策略自动选择 |
| 子 agent | ✅ 完整 | 缺 approval forwarding |
| CLI | ✅ 完整 | 缺 mode flag |
| 自检纠错 | ❌ 空白 | 仅一行 prompt |
| 自学习 | ❌ 空白 | 基础设施就绪 |
| Loop 工程 | ⚠️ 半成品 | JS 编排非 AI 原生 |

重构 `docs/迭代计划.md` 为双枝干：模块剥离 + 核心功能迭代。自学习方向扩展为 7a-7e 子方向。

### 关键文件
`lib/memory/`、`lib/tools/subagent-tool.ts`、`lib/sandbox/policy.ts`、`core/session-compactor.ts`、`core/session-permission-mode.ts`、`cli/chat.ts`、`lib/tools/workflow-tool.ts`
