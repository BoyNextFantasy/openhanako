# 删除 lib/channels/ 全部代码 + 端口改 14700

- **日期**：2026-06-30 ~ 2026-07-01
- **分支**：`iter/remove-channels`
- **目标**：删除多 Agent 群聊系统（channels + DM + agent-phone），约 66 个文件，~14k 行；改默认端口 14500→14700

### 什么是 channels
多 Agent 群聊系统。Agent 之间创建频道、发消息、@提及，含轮询投递和 phone session。包含 `channel-ticker`、`ChannelRouter`/`DmRouter`、`channel-tool`/`dm-tool`、Desktop 频道面板等。

### 改动（3 轮）
- **Round 1**：删除 36 个源文件（lib/channels, tools, hub, server/routes, lib/conversations），修复 15 个引用
- **Round 2**：删除 19 个测试文件
- **Round 3**：Desktop 清理 11 个文件（移除频道标签页、频道面板、WebSocket 事件处理）
- **补删**：desktop 残留清理（use-sidebar-resize, MainContent, MobileApp）+ 端口 14500→14700（core/server-network-config, desktop/main.cjs, 27 测试文件批量替换）

### 验证
- `npm run typecheck`：0 错误 ✅
- `git diff --stat`：66 文件，22 insertions，14161 deletions
- `npm run build:renderer`：通过 ✅
- 代码残留、端口残留：均为 0 ✅
