# Satori — AI 编程助手

基于 HanaAgent/Hanako 改造的 CLI 编程助手。技术栈：Node 24 + TypeScript + Pi SDK + SQLite。

## 当前迭代

见 `AGENTS.md` 地图 → `doc/迭代计划.md`

## 协作铁律

### 每次会话开始前
1. 确认当前在正确分支（非 main；develop 和 iter/* 都可以）
2. 读 `AGENTS.md` — 了解项目地图
3. 读 `doc/迭代计划.md` — 了解当前待办
4. 读最近的迭代文件（`doc/iterations/`）— 知道上次做了什么

### 每次改代码时
1. **先读后改** — 理解现有逻辑再动手；读 `tests/` 下对应的测试文件，了解测试模式
2. **不改的目录不做任何修改**（除非迭代计划指定）
3. **精准改动，不引入无关变化**
4. **全面搜索** — 删除/修改模块时，跨仓库 grep 所有引用（含 Desktop、测试文件），不遗漏调用点

### 每次改完后
1. **先跑类型检查**：`npm run typecheck`（0 errors）
2. **再跑测试**：`npx vitest run tests/xxx.test.ts` → `npm test`（不引入新失败）
3. **核实启动**：`npm start` 确认服务能启动（14700 端口）
4. **更新文档**：`doc/迭代计划.md` + `doc/iterations/<name>.md`
5. **等待用户决定提交**，不主动 commit / push

### 铁律
- **不降级** — 用最大努力解决用户要求
- **奥卡姆剃刀** — 修改代码以最简单方案为目标
- **不相信"应该没问题"** — 跑验证命令拿到实际输出才算完成

## 品牌命名
- 项目名：Satori | npm 包：`satori-cli` | 环境变量：`SATORI_HOME` | CLI：`satori`
- 包内保留 `hanako` / `HANA` 的代码引用不改（底层沿用原实现）

## Git 工作流
```
main       — 只同步上游，永不直接改
develop    — 所有迭代合集，永远可运行
iter/<名>  — 单次迭代工作分支，从 develop 分出
```
详见 `doc/git-工作流.md`
