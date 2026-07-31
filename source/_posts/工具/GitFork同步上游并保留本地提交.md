---
title: Git Fork 同步上游并保留本地提交
description: Git Fork 后如何同步上游仓库，同时保留自己的提交
tags:
  - Git
  - Fork
categories: 工具
mathjax: true
abbrlink: 854464f8
date: 2026-08-10 14:46:29
---

最近在用 [AlphaGPU/leetgpu-challenges](https://github.com/AlphaGPU/leetgpu-challenges) 练习时，我将原仓库 Fork 了一份，并且添加了本地测试脚本用于个人练习。我自己的仓库是 `git@github.com:Euler0525/leetgpu-challenges.git`，原始仓库是 `git@github.com:AlphaGPU/leetgpu-challenges.git`

Fork 之后，我在自己的分支上继续开发并提交了一些修改。与此同时，原仓库也在持续更新。于是两个仓库的提交历史逐渐产生了分叉：

```shell
             D---E---F    原仓库的新提交
            /
A---B---C
            \
             X---Y---Z    我自己的提交
```

现在希望做的事情是把原仓库后续的 `D、E、F` 同步过来，同时保留自己的 `X、Y、Z`。

Git 里解决这类问题通常有两种方式：`merge` 和 `rebase`。对于主要由自己维护的开发分支，我更倾向于使用 `rebase`，因为它最终可以把提交历史整理成一条比较清晰的直线。

---

首先需要明确 Git 中 `origin` 和 `upstream` 的含义。

我是从自己的 Fork 仓库 clone 下来的，因此默认的 `origin` 指向的是自己的仓库，而不是原仓库。执行

```shell
❯ git remote -v
origin  git@github.com:Euler0525/leetgpu-challenges.git (fetch)
origin  git@github.com:Euler0525/leetgpu-challenges.git (push)
```

为了后续方便同步原仓库，可以额外添加一个 remote，通常命名为 `upstream`

```shell
❯ git remote add upstream git@github.com:AlphaGPU/leetgpu-challenges.git
```

再次执行 `git remote -v`

```shell
origin  git@github.com:Euler0525/leetgpu-challenges.git (fetch)
origin  git@github.com:Euler0525/leetgpu-challenges.git (push)
upstream        git@github.com:AlphaGPU/leetgpu-challenges.git (fetch)
upstream        git@github.com:AlphaGPU/leetgpu-challenges.git (push)
```

之后要同步原仓库时，首先执行

```shell
git fetch upstream
```

`fetch` 的作用是获取远程仓库最新的 Git 对象和分支状态，并不会直接修改当前工作分支。假设最初双方都停留在 `A---B---C`，后来原仓库继续提交 `A---B---C---D---E---F`，而我自己的分支变成 `A---B---C---X---Y---Z`


执行 `git fetch upstream` 后，本地只是知道了 `upstream/main` 现在已经指向 `F`，此时整体关系大致是：

```shell
             D---E---F    upstream/main
            /
A---B---C
            \
             X---Y---Z    我的开发分支
```

代码本身还没有发生变化。接下来切换到自己的开发分支

```shell
git checkout my-branch
```

然后同步上游代码

```shell
git rebase upstream/main
```

执行之前，历史是

```shell
             D---E---F
            /
A---B---C
            \
             X---Y---Z
```

执行之后，会变成

```shell
A---B---C---D---E---F---X'---Y'---Z'
```

`rebase` 并不是简单地把 `X、Y、Z` 从一个地方搬到另一个地方。它实际上做的是

```shell
1. 找到当前分支相对于 upstream/main 独有的提交
2. 暂时记录这些提交带来的修改
3. 把当前分支移动到 upstream/main 最新的位置
4. 把原来的修改按照顺序重新应用一遍
```

也就是把 `X---Y---Z` 重新放在 `D---E---F` 后面，所以最终产生的是 `X'---Y'---Z'`。Git 的 commit hash 不只取决于修改了什么代码，还包含了父提交、作者、提交时间、提交信息以及对应的 tree 等内容。原来的 `X` 父提交是 `C`，rebase 后父提交是 `F`，因此 rebase 会改变 commit hash

如果自己的修改和上游修改碰巧作用在同一块代码上，rebase 过程中就可能产生冲突，这时候需要手动修改冲突文件。

解决完成之后

```shell
git add .
git rebase --continue
```

直到整个 rebase 完成。如果处理中途发现情况不对，也可以直接 `git rebase --abort` 放弃本次 rebase，回到操作开始之前的状态。

---

执行完上述操作后，自己的仓库远程是 `A---B---C---X---Y---Z`，本地现在是 `A---B---C---D---E---F---X'---Y'---Z'`，这时需要强制更新远程分支

```shell
git push --force-with-lease origin my-branch
```

整个流程最终可以归纳为

```shell
git remote add upstream git@github.com:AlphaGPU/leetgpu-challenges.git
git fetch upstream
git switch my-branch
git rebase upstream/main
git push --force-with-lease origin my-branch
```

除了 rebase，也可以直接使用 merge

```shell
git fetch upstream
git switch my-branch
git merge upstream/main
```

它同样能够把上游代码同步进来，但最终历史会变成

```shell
             D---E---F
            /         \
A---B---C               M
            \          /
             X---Y---Z
```

其中 `M` 是一个 merge commit。

Merge 和 Rebase 的区别不在于能不能把代码合到一起，因为两者最终都可以做到这一点。区别主要在于如何处理历史。

- `merge` 会保留原来真实存在的分叉，两条开发历史确实同时存在过，现在创建一个新的 commit 把它们连接起来；
- `rebase` 则会重新组织自己的历史，假装自己的开发工作一开始就是基于最新上游代码进行的；

注：本文操作仅限于对于个人维护的开发分支。这是一个既能保留自己的修改，又能让提交历史保持清晰的做法。
