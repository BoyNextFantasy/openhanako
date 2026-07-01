# Git 工作流

## 分支结构

```
main            — 只同步官方上游代码，永远不直接修改
develop         — 主开发分支，所有迭代的合集，永远处于可运行状态
iter/<迭代名>    — 每轮迭代的独立工作分支，从 develop 分出
```

- **`main`**：只从 `upstream` 拉官方 HanaAgent 更新，从不在此分支写代码
- **`develop`**：你所有改动的全集，GitHub 上选此分支即为最新代码
- **`iter/<迭代名>`**：每次迭代的工作分支，完成后合并回 develop，出问题则直接丢弃

## 日常开发

```bash
# 开新迭代
git checkout develop
git checkout -b iter/你的迭代名

# 开发…提交…
git add .
git commit -m "做了什么事"

# 完成后合并回 develop
git checkout develop
git merge iter/你的迭代名
git push origin develop

# 可选：推送迭代分支存档
git push origin iter/你的迭代名
```

## 迭代出问题怎么办

```bash
# 直接丢弃，develop 不受影响
git checkout develop
git branch -D iter/有问题的迭代
```

## 同步官方更新

```bash
git checkout main
git pull upstream main
git checkout develop
git merge main
# 解决冲突后
git push origin develop
```

## 常用命令

| 要做什么 | 命令 |
|---------|------|
| 开新迭代 | `git checkout develop -b iter/xxx` |
| 提交 | `git add .` → `git commit -m "xxx"` |
| 推 develop | `git push origin develop` |
| 推迭代存档 | `git push origin iter/xxx` |
| 切回 develop | `git checkout develop` |
| 看所有分支 | `git branch -a` |
| 看改了啥 | `git status` → `git diff` |
