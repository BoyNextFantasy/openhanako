# UI 品牌重塑与参赛改版（ui-rebrand-competition）

> 分支：`iter/ui-rebrand`（基于 develop，b8c6f94c）
> 日期：2026-09-02 ~ 09-03
> 目标：以参赛为目的的外观系统性迭代——品牌重塑、人格体系、深色旗舰主题、聊天流与输入区/侧边栏/右栏的布局模型级重构、图标全面重绘。**不改任何业务逻辑与后端。**

---

## 一、背景与决策

项目 fork 自上游（分叉点 2026-06-28，本地 107 提交），参赛需要"绝对的差异化"：不能只是换色，要从品牌名、角色体系、布局模型、图标语言四个层面系统性改变，同时**功能与按钮一个不丢**。

关键决策（用户逐轮确认）：
1. **品牌名 Satori**（7 月已有 brand-satori 迭代基础，package.json/appId 已是它）
2. **角色去拟人化**：Hanako/Ming/Kong/Butter → 工作风格人格 Muse/Breeze/Sage/Zen（SVG 徽标），yuan 数据 key 不动（三方契约）
3. **聊天流**：左右气泡 → 角色标签全宽块（用户选定）
4. **输入区**：模式胶囊工具栏上置（用户选定）
5. **左侧边栏**：单列 → 44px 图标栏 + 会话面板双栏（用户选定，VSCode 式）
6. **右侧工作台**：分段切换方案被用户否决（"丑、内容常为空"），返工为"只留工作台+本次对话 + 内容布局重设计"——**按用户实测反馈砍掉过度设计是本轮重要教训**
7. **图标**：只换 SVG path 形状，尺寸属性一律不动（用户硬约束）

## 二、改动清单（96 文件，+1801/-834）

### A. 品牌重塑（fork 痕迹清理）
- HanaAgent/裸 Hana 全库归零：8 个 html title、main.cjs 托盘/窗口标题/errorBox、5 个 locales、manifest、bootstrap；appId `com.hanako.app`→`com.satori.app`
- AboutTab：© Satori Team、GitHub 指向 BoyNextFantasy；**LICENSE_TEXT 保留原版权行并追加团队行**（Apache 2.0 合规要求，藏于展开层）
- package.json author/install:local/publish owner/maintainer、auto-updater 更新源全部去 liliMozi
- agent 名兜底 'Hanako'→'Muse'（~20 处）、单实例锁名→Satori
- **白名单（刻意不动）**：`hana-*` 类名/事件/localStorage、`window.hana`、`~/.hanako`、`X-Hana-*` 协议头、`HANA_SERVER_SOURCE_REVISION`、yuan key——用户界面不可见，动则破坏老用户数据迁移

### B. 人格体系
- 4 个 SVG 徽标（desktop/src/assets/{muse,breeze,sage,zen}.svg）：Muse 青蓝 ✦ / Breeze 嫩绿 ≋ / Sage 堇紫 ◈ / Zen 月白 ◐
- shared/yuan-visuals.ts 换血并补上原表缺失的 kong 条目（原 fallback 兜底）
- 5 语言 persona 文案：types 标签（"缪斯 · 温暖创意，均衡发挥"式）、splash/welcome 台词（后改极客启动日志风）、主题副标题（Butter/Ming→清风/智者）
- YuanSelector 显示 key 的唯一出口改走映射表（Muse/Breeze/Sage/Zen）

### C. aurora 深色旗舰主题
- themes/aurora.css：完整 45 token（深蓝黑 #0D1220 底、电光蓝→紫 accent、WCAG AA、--*-rgb 配套）
- registry 注册 + paperTextureBlockedThemeIds 黑名单两处 + 5 语言主题名；theme-registry.test 计数 11→12
- 玻璃拟态：`[data-theme="aurora"]` 作用域 + `@supports not (backdrop-filter)` 降级变量——**踩坑**：全局文件命中不了 CSS Modules hash 类，质感变体必须写进各 module.css 的 `:global([data-theme="aurora"] &)` 块

### D. 布局模型级重构（核心）
1. **聊天流**：messageGroup 对齐 flex-end→stretch 全宽；messageUser 气泡→左侧 3px accent 竖线+浅底引用块；avatarRow→角色标签头（18px 徽标+名字+hairline，用户名 accent 加粗）；message 92%→100%
2. **输入区**：新增 .input-toolbar-top（模式胶囊+上下文环+模型选择器上置），InputControlBar 只留附件/斜杠/录音/发送（props 转 optional）；卡片 24px 胶囊→10px 方形；发送键 8px 圆角 accent 实底
3. **左侧边栏**：ChatSidebarContent 双分支——showActivityBars=true 走新 `.sidebar-body > .sidebar-rail(44px) + .sidebar-main`，移动端 legacy 分支 DOM 原样（**绕开 mobile-entry.css 人肉副本双写**，MobileApp.test 零影响）；rail 按钮 aria-label 承载原可访问名、data-tip CSS tooltip、activePanel 驱动激活态、设置/收起移底部；use-sidebar-resize 最小宽 180→220
4. **右侧工作台**：先做了分段切换（SEGMENTS 五段），**用户验收否决**后返工：撤分段、移除三个常空卡（TodoCard/WorkflowCard/ActivityCard 组件保留不渲染）、SessionStatusCard dt/dd 列表→信息瓦片后按反馈改 4×1 横排行（label 左灰/value 右蓝 mono 强调）；DeskSection 工具钮四枚图标化收搜索行右端（26→24px 统一）
5. **对齐体系**（用户多轮反馈收敛）：卡片 padding 统一 10px（!important 压过卡片皮肤类）、行高统一（tabs/search/rail 30/26px 族）、切换块 tabSlider 隐藏→两枚分立方形切换块（选中 accent 实底白字）

### E. 图标重绘（只换 path，尺寸属性不动）
- rail：活动=信标（中心点+双弧）、计划=剪贴板对勾、Skills=星阵、接入=节点连线、设置=圆心八辐条
- 输入区：附件=回形针托盘、slash=圆角四芒星、推理深度=三层菱形堆叠、录音=胶囊麦、发送=右箭头
- 消息：复制圆角双页、截图取景框、全选圆点清单、重新生成开口圆环+箭头、编辑斜笔
- 工作台：过滤描边漏斗、排序双向箭头、项目技能描边闪电
- **计划模式图标按用户要求保留**；Satori 应用图标（icon.png/ico）用 PowerShell GDI+ 程序化绘制（scripts/generate-satori-icon.ps1，6→7 帧补 24px，深空圆角底+四芒星）

### F. 测试同步（9 个文件）
ChatSidebar.test（兄弟文本断言→rail aria-label 顺序）、yuan-visuals.test（新 symbol/accent/avatar）、message-parser/ProcessFoldBlock（MOOD/PULSE→MUSE/FLOW）、desktop-single-instance-lock（Satori-dev）、screenshot.test（SVG 兜底头像）、server-connection.test（Local Satori）、windows-icon-contract（appId+24px 帧）、block-extractors/computer-app-approval（Satori 文案）、theme-registry.test（12 主题）

## 三、踩坑记录

1. **主题作用域 × CSS Modules**：`[data-theme] .local-class` 在全局文件命中不了 hash 类——主题专属质感必须走 `:global([data-theme="x"] &)` 写进 module.css
2. **单实例锁造成的"改了没生效"假象**：旧实例驻留托盘时新启动被重定向到旧窗口——验收前必须彻底退出
3. **用户实测否决过度设计**：分段切换条（五段）被否，"进程/Workflow/子助手内容常为空就不该硬塞"——信息架构以实际内容密度为准，不堆空卡
4. **对齐是参照系问题**：搜索框与切换块左缘不齐的根因是三层（卡片皮肤/内容区/根）内边距叠加不一致，`!important` 统一 10px 才压住
5. **CJK 替换**：sed 词边界 `\b` 对韩文失效，需无边界精确替换
6. **PC 探活式验收**：全量测试前必须关应用（14700 被占→路由测试 503 假失败）

## 四、测试与验证

- 每轮：typecheck 0 errors + 定向回归（ChatSidebar/RightWorkspacePanel/MessageActions 三兄弟/DeskSection/InputArea 全家/theme-registry）+ build:renderer
- 全量：与 develop 基线差集 = 0（基线 45 失败为既有环境性：symlink/phone/eval/jieba 类）
- 用户七轮目测验收驱动，方向修正 3 次（深度文档→单一背诵文件；分段切换→返工；工具行两轮收敛）

## 五、未做与后续

- 会话列表项造型、设置页 17 tab 形态、亮色主题校准（候选）
- 图标第二批：FileKindIcon 文件类型族、笺 chevron 等
- icon.icns（mac）未重做
- 若公开发布：Apache 2.0 许可证与 NOTICE 义务需法务确认
