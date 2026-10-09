# Git folder pills

Every working folder a conversation uses that sits inside a Git checkout
gets a git half in its folder pill in the composer's environment row. The pill answers "what branch is this folder on and what
has changed", and its menu holds the few Git actions a chat user needs
without leaving the conversation: switch branch, work in a worktree,
review the changes, open a pull request.

## Which folders get a pill

- The **main project folder**, when the conversation is bound to a real
  project. The default home-folder project has no pill: its repository
  is OpenProgram's own storage, not the user's code.
- Each **additional working folder**.
- Folders that are not inside a Git checkout show nothing.

Two folders inside the **same checkout** (the project root and one of
its subfolders, say) share one branch, one change set and one PR, so
only one git half shows. Each mounted git half claims its checkout root with an
order, project first and then working folders in list order, and the
lowest order wins (`components/chat/top-bar/git-chip-registry.ts`).
Separate worktrees of one repository have separate roots, so each keeps
its own git half.

## The pill

One raised pill per folder (`components/chat/top-bar/folder-pill.ts`)
with two segments separated by a hairline, each its own hover and click
target. The left segment is the folder: icon, name, and for a working
folder a ✕ that appears only on hover or keyboard focus. It opens the
project menu. The right segment is git: Solar `git-branch`, the last path
segment of the branch name (`claude/foo` shows `foo`; the short commit
id when HEAD is detached), and the uncommitted `+N −N` as a diff badge,
a green half and a red half, as on the file-change card. New untracked
text files count as added lines. When every change is binary (no line counts), the badge is a neutral "N files" and the level-3 dot is grey, never "+0 −0". A clean folder shows the branch alone. Both segments stretch to the full pill height, so each hover fill covers its whole half.
The tooltip carries repository, full branch and counts.

When the row runs out of room it squeezes one level at a time:

| Level | Shows |
|---|---|
| 0 | everything |
| 1 | folder and branch names capped near 12 characters with an ellipsis; the Local chip icon-only |
| 2 | branch name hidden: branch icon and diff badge |
| 3 | all names hidden; the diff badge becomes a half-green, half-red dot |

See [`composer-responsive-controls.html`](composer-responsive-controls.html) for the measuring rule.

## The menu

1. **Header**: the repository name, tagged `worktree` when this folder
   is a linked worktree.
2. **Changes**: "N uncommitted files +N −N". Clicking opens Review in
   its workspace scope, which already diffs every working folder
   against Git. Before the first message there is no session to review,
   so the row is inert. Ahead/behind against the upstream follows
   when non-zero.
3. **Branch**: a filter field and the local branches, most recent
   commit first (up to fifty). Clicking a branch runs `git switch` in
   place. Uncommitted changes travel with the switch as plain git
   allows; git's own refusal is shown as the error. Typing a name that
   does not exist offers "Create branch", and Enter does the same. A
   branch already checked out in another worktree is tagged `worktree`;
   clicking it moves the folder slot to that worktree instead.
4. **Work in**: the current location (local checkout or worktree,
   checked), the repository's other worktrees, and "New worktree on
   <typed branch>". A new worktree is created beside the repository at
   `<repo>-worktrees/<branch>`, never inside it, so the source folder's
   files and uncommitted changes stay where they are. What "move to a
   worktree" means depends on the folder slot:
   - a working folder is replaced in the conversation's folder list;
   - the main folder of an unsent draft re-points the draft's project
     to the worktree (registered as a project);
   - the main folder of a started conversation is fixed, so the
     worktree joins as an additional working folder, and the menu
     says so.
5. **Pull request**:
   - an open PR for the branch shows "View pull request #N" and opens
     it in the system browser;
   - otherwise "Create pull request" pushes the branch
     (`git push -u origin HEAD`) and runs `gh pr create --fill`
     against the default branch, then opens the new PR. It is disabled,
     with the reason underneath, when `gh` is missing, there is no
     `origin`, HEAD is detached, or the branch is the default branch.
     The backend also refuses when the branch has no commits ahead of
     the base;
   - with uncommitted changes, "Commit & open PR with the agent…" puts
     a ready instruction in the composer (it does not send it), since
     writing the commit message and PR description is the agent's job.

Errors from git or `gh` appear at the bottom of the menu; the menu stays
open so the user can retry.

## Freshness

Nothing polls. A pill reads its folder's state on mount and when its
folder changes, when its menu opens (this is the only read that also
lists branches and looks up the PR, since both cost more), when a turn of
its conversation ends, when the window regains focus, when the project
changes, and after any pill's mutation on the same checkout
(`op:git-changed`).

## Backend

`openprogram/worktree/folder_git.py` holds the logic;
`ws_actions/folder_git.py` moves it off the event loop and frames the
replies. Every reply echoes `path`, so concurrent pills each take their
own answer.

| Action | Reply | Does |
|---|---|---|
| `git_folder_status` | `git_folder_status` | `status --porcelain=v2 --branch` (branch, upstream, ahead/behind, file counts), `diff --numstat HEAD` (line counts), `worktree list`, default branch, `origin` presence, `gh` presence; with `include_branches` / `include_pr`, the branch list and `gh pr view` |
| `git_switch_branch` | `git_switch_branch_result` | `git switch [-c] <branch>` |
| `git_create_worktree` | `git_worktree_created` | `git worktree add [-b] <beside-repo path> <branch>` |
| `git_create_pr` | `git_pr_created` | push the branch, `gh pr create --fill`, return the URL (or the existing open PR) |

Status reads run with `GIT_OPTIONAL_LOCKS=0` so they never contend with
the user's own git commands, and `GIT_TERMINAL_PROMPT=0` so a push that
needs credentials fails instead of hanging.

## Implementation status

- Pills for the project folder and working folders, same-checkout
  dedupe, branch switch / create, worktree list / create / move, change
  counts with Review, PR create / view, and agent hand-off:
  **implemented**.
- Base-branch choice for a PR (always the repository's default branch
  today) and draft PRs: **not implemented**.
- Pull / push / fetch controls and ahead/behind against the default
  branch when there is no upstream: **not implemented**.
