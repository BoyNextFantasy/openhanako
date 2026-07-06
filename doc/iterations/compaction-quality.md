# 上下文压缩质量优化

> 分支：`iter/compaction-quality` → `develop`
> 日期：2026-01-06

---

## 一、背景：Satori 现有的压缩体系

### 1.1 整体架构

Satori 基于 Pi SDK（`@mariozechner/pi-coding-agent`）构建。当对话历史接近模型上下文窗口上限时，Pi SDK 自动触发压缩流程。Satori 在 Pi SDK 之上叠加了自研的 **Cache-Preserving Compaction** 扩展（`compaction-guard-ext.ts`），核心思想是：**不走独立 LLM 请求生成摘要（冷启动会破坏 KV cache / Anthropic prompt cache），而是把压缩指令追加到会话前缀末尾**，与正常对话共享同一个 cache 前缀。

整个压缩体系分三层防护：

```
L1: tool_result 事件 hook —— 单条工具输出超过 32KB 时 head+tail 截断
L2: Pi SDK reserveTokens —— 调大保留空间，让原生 threshold 更早触发压缩
L3: session_before_compact 事件 hook —— 预判摘要请求本身是否超窗：
     - 超 85% 窗口 → 不调 LLM，直接硬截断（用固定中文占位文本替换旧历史）
     - 未超 85% → 调 LLM 在同 cache 前缀上生成结构化摘要
```

### 1.2 L3 压缩的详细流程（改造前）

当 Pi SDK 决定需要压缩时，触发 `session_before_compact` 事件。Satori 的 compaction guard 扩展拦截后：

1. **计算**：估算 `messagesToSummarize`（待摘要的旧消息）的 token 数
2. **预判**：如果摘要请求本身的输入 token 数 > 模型窗口的 85%，直接走硬截断——用 `computeHardTruncation()` 找切点，丢弃旧消息，注入占位摘要文本 `"[由于对话过长且摘要请求本身会超限，早期对话历史已被硬截断]"`。这一步是**必要死锁预防**——如果不做这个判断，LLM 收到超窗摘要请求直接报错，系统会反复重试直到崩溃（issue #437）
3. **摘要**：如果摘要请求不超窗，调 `createCachePreservingCompactionResult()` 生成摘要。该函数：
   - 在会话消息前缀后面追加一条 `user` 消息，内容为 `PI_SUMMARIZATION_PROMPT`（6 节结构化格式：Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context）
   - 如果已存在旧摘要，使用 `PI_UPDATE_SUMMARIZATION_PROMPT`（增量更新模式，将旧摘要包裹在 `<previous-summary>` 标签中，要求 LLM 保留旧信息 + 追加新信息）
   - 通过 `runSessionSnapshotSideTask` 发送 LLM 请求（复用 prompt cache 前缀）
   - 摘要结果中追加 `<read-files>` 和 `<modified-files>` 文件操作记录
4. **提交**：调用 `sessionManager.appendCompaction()` 将摘要作为 `compaction` 类型 entry 写入会话 JSONL；调用 `replaceSessionMessages()` 重建 agent.state.messages
5. **发射事件**：`session_compact` 扩展事件（桌面 UI 用于显示进度）

### 1.3 触发路径

压缩由五个入口触发：

| 入口 | 触发者 | 代码路径 |
|------|--------|----------|
| 自动压缩 | Pi SDK 内部（上下文接近窗口上限） | Pi SDK → `session_before_compact` hook → compaction guard L3 |
| 模型切换 | `session-coordinator.switchModel()` | `_compactWithModel()` → `runCachePreservingCompactionForSession()` |
| 手动 `/compact` | 用户在 Desktop/Bridge 输入斜杠命令 | `sessionOps.compact()` → `engine.compactDesktopSession()` → `session.compact()` |
| 删除 agent 续接 | 用户切换到已删除 agent 的 session | `_freshCompactDeletedAgentContinuation()` |
| 每日 fresh compact | 定时调度器 | `freshCompactDesktopSession()` → `session.compact()` |

---

## 二、问题分析

### 2.1 P0：压缩后持久上下文衰减（Summary-of-Summary 问题）

**现象**：多次压缩后，agent 遗忘了 CLAUDE.md 中的约束、MEMORY.md 中的用户偏好、加载的技能内容。

**根因**：System prompt 在 session 创建时被冻结为快照（`systemPromptSnapshot`），之后永不更新。压缩只重建 `agent.state.messages`（对话消息），不碰 system prompt。持久上下文（CLAUDE.md、记忆文件、技能）只在 LLM 生成的摘要中以"二手信息"形式存在——LLM 可能遗漏，也可能在后续压缩中衰减。

Claude Code 的文档中明确描述了这个问题，并采用了完全不同的策略：压缩后从磁盘重新读取 CLAUDE.md、MEMORY.md、已加载的技能。

**场景还原**：

```
1. Session 创建时，system prompt 包含 CLAUDE.md 中的 "禁止用 any 类型"
2. 20轮对话后自动压缩 → LLM 摘要写了 "用户偏好 TypeScript 严格类型"
3. 50轮对话后再压缩 → 第二次摘要是 "摘要+新消息" 的总结
                         → "用户偏好 TypeScript 严格类型" 被压缩成 "用户用 TS"
4. 100轮后再压缩 → "用户用 TS" 可能被省略
5. Agent 开始用 any 类型 → 违反 CLAUDE.md 约束
```

### 2.2 P1a：旧工具输出浪费 LLM 压缩调用

**现象**：频繁触发 LLM 压缩，但实际上很多情况不需要调 LLM——直接丢弃旧工具输出就能腾出足够空间。

**根因**：Satori 的 L2（reserveTokens 提前触发）和 L3（session_before_compact 预判）都是防御性机制，但没有"先清理、再判断"的逻辑。旧轮次中 agent 读了 200KB 的文件，该 tool_result 文本占满了窗口，但实际上**后续对话已经不再引用这个文件的内容**。LLM 摘要仍然需要处理这些文本（消耗 token 和费用），而简单的丢弃操作就可以达到同样效果。

这与 OpenCode 的 `prune()` 设计形成对比：OpenCode 在压缩前逆向扫描对话历史，清除旧轮次的 tool_result 文本内容，只有在修剪后仍超窗时才调 LLM 做摘要。修剪是免费的（零 LLM 调用），摘要是有成本的。

### 2.3 P1b：压缩失败后的死循环

**现象**：极端场景下（如用户发送了超大的附件），压缩后上下文仍然超窗，系统反复触发压缩直到崩溃。

**根因**：压缩流程没有"重试上限"概念。L3 的硬截断是一次性的——如果截断后上下文仍然满（被保留的尾部本身就超窗），系统会继续走正常对话流程，然后再次触发压缩，循环往复。

Claude Code 对此的处理是：如果检测到压缩后上下文立即又满，停止自动压缩并报错。OpenCode 的 `processCompaction` 函数在 compaction 请求本身超窗时返回 `"stop"`。

---

## 三、参考实现分析

动手前，研究了三个活跃项目的上下文管理设计：

### 3.1 OpenCode（anomalyco/opencode，37K+ stars）

**三层防御**：Prune → LLM Compaction → Overflow 重放

- **Prune**（零 LLM 成本）：逆向扫描对话，保护最后 2 轮，清除旧 tool_result 输出。仅当至少能省 20K token 时执行（`PRUNE_MINIMUM`），且前 40K token 的 tool_result 受保护（`PRUNE_PROTECT`）。受保护的技能（如 `skill`）的输出不被修剪。
- **LLM Compaction**：保留最后 N 轮，用专门模型生成 4 节结构化摘要（Objective / Important Details / Work State / Next Move）。支持分轮（split turn）和增量更新。
- **Overflow**：当 provider 返回上下文溢出错误时，剥离媒体文件、压缩对话、重放用户原始请求。
- **Auto-Continue**：自动压缩后注入合成消息 `"Continue if you have next steps..."`。

### 3.2 Claude Code（Anthropic）

**核心创新：压缩后重新注入持久上下文**

- 系统 prompt 和各 CLAUDE.md 文件在 session 创建时从磁盘加载
- 压缩完成后，**不从 LLM 摘要中恢复这些指令**，而是直接从磁盘重新读取 CLAUDE.md、MEMORY.md、已加载的技能原文
- 技能列表（仅一行描述）不重新注入，完整内容按需加载
- 子 agent 拥有独立的上下文窗口，主 session 只收最终文本摘要

这是 Claude Code 能处理极长对话的关键——持久指令永远是新鲜的、未被摘要衰减过的。

### 3.3 Satori 自己的不足

与 OpenCode 和 Claude Code 对比，Satori 缺三个关键能力：

| 能力 | Satori | OpenCode | Claude Code |
|------|:---:|:---:|:---:|
| 工具输出修剪（零 LLM 成本清理） | ❌ | ✅ prune() | ✅ |
| 压缩后重新注入持久上下文 | ❌ | ❌ | ✅ |
| 防抖动（压缩后仍满 → 停止循环） | ❌ | ✅ stop | ✅ |

---

## 四、改进设计与实现

### 4.1 P0：压缩后重新注入持久上下文

**设计思路**：

不再把持久上下文丢给 LLM 摘要，而是在每次压缩完成后，直接从磁盘重新读取并刷新 system prompt。这样无论压缩多少次，CLAUDE.md、记忆文件、技能内容始终是最新版本。

**实现方案**：

1. **注入点选择**：需要在**所有压缩路径**上生效。最初考虑放在 `appendCompactionResultToSession()` 中——该函数在所有 bypass 路径（模型切换、硬截断、删除 agent 续接）中都会被调用。但子 agent 复审时指出：Pi SDK 原生的自动压缩和手动 `/compact` 路径走 `session.compact()` → `agent-session.js`，**不经过** `appendCompactionResultToSession()`。因此改为监听 `session_compact` 扩展事件——该事件在所有压缩路径完成后都会触发，覆盖面最广。

2. **实现位置**：在 `compaction-guard-ext.ts` 的工厂函数中增加 `onPostCompact` 回调选项，注册 `session_compact` 事件 handler。回调由 `server/index.ts` 注入，直接访问 engine 和 session 对象。

3. **具体逻辑**：
   ```
   压缩完成 → Pi SDK 或 Satori 发出 session_compact 事件
             → onPostCompact 回调被触发
               → 获取 sessionPath
               → 获取 session.agent
               → 调用 agent.buildSystemPrompt({ forceMemoryEnabled: true })
                 （该函数每次从磁盘重新读取 CLAUDE.md、MEMORY.md、技能、
                  Workspace instruction files、用户档案、pinned 记忆等）
               → 将新 prompt 写入 agent.state.systemPrompt
               → 下次 LLM 调用时使用最新的 system prompt
   ```

4. **安全性**：try/catch 包裹，失败不影响压缩结果（best-effort），因为压缩本身已经成功完成。

5. **缓存影响**：system prompt 变更后，旧 prompt cache 前缀失效。但这只在压缩后才发生，压缩后的首次 LLM 调用会重新建立 cache 前缀。

### 4.2 P1a：工具输出修剪

**设计思路**：

参考 OpenCode `prune()` 算法，在调 LLM 之前先做一次非 LLM 的清理。如果修剪后上下文就不超窗了，根本不需要调 LLM 做摘要。

**算法**（两阶段后向扫描）：

```
阶段一：找保护边界
  逆向扫描 messages：
    遇到 compaction 标记 → 停止（之前的内容已被压缩过）
    遇到 user 消息 → remainingUserTurns--；若归零 → 记录 cutOffIndex，结束阶段一
    其他消息 → 继续扫描
  结果：cutOffIndex 之后的所有消息受保护（最后 N 轮用户输入不被修剪）
  默认 N=2，即可配置

阶段二：在保护边界之前修剪 tool_result
  从 cutOffIndex-1 向前扫描：
    遇到 compaction 标记 → 停止
    跳过 user 消息和非 toolResult 消息
    跳过 error tool_result（错误信息永远保留，帮助调试）
    对每个 tool_result 的 text block：
      累计 token ≈ text.length / 4
      累计 > 40K token 后 → 替换为 "[工具输出已省略]"
  
  若修剪总量 < 20K token → 不执行（修剪收益太小，白费操作）
```

**两层注入**：

1. **`context` 事件 hook**（Pi SDK 原生事件）：在**每次常规 LLM 调用前**触发，拦截 `event.messages` 并返回修剪后的版本。覆盖所有对话场景。
2. **`session_before_compact` 事件 hook**：在**压缩准备阶段**触发，修改 `preparation.messagesToSummarize` 和 `preparation.turnPrefixMessages`，让 LLM 摘要不处理已被修剪的旧工具输出。

**扩展注册顺序**：P1a 扩展**必须在** compaction guard 扩展（L3）之前注册。因为 `session_before_compact` handlers 按注册顺序执行，compaction guard 需要看到已修剪的 preparation 数据。这是子 agent 复审发现的 blocker 级 bug——最初实现中两个扩展注册顺序颠倒，导致修剪在 guards 之后执行，LLM 摘要收到的仍然是未修剪的完整消息。

**边界情况处理**：

- 非 `text` 类型的 content block（如 image）保留不修剪
- `isError: true` 的 tool_result 保留不修剪
- 消息结构可能不标准（`content` 不是数组、block 缺失 type 等），防御性检查确保不崩溃
- 内存操作，不改磁盘 JSONL——保留完整输出用于调试和回放

### 4.3 P1b：防抖动

**设计思路**：

限制单个 session 的连续压缩次数。不是因为代码质量，而是因为**物理上限**——无论如何压缩，某些内容（如单个超大文件的内容）无法塞进模型窗口。

**实现**：

1. **计数器**：存在 `session._compactionAttempts`（内存级，session 对象存活期间有效）
2. **前置检查**：在 `runCachePreservingCompactionForSession()` 入口，若计数器 ≥ 3，抛出明确的错误信息
3. **后置检查**：压缩成功后，调用 `session.getContextUsage()` 获取新 token 数，计算 `tokens / contextWindow` 占比。若 > 85%，计数器 +1；否则归零
4. **上限 3 次**：允许少量重试（可能是估算偏差），但不会无限循环

**为什么不覆盖自动压缩路径**：Pi SDK 内部已有单次 `_overflowRecoveryAttempted` 标志位，一次编译失败后不会自动重试。我们的 guard 覆盖的是 coordinator 层的 bypass 路径（模型切换、手动 compact），两者互补。

**计数器不持久化**：不需要。session 重载时计数器归零是合理行为——重新加载意味着新的 agent state，之前的内存压力可能已经消除。

---

## 五、改动文件清单

| 文件 | 操作 | 行数 | 说明 |
|------|------|------|------|
| `core/session-compactor.ts` | 修改 | +30 | P1b 防抖 guard（前置检查 + 后置检查） |
| `core/tool-output-pruner.ts` | **新建** | 85 | P1a 修剪算法纯函数（`pruneToolOutputs`） |
| `lib/extensions/tool-output-prune-ext.ts` | **新建** | 61 | P1a Pi SDK 扩展（`context` + `session_before_compact` 双 hook） |
| `lib/extensions/compaction-guard-ext.ts` | 修改 | +12 | P0 `session_compact` 事件 handler + `onPostCompact` 回调选项 |
| `server/index.ts` | 修改 | +20 | P1a 扩展注册 + P0 `onPostCompact` 回调实现 |
| `tests/tool-output-pruner.test.ts` | **新建** | 111 | P1a 8 个单元测试（保护边界、token 预算、错误保留、compaction 边界停止、自定义参数等） |

---

## 六、测试策略

### 单元测试

- **P1a 算法**：8 个测试覆盖保护边界逻辑、token 预算、错误保留、compaction 边界、自定义参数。纯函数易测，无 mock。
- **P0 / P1b**：逻辑嵌入在 session-compactor 和 compaction-guard-ext 中，依赖 session 上下文。通过现有 75 个集成测试（`session-compactor.test.ts` 15个 + `compaction-guard-ext.test.ts` 28个 + `compaction-utils.test.ts` 13个 + `session-permission-mode.test.ts` 11个 + `tool-output-pruner.test.ts` 8个）间接验证。

### 回归测试

全量 6957 测试中 44 个预存失败（Windows 路径大小写、jieba 字典加载、symlink 权限等），与本次改动无关。无新回归。

### 端到端验收

最关键的用户端测试：

1. 在 CLAUDE.md 中写入特殊约束（如 `所有回复必须以"Roger."结尾`）
2. 进行 20+ 轮长对话触发自动压缩
3. 验证压缩后 agent 仍然遵循该约束

**如果 P0 生效**：约束被保留
**如果 P0 未生效**：约束丢失

---

## 七、设计权衡与未做事项

### 取舍

| 决策 | 选择 | 理由 |
|------|------|------|
| P0 放在 `session_compact` 事件而非 `appendCompactionResultToSession` | `session_compact` | 覆盖所有压缩路径，而 bypass 路径 (`appendCompactionResultToSession`) 只覆盖三种 |
| P1a 纯内存操作（不写磁盘） | 内存 | 修剪后 JSONL 保留完整工具输出，用于调试和回放 |
| P1a 保护预算 40K + 最小修剪 20K | 参考 OpenCode | 避免小额修剪（得不偿失），同时保护足够的近期上下文 |
| P1b 上限 3 次 | 保守值 | 给估算偏差留空间，但不会无限循环 |
| P1b 计数器不持久化 | 内存 | Session 重载后上下文状态已变，旧计数器无效 |

### 未做的事

- **P2 自动续接**（OpenCode 的 auto-continue）：Satori 没有自主 agent loop（每次需要外部 `promptSession()` 触发），实现需要架构变更。暂时搁置。
- **压缩模式简化**（3 个实验性模式 → 1 个）：P1a 修剪减少了自动压缩频率，间接淡化了模式选择的重要性。后续可独立处理。
- **结构化输出验证**（强制 LLM 用 JSON 返回值）：不同 provider 兼容性风险，且 P0 的重注入机制已从根本上解决了持久上下文丢失问题。
