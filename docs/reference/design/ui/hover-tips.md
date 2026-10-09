# Hover tips in the composer

Every control in the composer area (the environment row above the input
and the control row below it) explains itself on hover with the same
tooltip, `HoverTip` from `components/ui/tooltip.tsx`, never the browser's
native `title` bubble. The tip body is `TipBody`:

- **Title line**: what the control is and its current value, for example
  "Project: fzkuji.github.io", "Permissions: Auto mode", "Thinking
  effort: Medium", "Chat Agent: deepseek-flash".
- **Detail line** (muted, optional): the specifics a chip cannot fit, such
  as a full path, the full branch name and change counts, or what a click
  does ("Click to turn off.").

The tip appears after the pointer rests for 1.5 s, never while the control's own menu is open,
and is wider than the chip (up to 320 px, paths wrap anywhere).

| Control | Title | Detail |
|---|---|---|
| Channel (Local) | Channel: <name> | where the conversation runs; click to switch |
| Project segment | Project: <name> | folder path; fixed for this conversation, or click to choose |
| Working-folder segment | Working folder: <name> | full path; the agent can read and edit it |
| ✕ on a working folder | Remove from this conversation | files on disk stay |
| Git segment | <repo> · <full branch> | uncommitted files and +/−; worktree path; what the menu offers |
| Add folder | Add working folder | give the agent another folder |
| Web page chip | Web page: <title> | whether the agent can use it; click to toggle |
| Page preview chip | Show page preview | bring the page back as a floating preview |
| Goal chip | Goal | the goal text; click for progress and controls |
| Permission badge | Permissions: <mode> | the mode's description |
| Options (+) | Options | attach files, toggle tools / web search / sandbox |
| Tool chips | Tools / Web search / Sandbox / Unattended on | what it does; click to turn off |
| Effort | Thinking effort: <level> | how long the model thinks; click to adjust |
| Model badges | Chat Agent / Execution Agent: <model> | its role; click to change model |

## Implementation status

- All rows above: **implemented**.
- The send button keeps the native `title`: it is disabled exactly when its
  message matters most (paste lost, attachment loading), and a disabled
  button fires no pointer events for `HoverTip`. **Not migrated.**
- The Fast toggle keeps its existing hint text. **Unchanged by request.**
