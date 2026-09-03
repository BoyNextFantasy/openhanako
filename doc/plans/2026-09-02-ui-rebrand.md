# 计划：参赛外观迭代——品牌重塑 + 深色旗舰主题 + 三屏重塑 + 布局微调

> 2026-09-02 获用户批准。分支：`iter/ui-rebrand`（基于 develop）。
> 本文档是执行接口：执行方只依赖本文档干活。

## 0. 决策基线

- **品牌名：Satori**（UI 里所有 HanaAgent/Hanako 可见文案统一到 Satori）
- **角色：去拟人化**——4 个"工作风格人格"替换 Hanako/Ming/Kong/Butter，SVG 几何徽标
- **配色：新增深色旗舰主题 aurora（演示默认）+ 保留暖纸主题**
- **布局：微调**（输入区尺寸、控制栏按钮重排，功能与按钮总量不变）
- **内部标识符不动**：hana-* 类名/事件/localStorage/window.hana（用户界面不可见），白名单记录在迭代文档

## 1. 品牌映射表（旧 → 新）

| 旧 | 新 | 说明 |
|---|---|---|
| HanaAgent | Satori | 产品名，全局可见文案 |
| Hana Quick Chat | Satori Quick Chat | 窗口标题 |
| 裸 Hana（文案中） | Satori | "Hana 服务"等 |
| com.hanako.app | com.satori.app | 与 package.json 对齐 |
| 'Hanako' 产品名兜底 | 'Satori' | 错误弹窗等 |
| 'Hanako' agent 名兜底 | 'Muse' | AssistantMessage 等当前 agent 名兜底 |
| 角色 hanako（显示名） | Muse 缪斯（默认·温暖创意·青蓝） | yuan key 不动 |
| 角色 butter（显示名） | Breeze 清风（轻快简洁·嫩绿） | yuan key 不动 |
| 角色 ming（显示名） | Sage 智者（严谨深思·堇紫） | yuan key 不动 |
| 角色 kong（显示名） | Zen 禅（极简空寂·月白） | yuan key 不动 |
| Hanako.png 等角色立绘 | SVG 徽标（muse/breeze/sage/zen） | assets 新增 |
| AboutTab © liliMozi + GitHub 链接 | 团队信息 | fork 痕迹清理 |
| auto-updater owner=liliMozi repo=openhanako | 禁用或指向自己仓库 | 比赛版 |
| package.json author=liliMozi | 团队署名 | |

## 2. 逐项改动清单

### A. 品牌统一为 Satori
1. 8 个 html `<title>`；2. main.cjs 托盘/窗口标题/errorBox/APP_USER_MODEL_ID；3. 5 个 locales 品牌词（角色词留 B 步一起）；4. AboutTab；5. auto-updater/installer.nsh；6. 兜底字符串分类替换；7. package.json author/description

### B. 角色去拟人化（显示层换血，yuan 数据 key 不动）
8. 人格体系定稿（上表）；9. 4 个 SVG 徽标 + yuan-visuals.ts 替换 avatar/symbol/accent；10. 渲染层移除旧 png 引用（OnboardingApp/SplashApp/agent-helpers/settings-api/YuanSelector/AgentCreateOverlay，旧 png 保留不引用）；11. locales 的 yuan.types/splash/welcome/placeholder/主题副标题换新人格文案；12. YuanSelector 显示 key 的出口改走 i18n label

### C. aurora 深色旗舰主题
13. themes/aurora.css 完整语义 token（对照现有主题 45 变量结构；深蓝黑底、半透明面板、电光蓝→紫 accent、WCAG AA、--*-rgb 配套）
14. theme-registry-data.json 注册 + 5 locales 主题名；PAPER_TEXTURE_BLOCKED_THEME_IDS 两处（JSON+CSS）加 aurora
15. 玻璃拟态限定 [data-theme="aurora"] + @supports 降级；auto 暗色仍映射 midnight

### D. 三屏重塑
16. splash 接入主题色 + 新徽标动画；17. onboarding 视觉升级 + ThemeStep 加 aurora + 新人格展示；18. Chat/InputArea module.css 的 aurora 变体

### E. 布局微调（总量不变）
19. 输入区胶囊化 + 控制栏重排；20. 标题栏/侧边栏 aurora 质感；21. 契约测试同步（InputArea.layout.test.ts 等）

### F. 动效层
22. animations.css + motion：进场/过渡/主题切换淡入防闪白

## 3. 坑位备忘
- 契约测试只更新断言值不删意图（focus-ring 可访问性绝不能删）
- mobile-entry.css：不动全局类结构则安全；动了必须双写
- yuan key 是 core/server/renderer 三方契约，只改显示层；onboarding AGENT_ID='hanako' 保持
- theme-registry 缺字段启动即 throw，新主题字段逐项对照
- preserveLegacyCss：aurora.css 放 themes/ 自动独立输出
- 角色卡服务端 API（/api/character-cards）属 core 层，本次只改前端显示

## 4. 验收标准
- desktop/src 非测试代码用户可见面 grep 无 HanaAgent/Hanako/Ming/Kong/Butter/小花（内部 hana-* 白名单除外）
- 4 新人格在 splash/onboarding/设置/聊天头像一致显示；8 窗口标题/托盘/About 全部 Satori
- aurora↔warm-paper↔midnight 切换无破相；全流程前后截图存档
- npm run typecheck 0 errors；npm test 无新失败；npm run build:renderer 成功；npm start 正常
- 子 agent 复审：品牌残留、契约测试遗漏、mobile 未碎、硬编码色遗漏

## 5. 执行顺序与状态
1. ✅ 计划落盘（本文档）
2. 分支 iter/ui-rebrand
3. A 品牌清理 → 4. B 人格+SVG → 5. C 主题 → 6. D 三屏 → 7. E 布局 → 8. F 动效 → 9. 测试同步 → 10. 全量验证 → 11. 子 agent 复审修复 → 12. 迭代文档 doc/iterations/ui-rebrand-competition.md

## 6. 执行记录
- 2026-09-02：计划获批准，开始执行。分支 iter/ui-rebrand 已建。
- 2026-09-02（A 步完成）：HanaAgent→Satori 全库归零（含 main.cjs/bootstrap/locales/8 html/manifest/测试断言，构建产物 main.bundle.cjs 一并替换）；裸 Hana 文案（Local Hana/Hana Studio/是否允许 Hana 控制/locales 各语言含韩文混排）清零；com.hanako.app→com.satori.app；AboutTab 版权行改 Satori Team、GitHub 指向 BoyNextFantasy（LICENSE_TEXT 保留原版权行并追加 Satori Team 行——Apache 2.0 衍生作品合规要求，主视觉不露馅）；package.json author/install:local/publish owner/maintainer 全部去 liliMozi；auto-updater owner→BoyNextFantasy；typecheck 0 errors。
- 2026-09-02（B 步 ~85%）：人格体系定稿（hanako→Muse 缪斯 #5B8DEF ✦ / butter→Breeze 清风 #6FBF8F ≋ / ming→Sage 智者 #9C7BD9 ◈ / kong→Zen 禅 #A8B8C8 ◐，yuan key 不动）；4 个 SVG 徽标落地（desktop/src/assets/{muse,breeze,sage,zen}.svg）；shared/yuan-visuals.ts 换血并新增 kong/zen 条目（原表缺 kong，走 fallback）；agent 名兜底 'Hanako'→'Muse' 约 17 处、锁名→'Satori'；'Hanako.png' 等 tsx 引用全清（SplashApp/OnboardingApp/agent-helpers/settings-api/YuanSelector/AgentCreateOverlay）；SplashApp 默认头像→muse.svg、英文 fallback 台词去拟人性别；locales avatar 字段 4 组映射→SVG；zh/zh-TW "小花"→"缪斯"。typecheck 0 errors。
- **B 步剩余（下批）**：locales 角色显示文案改写（yuan.types 标签/splash/welcome 台词/主题副标题 grassAromaMode:"Butter"、contemplationMode:"Ming"，ja/ko/en 各剩 2 处图片/角色词）；YuanSelector 显示 key 出口改走 i18n label；新人格台词文案撰写（5 语言）。
- **白名单（内部标识符保留）**：X-Hana-File-* HTTP 头（server 协议）、hana-* 类名/事件/localStorage、window.hana、~/.hanako、HANA_SERVER_SOURCE_REVISION、yuan key。
- **未 commit**：等待用户确认。
