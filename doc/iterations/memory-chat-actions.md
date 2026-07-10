# 对话内记忆快捷操作：置顶 / 不再记住

> 分支：`iter/memory-chat-actions`
> 日期：2026-07-10

---

## 一、背景：现有记忆管理路径

Satori 已经具备一套可用的记忆管理能力：

- 长期事实会被整理进 agent 的 compiled memory，并通过 system prompt 注入给模型。
- 设置页的 `设置 -> 助手 -> 记忆` 已经支持查看当下记忆、查看全部记忆、清空记忆和置顶记忆。
- 实验项 `memory.editable_facts` 开启后，compiled memory 中的 facts 区域会变成可编辑文本；today/week/longterm 摘要仍保持只读。
- 后端已有两个关键链路：
  - `GET /api/memories/compiled?agentId=...`：读取当前会注入 prompt 的 compiled memory，并返回 `sections.facts`。
  - `PUT /api/memories/compiled/facts?agentId=...`：保存 editable facts，并重建 `memory.md`。
  - `GET/PUT /api/agents/:agentId/pinned`：读取和覆盖 `pinned.md`，用于置顶记忆。

这说明本次迭代不需要重新设计 FactStore schema，也不需要新增数据库级单条删除接口。更合适的方向是把已有能力前移到聊天区，让用户在发现 Satori 记错、记多、需要强调某条事实时，可以直接在对话里处理。

## 二、问题分析

### 2.1 入口太深

现有完整管理入口在设置页。它适合批量维护，但不适合用户正在对话时快速纠正。典型场景是用户问：

```text
你现在记住了我哪些事？
```

如果 Satori 展示了某条不该保留的事实，用户还要离开聊天区、打开设置、进入助手、再进入记忆管理。这会打断对话流，也降低用户主动纠正记忆的概率。

### 2.2 模型不应该替用户执行记忆删除

记忆删除和置顶是用户数据管理行为，不能交给模型自己判断后自动执行。v1 采用前端可交互卡片：模型仍然只是回答问题，真正的 `置顶` 和 `不再记住` 必须由用户点击触发。

### 2.3 不适合重做一套复杂记忆后台

项目里已有 FactStore、compiled memory、pinned memory、editable facts。若为了对话区快捷操作新增一套 FactStore 单条删除 API，会扩大边界：需要处理事实 id、来源、摘要同步、搜索和冲突。v1 的目标是轻量可用，所以只操作最终会进入 prompt 的 editable facts 文本。

## 三、参考实现与取舍

本次没有照搬外部项目，而是沿用 Satori 现有设置页能力：

- `置顶` 复用 `pinned.md` 保存链路，和设置页置顶记忆保持一致。
- `不再记住` 复用 editable facts 保存链路，保存后由后端重建 `memory.md`。
- 卡片只在用户主动询问记忆时出现，不在每次记忆更新后自动弹出，避免聊天区被管理 UI 打扰。

关键取舍：

- 不新增顶级“记忆”设置 Tab，因为完整管理入口已经在 `设置 -> 助手 -> 记忆`。
- 不新增 FactStore schema，不做 id 级删除。
- 不依赖模型调用 question/task/tool；用户发送记忆查询意图后，前端直接渲染卡片，避免模型漏调用工具导致入口失效。

## 四、改进设计与实现

### 4.1 记忆查询意图识别

新增 `memory-review-utils.ts`：

- `isMemoryReviewRequest(text)` 识别常见中文问法：
  - `你现在记住了我哪些事？`
  - `你记住了什么？`
  - `你还记得什么？`
  - `你记得我哪些事？`
- 不匹配类似 `帮我写一个记忆系统计划` 这种普通开发请求，避免误弹卡片。

### 4.2 facts 轻量拆分与写回

条目解析遵循 v1 约束：

- 支持 `- xxx`、`* xxx`、`1. xxx`。
- 非列表文本按非空行切分。
- 删除后统一写回 Markdown bullet：

```markdown
- 第一条事实
- 第二条事实
```

这样做的好处是实现简单、可预测，也兼容设置页文本编辑。

### 4.3 对话内 MemoryReviewCard

新增 `MemoryReviewCard.tsx`，挂载在用户记忆查询消息下方。

加载流程：

1. 从 `ChatTranscript` 传入 session 所属 `agentId`。
2. 调用 `GET /api/memories/compiled?agentId=...`。
3. 读取 `sections.facts` 并拆成多条。
4. 标题显示为 `Satori 想到的事`。

交互流程：

- `置顶`
  1. 读取 `/api/agents/:agentId/pinned`。
  2. 如果已存在相同文本，不重复写入。
  3. 否则追加该条并 `PUT` 回 pinned 接口。

- `不再记住`
  1. 从当前 facts 列表移除该条。
  2. 调用 `PUT /api/memories/compiled/facts?agentId=...`。
  3. 保存成功后卡片里该条消失。
  4. 保存失败时恢复原列表，并在卡片内显示错误。

当 `memory.editable_facts=false` 时：

- 仍可展示 Satori 当前想到的 facts。
- 不显示 `不再记住`。
- 提示用户打开“可编辑记忆”实验后才能在这里直接删除。

### 4.4 ChatTranscript 集成

在 `ChatTranscript.tsx` 的用户消息渲染分支中追加：

- 如果会话不是只读。
- 且用户消息命中记忆查询意图。
- 则在该用户消息下方渲染 `MemoryReviewCard`。

这个方案不修改持久化消息 schema，也不新增 content block 类型。它只是前端根据用户消息内容派生出的本地交互入口，因此对 compaction、历史 JSONL、Bridge 消息格式影响最小。

## 五、改动文件清单

| 文件 | 说明 |
| --- | --- |
| `desktop/src/react/components/chat/memory-review-utils.ts` | 记忆查询意图识别、facts 解析和写回 |
| `desktop/src/react/components/chat/MemoryReviewCard.tsx` | 对话内记忆回顾卡片 |
| `desktop/src/react/components/chat/ChatTranscript.tsx` | 用户记忆查询消息下挂载卡片 |
| `desktop/src/react/components/chat/Chat.module.css` | 记忆卡片样式 |
| `desktop/src/react/__tests__/components/memory-review-card.test.tsx` | 前端解析、卡片行为和 transcript 集成测试 |
| `tests/memory-routes.test.ts` | 空 facts 保存后不残留旧 compiled facts 的回归测试 |

## 六、测试策略

已覆盖：

- 记忆查询意图识别。
- facts bullet / 编号列表 / 非空行解析。
- facts 写回 Markdown bullet。
- 用户消息命中记忆查询后渲染 `Satori 想到的事` 卡片。
- 多条 facts 正确拆分。
- editable facts 关闭时隐藏 `不再记住`。
- `置顶` 复用 pinned API，且不重复添加。
- `不再记住` 保存剩余 facts，请求体不包含被删除条目。
- 保存失败时卡片不消失，并显示错误。
- 后端保存空 facts 后，`memory.md` 不残留旧 facts。

建议验证命令：

```bash
npx vitest run desktop/src/react/__tests__/components/memory-review-card.test.tsx tests/memory-routes.test.ts
npm run typecheck
npm run build:renderer
```

## 七、前端人工验收

准备：

1. 打开 `设置 -> 实验 -> 可编辑记忆`。
2. 确认当前 agent 已经有一些 facts 记忆。

验收提示词：

```text
你现在记住了我哪些事？
```

预期结果：

1. 对话区出现 `Satori 想到的事` 卡片。
2. 卡片中每条记忆独立成行。
3. 点击某条 `置顶`，进入 `设置 -> 助手 -> 记忆` 后能在置顶记忆里看到该条。
4. 点击某条 `不再记住`，该条从卡片中消失。
5. 再次发送 `你现在记住了我哪些事？`，该条不再出现。
6. 打开 `设置 -> 助手 -> 记忆 -> 查看当下记忆`，editable facts 中也不再包含该条。

关闭实验项时：

1. 关闭 `设置 -> 实验 -> 可编辑记忆`。
2. 再次发送 `你记住了什么？`
3. 卡片仍可只读展示 facts。
4. 卡片显示提示：打开“可编辑记忆”实验后，可以在这里直接删除记忆。
5. 不显示 `不再记住` 按钮。

## 八、设计权衡

- v1 选择前端派生卡片，不改消息持久化 schema，降低对历史会话和 compaction 的影响。
- v1 只做“置顶”和“删除 editable facts”，不做搜索、分类、单条编辑和多行嵌套解析。
- v1 不让模型自动执行记忆管理动作，所有修改都必须来自用户点击。
- v1 不新增设置 Tab，继续保留 `设置 -> 助手 -> 记忆` 作为完整管理入口。
