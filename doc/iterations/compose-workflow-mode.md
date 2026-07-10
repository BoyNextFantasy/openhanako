# Compose Workflow Mode

> 分支：`iter/compose-workflow-mode`
> 日期：2026-07-09

---

## 一、背景：原来的模式体系是什么样

Satori 已经有一套会话权限模式：`auto`、`ask`、`operate`、`read_only`、`plan`。这套模式回答的是“工具和文件操作能不能执行、是否要审批”的问题。其中 Plan 模式是权限体系的一部分：它会限制执行类工具，让模型停留在规划和讨论阶段。

但“权限模式”和“工作流模式”不是一回事。用户想要的 Compose 更接近一种工作方法：遇到复杂开发任务时，模型应该主动做需求澄清、方案拆分、TDD、执行记录、复审和验收；遇到简单问题时，又不应该被迫走完整流程。

之前 Plan 模式尝试失败的核心体验问题是：前端按钮虽然切了模式，但模型不一定真的知道当前 UI 状态，也不一定拿到了对应的 workflow 能力。因此这次 Compose 的第一原则是：前端开关必须打通到后端 session 状态，再进入 system prompt 和 runtime skill 列表。按钮不能只是装饰。

---

## 二、问题分析

### 2.1 不应该把 Compose 做成第六个权限模式

如果把 Compose 塞进 `permissionMode`，就会混淆两个问题：

- 权限模式：能不能改文件、能不能执行命令、是否需要用户审批。
- 工作流模式：模型应该用普通对话，还是结构化开发流程。

混在一起后，`Auto + Compose`、`Ask + Compose` 这种自然组合就表达不出来。最终会变成“为了让模型会规划，不得不改变权限边界”，这不符合 Satori 的安全模型。

### 2.2 Plan 和 Compose v1 必须互斥

Plan 的语义是只规划，不推进执行状态；Compose 的语义是复杂任务时组织完整工作流，其中包括执行、测试、复审、验收。两者如果同时注入，会让模型同时收到“只规划”和“组织执行流”的提示，容易产生冲突。

所以 v1 选择保守策略：Plan 权限下 `effectiveWorkflowMode` 强制为 `normal`。前端按钮置灰，后端也不会注入 Compose prompt，也不会暴露 `compose:*` skills。这不是只靠 UI 约束，而是后端 effective mode 强制收敛。

### 2.3 只改前端按钮不够

这个功能最容易做成“看起来有开关，模型其实不知道”。真正完整的链路必须包括：

1. Desktop store 保存当前 session 的 workflow mode。
2. 切换按钮调用后端 API。
3. SessionCoordinator 保存、恢复、休眠、列表投影都带上 `workflowMode`。
4. Agent system prompt 根据 effective workflow 注入 Compose 指令。
5. SkillManager 根据 effective workflow 过滤 `compose:*` skills。
6. WebSocket 事件把后端状态同步回前端。

本次实现中还额外修了一个复审发现的细节：session 创建时 runtime skill 列表会被冻结成 prompt snapshot。最初切换 Compose 时只刷新了 prompt 和 meta，没有刷新 resourceLoader 闭包读取的 skill snapshot，可能导致“模型看到 Compose 指令，但实际不能调用 compose skill”。现在改成 resourceLoader 动态读取 session entry 里的当前 prompt snapshot，切换 workflow 后同一个 session 也能立刻看到新的 runtime skills。

复审还发现两个一致性问题，并已修复：

- hibernated session 切换 workflow / permission 时没有 live runtime，无法立即重建 prompt。现在会清掉冻结的 `promptSnapshot`，让下次 restore 按最新 `workflowMode/effectiveWorkflowMode` fresh-build，避免恢复旧 Compose 或旧 normal 指令。
- pending new session 曾经会显示上一条 session 的 workflow 状态，但首次创建时不一定带上该状态。现在进入新会话草稿会回到 normal，创建请求也会显式发送 `workflowMode`，避免前端显示和后端实际创建不一致。

---

## 三、参考实现：MiMoCode / OpenCode 的取舍

参考 MiMoCode 后得到的结论是：它的 Compose 更像 primary agent 加上一组 `compose:*` skill bundle，再通过 UI 和 runtime skill filter 控制可见性。它不是单纯的按钮，也不是传统权限模式。

Satori 没有照搬成一个新 agent，原因是 Satori 的 agent 更偏角色、人格、配置主体。如果把 Compose 做成 agent，会让“用户想用哪个助手”和“用户想用哪种工作流”绑死。更合适的设计是 session 级 `workflowMode`：

- agent 仍然是 Hana / 自定义助手。
- permission mode 仍然控制安全边界。
- workflow mode 只控制模型工作方法和 workflow skills 可见性。

本次内置的 `compose:*` skills 也没有复制 MiMoCode 文本，而是写成 Satori 风格的最小集合，后续可以继续扩展。

---

## 四、面试表达：Compose 到底是什么

面试时可以把 Compose 解释成一句话：我把“权限控制”和“工作流控制”拆开了。Plan 模式是安全刹车，控制模型能不能执行；Compose 模式是流程编排器，控制模型如何组织复杂开发任务。

更具体一点：

- Plan 回答的是“现在能不能动手”。它属于 permission mode，重点是限制工具执行、文件修改和状态推进。
- Compose 回答的是“复杂任务应该怎么做”。它属于 workflow mode，重点是让模型在多文件功能、调试、重构、测试补齐这类任务里，按澄清、计划、TDD、执行、复审、验收的节奏组织工作。
- 两者正交但有边界。`Auto + Compose` 表示可以自动执行但采用结构化工作流；`Ask + Compose` 表示采用结构化工作流但关键操作仍要询问；`Plan` 下 v1 强制 `effectiveWorkflowMode=normal`，避免“只规划”和“组织执行流”同时注入造成冲突。

这个设计的启发来自 MiMoCode。MiMoCode 的 Compose 给我的架构启发是：Compose 不一定要变成一个新 agent，它可以是 primary agent 加上一组 superpower-like workflow skills，再通过 UI 状态和 runtime skill filter 控制这些能力什么时候可见。Satori 借鉴的是这个思路，而不是复制它的 skill 文本或完整 bundle。

所以在 Satori 里，`compose:*` skills 更像一组内置工作流卡片：

- `compose:brainstorm`：先澄清目标、约束和可选方案。
- `compose:plan`：把复杂任务拆成步骤、风险点和测试计划。
- `compose:tdd`：推动先定义验证，再做实现。
- `compose:execute`：按计划小步落地。
- `compose:review`：复审改动是否漏了关联文件、边界和安全判断。
- `compose:verify`：形成验收记录，而不是凭感觉说完成。

### 4.1 如果面试官问：这和直接把 Superpower Skills 加载进 agent 有什么区别

可以这样回答：直接把所有 Superpower Skills 永久塞进 agent，确实也能让模型“知道这些方法”。但那只是静态提示词增强，不是产品级工作流模式。Compose 的优势在于它把 workflow 变成了显式会话状态。

核心区别有几个：

1. 普通任务不会被流程污染。用户问一个简单问题时，不应该每次都被 brainstorm、plan、review 包围。Compose 关闭时，`compose:*` skills 在 runtime skill 列表里就是隐藏的。
2. 用户可以按 session 开关。Compose 是 `workflowMode`，会被前端按钮、后端 session meta、WebSocket 事件和恢复逻辑同步，而不是改 agent 人格或长期系统提示。
3. 权限和方法论解耦。Superpower skills 只描述怎么做事，不能决定能不能执行；Satori 仍由 `auto/ask/operate/read_only/plan` 控制安全边界。
4. 冲突可以在后端强制收敛。Plan 模式下后端直接把 `effectiveWorkflowMode` 收敛成 `normal`，不是只靠 prompt 让模型自觉。
5. 更容易测试和量化。因为 Compose 是明确字段，可以写单测验证 prompt 注入、skill 可见性、session 持久化、按钮同步和 Plan 互斥，也能后续统计开启 Compose 后的任务完成率、返工次数、测试覆盖和 token 消耗。
6. agent 身份和工作方式分离。Hana 或用户自定义 agent 仍然是“谁在帮你”，Compose 只是“用什么工作流帮你”，不会因为想用工作流就必须换一个 agent。

简历或面试里的项目亮点可以写成：

> 设计并实现了会话级 Compose Workflow Mode，将权限模式与工作流模式解耦。该模式受 MiMoCode / Superpower Skills 思路启发，通过显式 `workflowMode` 状态、Prompt 注入、runtime skill 过滤、session 持久化和前端按钮同步，让 Agent 在复杂开发任务中按澄清、计划、TDD、执行、复审、验收的流程工作，同时不改变原有权限安全边界。

---

## 五、改进设计与实现

### 5.1 核心 workflow mode

新增 `core/session-workflow-mode.ts`，定义：

- `normal`：默认普通模式。
- `compose`：结构化工作流模式。
- `normalizeSessionWorkflowMode()`：只接受 `normal` / `compose`，未知值回落到 `normal`。
- `effectiveSessionWorkflowMode()`：当权限模式是 `plan` 时，强制返回 `normal`。

这个模块让 workflow mode 独立于 permission mode，但又能在 Plan 边界下做 effective 收敛。

### 5.2 Session 状态链路

`SessionCoordinator` 增加了 `workflowMode` 和 `effectiveWorkflowMode`：

- 新 session 可传 `workflowMode`。
- pending new session 可暂存 workflow mode。
- `session-meta.json` 写入和恢复 workflow mode。
- hibernated runtime meta 保存 workflow mode。
- session list 返回 workflow mode。
- 切换 workflow 后发出 `workflow_mode` WebSocket 事件。
- 切换 permission 到 Plan 时重新计算 effective workflow，并刷新 prompt。

关键点是 prompt snapshot 和 runtime skill snapshot 都会跟着刷新，避免 session 继续使用旧工作流状态。

### 5.3 Prompt 注入

`Agent.buildSystemPrompt()` 新增 `forCompose?: boolean`。当 `forCompose=true` 且不是 Plan 模式时，会注入 Compose workflow 指令：

- 先判断任务是否值得结构化处理。
- 简单问答和很小改动直接完成。
- 多步骤开发、调研、排障、重构、测试补齐、高风险改动优先使用 compose skills。
- Compose 不绕过当前 permission mode。

Plan 优先级高于 Compose：`forPlan=true` 时不会注入 Compose prompt。

### 5.4 Compose skills

新增最小内置集合：

- `compose:brainstorm`
- `compose:plan`
- `compose:tdd`
- `compose:review`
- `compose:execute`
- `compose:verify`

`SkillManager` 把 `compose:*` 标记为 compose-only：

- 普通模式 runtime skill 列表隐藏。
- Compose 模式 runtime skill 列表显示。
- Compose skills 在 Compose 下默认 runtime enabled。
- 普通用户 skill、workspace skill、plugin skill 仍按原规则工作。

`/api/skills?runtime=1` 的 workflow 可见性由服务端当前 effective workflow 推导，不信任客户端 query 直接声明 `workflowMode=compose`。这样普通模式下不会因为手写 query 暴露 compose-only skills。

### 5.5 API 和前端

新增 API：

- `GET /api/session-workflow-mode`
- `POST /api/session-workflow-mode`

请求支持 `sessionPath`、`pendingNewSession`、`mode`。返回 `mode` 和 `effectiveMode`。如果当前权限是 Plan，即使原始 mode 是 `compose`，`effectiveMode` 也会是 `normal`。

Desktop 输入栏新增 `ComposeModeButton`，放在 Plan 权限按钮旁边：

- 普通状态显示“普通”。
- Compose 状态显示“Compose”。
- Plan 权限下按钮禁用，tooltip 为“Plan 模式下不可用”。
- 新会话 pending 状态会记住用户选择，首次发消息创建 session 时带上 `workflowMode`。
- session 切换、刷新页面、WebSocket `workflow_mode` 事件都会同步按钮状态。

---

## 六、前端验收方案

### 6.1 基础 UI 验收

1. 启动桌面端。
2. 看输入框下方控制栏，Plan 权限按钮旁边应该多一个小按钮。
3. 默认显示“普通”。
4. 点击后显示“Compose”。
5. 再点一次回到“普通”。
6. 切到 Plan 权限模式后，Compose 按钮应置灰，鼠标悬停提示“Plan 模式下不可用”。

### 6.2 新会话验收

1. 开启一个新会话草稿。
2. 在还没发消息前点击 Compose。
3. 发第一条消息。
4. 切走再切回该 session，按钮仍应显示 Compose。

### 6.3 模型是否真的知道 Compose

在 Compose 开启时发送：

```text
你现在处于什么工作流模式？请只用三点回答：
1. 你是否处于 Compose 工作流
2. Compose 是否会绕过权限模式
3. 如果我要做一个多文件功能迭代，你会优先怎么组织过程
```

预期：

- 回答应明确知道自己在 Compose 工作流。
- 应明确说 Compose 不会绕过权限。
- 应提到澄清、计划、测试、复审、验证这类结构化流程。

关闭 Compose 后再发送：

```text
你现在是否有 Compose 工作流指令？如果没有，请直接说没有。
```

预期：

- 不应该继续声称自己处于 Compose。

### 6.4 Plan 互斥验收

1. 先打开 Compose。
2. 再切到 Plan 权限模式。
3. Compose 按钮应置灰并显示普通态。
4. 发送：

```text
请说明你当前是否能使用 Compose 工作流。如果不能，请说明原因。
```

预期：

- 模型应说明 Plan 下 Compose 不可用或不会生效。
- 不应该主动进入执行型工作流。

### 6.5 复杂任务验收提示词

可以用一个不会真的破坏项目的小任务：

```text
请帮我评估是否应该给 tests 增加一个很小的工具函数单测。先不要改代码，先用 Compose 工作流告诉我你会如何澄清需求、拆步骤、设计测试和验收。
```

预期：

- Compose 开启时，模型会主动组织结构化步骤。
- 如果任务不需要改代码，它应停在计划或澄清阶段。
- 如果权限是 Plan，它不应推进执行状态。

---

## 七、改动文件清单

核心：

- `core/session-workflow-mode.ts`
- `core/session-coordinator.ts`
- `core/engine.ts`
- `core/agent.ts`
- `core/skill-manager.ts`

API：

- `server/index.ts`
- `server/routes/sessions.ts`
- `server/routes/skills.ts`
- `server/http/route-security.ts`

前端：

- `desktop/src/react/components/input/ComposeModeButton.tsx`
- `desktop/src/react/components/input/InputControlBar.tsx`
- `desktop/src/react/components/InputArea.tsx`
- `desktop/src/react/components/input/InputArea.module.css`
- `desktop/src/react/stores/session-slice.ts`
- `desktop/src/react/stores/session-actions.ts`
- `desktop/src/react/services/ws-message-handler.ts`
- `desktop/src/react/types.ts`
- `desktop/src/locales/*.json`

Skills：

- `lib/compose-skills/*/SKILL.md`

测试：

- `tests/session-workflow-mode.test.ts`
- `tests/agent-compose-prompt.test.ts`
- `tests/skill-manager.test.ts`
- `tests/session-coordinator-tool-snapshot.test.ts`
- `desktop/src/react/__tests__/components/compose-mode-button.test.tsx`
- `desktop/src/react/__tests__/components/InputControlBar.audio.test.tsx`
- `desktop/src/react/__tests__/stores/session-actions.test.ts`
- `desktop/src/react/__tests__/services/ws-message-handler.test.ts`

---

## 八、测试策略

重点测试四条链路：

1. mode 规范化：只接受 `normal/compose`，Plan 下 effective mode 强制 normal。
2. prompt 注入：normal 无 Compose 指令，compose 有 Compose 指令，plan + compose 不注入 Compose。
3. skill 过滤：普通模式隐藏 `compose:*`，Compose 模式暴露 `compose:*`。
4. 前端同步：按钮点击 API、pending new session、session 切换、WebSocket 事件、Plan 禁用。

推荐验收命令：

```powershell
npx vitest run tests/session-workflow-mode.test.ts tests/agent-compose-prompt.test.ts tests/skill-manager.test.ts
npx vitest run desktop/src/react/__tests__/components/compose-mode-button.test.tsx desktop/src/react/__tests__/components/InputControlBar.audio.test.tsx desktop/src/react/__tests__/stores/session-actions.test.ts desktop/src/react/__tests__/services/ws-message-handler.test.ts
npx vitest run tests/session-coordinator-tool-snapshot.test.ts -t "refreshes runtime skill snapshots"
npm run typecheck
npm run build:renderer
git diff --check
```

说明：`tests/session-coordinator-tool-snapshot.test.ts` 全文件当前有 phone feature gate 相关既有失败，和 Compose workflow mode 无关；本次新增的 workflow runtime skill snapshot 用例可单独通过。

---

## 九、设计权衡

- 不做 SQLite manifest 字段：v1 先沿用 `session-meta.json` 和 runtime entry，避免引入数据库迁移。
- 不复制 MiMoCode skill bundle：先保留 Satori 自己的最小 workflow skeleton，后续按真实使用再扩。
- 不让 Compose 改权限语义：安全边界仍由 permission mode 控制。
- Plan 与 Compose v1 互斥：先避免双 workflow prompt 冲突，后续如果要支持“Plan + Compose 只规划版”，可以单独设计 effective prompt。
- 不强制每个任务都走 Compose：prompt 明确要求模型先判断复杂度，小任务直接完成。

## 十、按钮点击无反馈修复

前端人工验收时发现一个问题：Compose 按钮在 Plan 模式下会正确置灰，但在非 Plan 模式点击“普通”时，用户侧看起来没有切到 Compose。

复查后确认按钮的核心链路是 `ComposeModeButton -> POST /api/session-workflow-mode -> setSessionWorkflowMode`。后端 API 和 route security 都已经存在，问题集中在前端交互容错：

- 按钮点击没有像旁边的 Plan 权限按钮一样 `stopPropagation()`，嵌在输入栏复杂容器里时可能被父层 click 逻辑干扰。
- `hanaFetch` 失败时只写 `console.error`，不会发 `hana-inline-notice`，所以接口 404、服务未更新、连接未就绪或 409 时，用户看到的就是“点了没反应”。
- 后端即使返回 `{ ok: false }`，旧实现也可能继续按 `effectiveMode/mode` 更新 UI，没有明确失败分支。

修复方案：

- Compose 按钮点击时停止事件冒泡，行为对齐 Plan 权限按钮。
- 增加 `switching` 状态，切换期间临时禁用按钮，避免重复点击造成状态抖动。
- 请求异常或返回 `ok:false` 时发出可见的 inline notice：提示用户切换 Compose 失败并确认服务已更新。
- 补齐多语言文案，避免中文界面显示未翻译 key。

对应回归测试：

```powershell
npx vitest run desktop/src/react/__tests__/components/compose-mode-button.test.tsx
```

新增覆盖：

- 点击 Compose 按钮不会冒泡到输入栏父容器。
- workflow API 失败时会展示 `hana-inline-notice`，不再沉默失败。

前端验收补充：

1. 非 Plan 模式点击“普通”，按钮应切到 “Compose”。
2. 再点 “Compose”，按钮应回到“普通”。
3. Plan 模式下按钮仍然置灰。
4. 如果点击后出现“切换 Compose 模式失败，请确认服务已更新并重试”，说明前端已经收到失败并给出反馈；此时应重启桌面端或确认当前 server 已包含 `/api/session-workflow-mode`。

## 十一、开发模式旧 Server 复用修复

继续验收时又发现：按钮点击会直接提示失败。用真实 `server-info.json` 里的 token 直接请求当前端口后确认：

- `GET /api/health` 返回 200。
- `GET /api/session-workflow-mode` 返回 404。

这说明不是按钮事件、token 或权限问题，而是当前运行的 server 进程里没有新路由。根因是 Desktop 开发模式会复用已经存在的 desktop-owned server；复用判断只检查 token、health、identity、version 和 network。由于本次迭代没有改 package version，早上启动的旧 server 仍被认为可复用，导致“新 renderer + 旧 server”错位。

修复方案：

- Desktop main 进程在开发模式计算 server 相关源码指纹，覆盖 `server/`、`core/`、`lib/`、`shared/` 以及关键 package/config 文件。
- spawn server 时通过 `HANA_SERVER_SOURCE_REVISION` 传给 server。
- server 写 `server-info.json` 时记录 `sourceRevision`。
- Desktop 复用已有 server 前，如果当前源码指纹和 `server-info.json.sourceRevision` 不一致，就拒绝复用；如果该 server 是 desktop-owned，则允许终止并重启。
- packaged 模式不使用源码指纹，仍按 version / identity / network 复用，避免影响正式安装包。

这次修的是开发迭代体验里的真实坑：以后只要改到后端源码，重启 Desktop 时会自动换成新 server，不会再出现前端按钮已经更新、后端 API 还是旧版本的黑箱失败。

对应回归测试：

```powershell
npx vitest run tests/server-startup-diagnostics-contract.test.ts -t "does not reuse a dev server whose source snapshot is stale"
```

前端验收补充：

1. 重启桌面端。
2. 重启后再点击“普通”。
3. 预期按钮切到 `Compose`，不再提示失败。
4. 如果仍失败，用当前 `server-info.json` 的 token 请求 `/api/session-workflow-mode`，不应该再是 404。
