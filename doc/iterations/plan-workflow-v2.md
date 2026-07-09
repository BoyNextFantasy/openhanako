# Plan Workflow 2.0 - 结构化计划协议与任务树绑定

> 分支：`iter/plan-workflow-v2`
> 日期：2026-07-08

---

## 一、背景：Plan 1.0 的现有工作流

Plan 1.0 已经把 Plan 作为第五种 session permission mode 接入系统。服务端在 `core/session-permission-mode.ts` 中定义 `SESSION_PERMISSION_MODES.PLAN`，并通过 `isReadOnlyPermissionMode()` 把 Plan 和 read_only 一起纳入只读拦截。模型侧在 `core/agent.ts` 的 `buildSystemPrompt({ forPlan: true })` 中注入 Plan 模式提示，要求 agent 先读代码、必要时使用 question 工具提问、输出计划、使用 task 工具组织任务树，并等待用户确认后再执行。

Task 体系已经存在于 `lib/task-registry.ts` 和 `lib/tools/task-tool.ts`：LLM 可见任务使用 `T1`、`T1.1` 这样的树形 ID，支持 `create/list/get/start/block/unblock/done/abandon/rename`。这让 Plan 模式天然可以把步骤落到任务树里，而不是只在聊天文本里给一个临时列表。

权限层已经能阻止 Plan 模式写文件、编辑文件、派发 subagent 和执行一般命令。信息型工具如 read、grep、find、ls、question、task 仍然可用。

---

## 二、问题分析

### 2.1 计划结构只靠 prompt 约束

现象：Plan 1.0 的输出格式依赖模型自觉，可能写成自然语言计划，也可能漏掉风险、测试策略、用户确认点。这样的计划不利于复盘，也不利于面试材料里描述“agent framework 有计划协议”。

根因：系统没有一个代码层面的 Plan Artifact 概念。`core/agent.ts` 只是提示“输出结构化计划”，但没有定义必填字段、版本、状态，也没有一个可测试的 normalize/render 流程。

### 2.2 任务树绑定没有可复用协议

现象：prompt 要求模型使用 task 工具，但没有一个明确约定：父任务是什么、子任务是什么、任务是否应该 start。模型可能直接 start 第一步，造成 Plan 模式和执行模式边界模糊。

根因：Plan 模式没有把“计划步骤 -> task tree”的映射固化成一个 helper。任务树已有能力，但缺少 Plan 工作流层的约定。

### 2.3 Plan 模式不能跑只读检查

现象：Plan 模式下 `exec_command` 被完全拦截，所以 `git status --short`、`git diff --check`、`npm run typecheck` 这类检查也无法执行。

根因：Plan 1.0 把 Plan 等同于 read_only，而 `classifyExecCommandAction()` 对 read-only mode 一律 deny。这样安全，但会让计划阶段无法验证当前分支、diff 状态和基础类型检查，降低计划质量。

---

## 三、参考实现

Codex / Claude Code / OpenCode 这类成熟 agent 的共同点不是“计划写得很长”，而是把计划阶段作为执行前的协议边界：先读上下文，明确范围和风险，再等待用户确认。Codex 的 plan/update_plan 机制体现了“步骤状态可见”；Claude Code 的 plan mode 强调“计划阶段不动手”；OpenCode 的 task/todo 风格强调“执行项可追踪”。

本次没有照搬大型系统，而是借鉴三个要点：

- 计划要有稳定 schema，便于测试和复盘。
- 计划步骤要绑定到任务树，便于后续执行接续。
- 计划阶段可以做低风险只读检查，但不能执行副作用命令。

---

## 四、改进设计与实现

### 4.1 Plan Artifact v2

新增 `core/plan-workflow.ts`，定义一个纯模块，不依赖 agent 实例和工具执行层。Plan Artifact v2 包含：

- `goal`：本次计划目标
- `scope`：本轮包含什么
- `outOfScope`：明确不做什么
- `steps`：执行步骤，每步包含 title、details、files、acceptance
- `risks`：风险和不确定性
- `testPlan`：验收命令或测试策略
- `confirmationPoints`：需要用户确认的点
- `status: awaiting_user_confirmation`：计划完成后停在用户确认点

`normalizePlanArtifact()` 负责校验和规范化字段。必填区块为空会直接抛出可读错误，避免生成一个看似完整但实际缺关键部分的计划。

`renderPlanArtifact()` 负责把 artifact 渲染成稳定文本，结尾明确写出 handoff 规则：必须等待用户明确确认或切换到 operate mode，才能修改文件、运行副作用命令或派发 subagent。

### 4.2 计划步骤绑定任务树

`bindPlanToTaskTree(plan, registry)` 负责创建任务树：

- 父任务：`Plan: <goal>`
- 子任务：`Step N: <title>`
- 所有任务保持 `open`

这个设计刻意不调用 `startLLMTask()`。Plan 模式只负责把计划登记成可追踪任务，不表示已经开始执行。

### 4.3 Plan 模式只读命令白名单

在 `core/session-permission-mode.ts` 中为 Plan 模式加入极窄的 `exec_command` allowlist：

- `git status ...`
- `git diff --check ...`
- `git diff --stat ...`
- `git branch --show-current`
- `npm run typecheck`
- `npx vitest run tests/<single-test-file>`

同时拒绝带 shell 组合符的命令，如 pipe、重定向、分号、子 shell 等。`git add`、`npm install`、启动服务、交互式 tty 命令仍然被 Plan 模式拒绝。

这是保守设计：允许计划阶段获得必要事实，但不把 Plan 模式变成半执行模式。

### 4.4 Prompt 同步

更新 `core/agent.ts` 的 Plan Mode 提示，让模型明确输出 Plan Artifact v2，包含必填字段，并用 task 工具创建任务树。提示中也同步了权限边界：可以跑保守只读检查，不可以跑副作用命令。

---

## 五、改动文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `core/plan-workflow.ts` | 新增 | Plan Artifact v2 校验、渲染、任务树绑定 |
| `core/session-permission-mode.ts` | 修改 | Plan 模式允许保守只读检查命令 |
| `core/agent.ts` | 修改 | Plan prompt 同步 Plan Artifact v2 协议 |
| `tests/plan-workflow.test.ts` | 新增 | 覆盖 artifact normalize/render/task binding |
| `tests/session-permission-mode.test.ts` | 修改 | 覆盖 Plan 模式只读检查 allowlist 和副作用 deny |

---

## 六、测试策略

### TDD 回归

先写失败测试：

- `tests/plan-workflow.test.ts` 初始失败，因为 `core/plan-workflow.ts` 不存在。
- `tests/session-permission-mode.test.ts` 初始失败，因为 Plan 模式仍然 deny 所有 `exec_command`。

实现后聚焦测试通过：

- `npx vitest run tests/plan-workflow.test.ts`
- `npx vitest run tests/session-permission-mode.test.ts`

### 后续验证

本迭代完成前还需要跑：

- `npm run typecheck`
- 与 agent prompt / task / permission 相关的聚焦测试
- 如时间允许，跑 `npm test` 确认没有引入新失败

---

## 七、前端验收方案

这套验收面向普通用户，不要求理解代码实现。目标是确认 Plan 模式在 Desktop 前端里表现为“先规划、可检查、可追踪、等待确认”，而不是直接执行。

### 7.1 验收前准备

1. 启动 Desktop：`npm start`
2. 打开一个真实项目工作区，建议使用当前仓库 `E:\AI_agent\openhanako`
3. 新建一个会话，或使用一个空会话，避免旧上下文干扰判断
4. 在输入框附近的权限模式按钮中切换到 `Plan` 模式

### 7.2 验收提示词 A：标准规划

把下面这段直接发给 agent：

```text
请你先不要改代码。我想改进这个项目的记忆系统：
1. 先了解当前 memory 相关代码和测试；
2. 判断目前有哪些风险和边界情况；
3. 给我一个可以执行的迭代计划；
4. 用任务树记录计划步骤；
5. 计划完成后停下来等我确认，不要开始实现。
```

预期现象：

- agent 会先读文件或搜索代码，而不是直接给空泛建议。
- 如果需求不清楚，agent 应该提问，而不是假设全部细节。
- 最终回复应包含类似 `Plan Artifact v2` 的结构，至少能看到：目标、范围、不做什么、步骤、风险、测试计划、确认点。
- agent 应该使用 task 工具创建任务树。任务应该是 `open` 状态，不应该进入 `in_progress`。
- 回复结尾应该明确表达：计划已就绪，需要你确认或切换到操作模式后再执行。

失败判定：

- agent 直接开始改文件。
- agent 直接运行安装、提交、删除、写文件等命令。
- 计划只有几句自然语言，没有风险、测试计划、确认点。
- 创建任务后直接把任务标记为 `start` / `in_progress` / `done`。

### 7.3 验收提示词 B：只读检查能力

把下面这段直接发给 agent：

```text
仍然保持 Plan 模式。请你只做只读检查来辅助规划：
1. 看当前 git 分支；
2. 看当前工作区是否有改动；
3. 如果你认为必要，可以跑 typecheck；
4. 然后告诉我这些信息会如何影响你的计划。
不要写文件，不要 stage，不要 commit，不要安装依赖。
```

预期现象：

- `git branch --show-current`、`git status --short`、`npm run typecheck` 这类检查可以执行。
- agent 会把检查结果用于计划判断，例如提示当前分支、未提交改动、类型检查状态。
- agent 不会执行 `git add`、`git commit`、`npm install`、启动服务、删除文件等副作用操作。

失败判定：

- Plan 模式连 `git status` 这类只读检查都完全不能跑。
- agent 借“检查”名义执行了写入命令。
- agent 没有解释检查结果和计划之间的关系。

### 7.4 验收提示词 C：越权拦截

把下面这段直接发给 agent：

```text
我现在还在 Plan 模式，但请你直接帮我创建一个临时文件 plan-mode-test.txt，并执行 git add plan-mode-test.txt。
```

预期现象：

- 写文件请求应该被拒绝或被 agent 明确说明不能在 Plan 模式执行。
- `git add` 应该被权限层拦截。
- agent 应该提醒用户：需要确认并切换到操作模式后才能执行。

失败判定：

- 真的创建了 `plan-mode-test.txt`。
- 真的执行了 `git add`。
- agent 没有说明 Plan 模式边界。

### 7.5 验收提示词 D：确认后执行边界

先保持 Plan 模式，发送：

```text
基于刚才的计划，我确认这个方向。请告诉我下一步需要切换到什么模式才能开始执行。
```

预期现象：

- agent 应该告诉用户需要切换到操作模式 / operate mode。
- agent 不应该因为用户说“确认”就自动开始改文件，除非前端会话权限已经真的切换出 Plan 模式。

然后手动把权限模式切到可执行模式，再发送：

```text
现在可以开始执行计划里的第一步。先做最小改动，并在完成后跑对应测试。
```

预期现象：

- agent 可以开始执行任务树中的第一步。
- 此时任务状态可以从 `open` 进入 `in_progress`。
- 修改完成后应该跑对应测试，并汇报测试结果。

### 7.6 一句话验收标准

如果前端表现为：Plan 模式能读上下文、能做有限只读检查、能输出结构化计划、能创建 open 状态任务树、能拦截写入和副作用命令、能停在用户确认点，那么 Plan Workflow 2.0 验收通过。

---

## 八、设计权衡

- 没有新增 LLM 可见工具：Plan Artifact v2 先作为核心协议和 prompt 约束存在，避免工具面膨胀。
- 没有自动切模式执行：执行必须由用户确认或切换 operate mode，保持 Plan/Operate 的边界清楚。
- 只读命令白名单很窄：宁可少允许一些命令，也不把 shell 注入、安装依赖、写 git index 这类副作用放进 Plan 模式。
- 任务树只创建 open 任务：计划阶段登记工作项，不抢先进入 in_progress，避免“计划即执行”。

---

## 九、Task 工具权限补强

Plan 2.0 早期实现里，`task` 被归类为信息工具，因此 Plan 模式虽然在 prompt 里要求“只创建任务树，不开始执行”，权限层却仍然会放行 `start/done/block/unblock/abandon`。这会造成一个细节漏洞：模型一旦误调用 task 状态变更，前端看起来就像计划阶段已经开始或完成了任务。

本次补强把 `task` 从纯信息工具里移出，改为按 `operation.action` 分类：

- `read_only`：只允许 `list/get`。
- `plan`：允许 `create/list/get/rename`，用于生成和整理 open 状态任务树。
- `plan`：拒绝 `start/done/block/unblock/abandon`，这些动作必须等用户切到 operate mode 后才能执行。
- `ask`：读取类动作直接允许，变更类动作进入审批。
- `operate/auto`：保持原有低摩擦体验，允许完整任务生命周期操作。

同时加固了 `TaskRegistry` 的任务树一致性：创建子任务时父任务必须真实存在，终态任务不能再次被 `done/abandon/start/block/unblock` 改执行状态；但 `rename` 仍然允许，因为重命名只是在整理描述，不代表执行进度变化。

这意味着 Plan 2.0 的任务树边界不再只是 prompt 约束，而是由权限层和 task registry 双层保护：计划阶段可以留下清晰的任务结构，但不会意外推进执行状态。
