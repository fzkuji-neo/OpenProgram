# 文件夹 Git 胶囊

会话用到的每个工作目录，只要位于 Git 仓库里，它在输入框环境条里的文件夹胶囊就多出一个 git 半边。git 半边回答"这个目录在哪个分支、改了什么"，菜单里放聊天时需要的几个 Git 操作，不必离开会话：切分支、在 worktree 里工作、审阅修改、开 PR。

## 哪些目录有胶囊

- **主项目目录**：会话绑定了真实项目时。默认的主目录项目没有胶囊——它的仓库是 OpenProgram 自己的存储，不是用户的代码。
- 每个**额外工作目录**。
- 不在 Git 仓库里的目录什么都不显示。

**同一个仓库**里的两个目录（比如项目根目录和它的一个子目录）分支、修改、PR 都相同，只显示一个 git 半边。每个 git 半边按顺序认领自己的仓库根目录——项目在前，工作目录按列表顺序——顺序最小的显示（`components/chat/top-bar/git-chip-registry.ts`）。同一仓库的不同 worktree 根目录不同，各自保留 git 半边。

## 胶囊

每个文件夹一个凸起胶囊（`components/chat/top-bar/folder-pill.ts`），中间一条细线分成两段，各自响应 hover 和点击。左段是文件夹：图标、名字；工作目录的 ✕ 只在 hover 或键盘聚焦时出现。点击打开项目菜单。右段是 git：Solar `git-branch`，分支名的最后一段（`claude/foo` 显示 `foo`；HEAD 游离时显示短提交号），再接未提交的 `+N −N` diff badge——绿半边、红半边，与文件修改卡片一致。未跟踪的新文本文件按新增行计入。改动全是二进制文件（没有行数）时，badge 显示中性灰色的“N 个文件”，第 3 级的圆点也是灰色，不显示“+0 −0”。干净的目录只显示分支。两段都撑满胶囊高度，hover 底色覆盖整个半边。tooltip 里有仓库、完整分支名和计数。

整行放不下时逐级收缩：

| 级别 | 显示 |
|---|---|
| 0 | 全部 |
| 1 | 文件夹名和分支名截到约 12 个字加省略号；Local chip 只留图标 |
| 2 | 收起分支名：分支图标 + diff badge |
| 3 | 隐藏全部名字；diff badge 变成左绿右红的小圆点 |

测量规则见 [`composer-responsive-controls.html`](composer-responsive-controls.zh.html)。

## 菜单

1. **标题**：仓库名；当前目录是附属 worktree 时带 `worktree` 标签。
2. **修改**："N 个未提交文件 +N −N"。点击以 workspace 范围打开 Review，它本来就按 Git 对比每个工作目录。发送第一条消息前没有会话可审阅，这一行不响应。与上游有领先 / 落后时接着显示一行。
3. **分支**：筛选框 + 本地分支，按最近提交排序（最多五十个）。点分支就地执行 `git switch`；未提交修改按 git 本身的规则随切换带走，git 拒绝时显示它的报错。输入不存在的名字会出现"新建分支"，回车同效。已在其他 worktree 检出的分支带 `worktree` 标签，点击改为把这个目录位置换到那个 worktree。
4. **工作位置**：当前位置（本地仓库或 worktree，打勾）、仓库的其他 worktree，以及"在 <输入的分支> 上新建 worktree"。新 worktree 建在仓库旁边的 `<repo>-worktrees/<branch>`，从不建在仓库里面，原目录的文件和未提交修改保持不动。"换到 worktree"按目录位置分三种：
   - 工作目录：在会话的目录列表里替换；
   - 未发送草稿的主目录：草稿的项目改指向该 worktree（登记为项目）；
   - 已开始会话的主目录：已固定，worktree 作为额外工作目录加入，菜单里有说明。
5. **Pull request**：
   - 分支已有打开的 PR：显示"查看 PR #N"，在系统浏览器打开；
   - 否则"创建 PR"：推送分支（`git push -u origin HEAD`），以默认分支为基执行 `gh pr create --fill`，然后打开新 PR。没有 `gh`、没有 `origin`、HEAD 游离或当前就在默认分支时禁用，并在下方写明原因。分支相对基分支没有新提交时后端也会拒绝；
   - 有未提交修改时，"让 agent 提交并创建 PR…"把一段现成指令填进输入框（不发送）——写提交信息和 PR 描述是 agent 的活。

git 或 `gh` 的报错显示在菜单底部，菜单保持打开，方便重试。

## 刷新时机

不轮询。胶囊在以下时机读取目录状态：挂载和目录变化时；菜单打开时（只有这次会同时列分支、查 PR，二者开销更大）；所在会话一轮结束时；窗口重新获得焦点时；项目变化时；同一仓库上任何胶囊执行修改后（`op:git-changed`）。

## 后端

逻辑在 `openprogram/worktree/folder_git.py`；`ws_actions/folder_git.py` 把它挪出事件循环并组装回复。每条回复回显 `path`，并发的多个胶囊各取各的。

| 动作 | 回复 | 做什么 |
|---|---|---|
| `git_folder_status` | `git_folder_status` | `status --porcelain=v2 --branch`（分支、上游、领先 / 落后、文件数），`diff --numstat HEAD`（行数），`worktree list`，默认分支，是否有 `origin`，是否有 `gh`；带 `include_branches` / `include_pr` 时再列分支、执行 `gh pr view` |
| `git_switch_branch` | `git_switch_branch_result` | `git switch [-c] <branch>` |
| `git_create_worktree` | `git_worktree_created` | `git worktree add [-b] <仓库旁的路径> <branch>` |
| `git_create_pr` | `git_pr_created` | 推送分支，`gh pr create --fill`，返回 URL（或已存在的打开 PR） |

状态读取带 `GIT_OPTIONAL_LOCKS=0`，不与用户自己的 git 命令争锁；带 `GIT_TERMINAL_PROMPT=0`，需要凭据的推送直接失败而不是卡住。

## 实现状态

- 项目目录和工作目录的胶囊、同仓库去重、切换 / 新建分支、worktree 列表 / 新建 / 切换、修改计数与 Review、创建 / 查看 PR、交给 agent：**已实现**。
- PR 的基分支选择（目前固定为仓库默认分支）和草稿 PR：**未实现**。
- pull / push / fetch 按钮，以及没有上游时相对默认分支的领先 / 落后：**未实现**。
