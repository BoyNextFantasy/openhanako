# Git 工作流（Fork + Upstream）

本项目的 Git 工作流说明。用于管理「自己的开发」和「同步官方更新」之间的关系。

---

## 你的三个仓库

```
官方仓库 (upstream)
  └── https://github.com/liliMozi/openhanako
       ↓ fork（公开）
你的 GitHub 仓库 (origin)
  └── https://github.com/BoyNextFantasy/openhanako
       ↓ clone
你的本地仓库
  └── E:\AI_agent\openhanako
```

---

## 核心原则

**永远不要在 main 分支上直接写代码。**
main 只做一件事：同步官方最新代码。

你的所有开发工作都在独立分支上进行。

---

## 查看当前状态

```bash
# 查看所有分支
git branch -a

# 查看远程仓库地址
git remote -v

# 查看提交历史
git log --oneline --all --graph -10
```

---

## 流程一：开发新功能

```bash
# 1. 确保 main 是最新的
git checkout main

# 2. 从 main 开一条新分支
git checkout -b 你的功能名
# 例如：git checkout -b fix-login-bug
# 例如：git checkout -b add-dark-mode

# 3. 写代码，然后提交
git add .
git commit -m "做了什么事"

# 4. 推到你自己的 GitHub（第一次推需要加 -u）
git push -u origin 你的功能名
# 之后再次推只需要：git push
```

**分支命名建议：**

| 前缀 | 含义 | 例子 |
|------|------|------|
| `feat/` | 新功能 | `feat/dark-mode` |
| `fix/` | 修 Bug | `fix/login-crash` |
| `refactor/` | 重构 | `refactor/api-routes` |
| `docs/` | 文档 | `docs/readme-update` |

---

## 流程二：官方更新了，合并到你这边

### 情况 A：你还只改了代码，没推过

```bash
# 1. 先把你当前的修改暂存起来
git stash

# 2. 拉官方最新代码到 main
git checkout main
git pull upstream main

# 3. 回到你的分支
git checkout 你的功能名

# 4. 把 main 合并进来
git merge main

# 5. 恢复你之前暂存的修改
git stash pop
```

### 情况 B：你已经提交并推过了

```bash
# 1. 拉官方最新到 main
git checkout main
git pull upstream main

# 2. 回到你的分支，合并 main
git checkout 你的功能名
git merge main

# 3. 如果文件有冲突，手动解决后提交
git add .
git commit -m "merge: 合并官方更新"
git push
```

---

## 合并冲突怎么办？

当 `git merge main` 提示冲突时：

```bash
# 1. 查看哪些文件冲突了
git status
# 红色显示：both modified: xxx

# 2. 打开冲突文件，查找标记
# <<<<<<< HEAD     ← 你写的代码
# =======
# >>>>>>> main     ← 官方新代码
# 手动决定保留哪个，或都保留

# 3. 解决完后标记为已解决
git add 那个文件

# 4. 所有冲突解决后，完成合并
git commit
```

可以让我帮你解决，也可以自己用 VS Code 打开，有冲突可视化界面。

---

## 其他常用命令

```bash
# 查看当前在哪个分支
git branch

# 查看所有分支（包括远程）
git branch -a

# 切换到已有分支
git checkout main
git checkout 你的功能名

# 删除本地分支（已合并后）
git branch -d 你的功能名

# 删除远程分支
git push origin --delete 你的功能名

# 看看改了哪些文件
git status

# 看看具体改了什么
git diff
```

---

## 万一搞乱了怎么办

```bash
# 想放弃当前所有改动，回到上次提交的状态
git checkout -- .

# 想放弃当前分支的所有提交，变回和 main 一样
git reset --hard main

# 后悔了想反悔（还没 push）
git reflog  # 找到你想回去的 commit id
git reset --hard 那个id
```

> **注意：** `reset --hard` 很危险，会丢失未提交的代码。不确定时问我。

---

## 一句话总结

| 要做什么 | 命令 |
|---------|------|
| 拉官方最新 | `git pull upstream main` |
| 开新分支开发 | `git checkout -b 分支名` |
| 合并官方更新到你的分支 | `git merge main` |
| 推到自己 GitHub | `git push origin 分支名` |
| 切回 main | `git checkout main` |
