# Goals in chat

A Goal keeps an objective active across ordinary chat turns. The current agent does the work with the conversation's tools, model, permissions and history. At the end of a successful turn, the runtime continues an active Goal with another ordinary chat turn. There is no nested working agent or automatic separate judge in chat mode.

## Start and plan

Enter `/goal <objective>`, or use **Programs → Workflow → goal → Use**. The form starts a chat Goal; it does not execute the Python Workflow. You can also explicitly ask the agent to create a Goal.

The agent uses `todo_create`, `todo_update` and `todo_list` to maintain a plan for multi-step work. New items created during Goal work are associated with the Goal and its revision. The Goal details refresh progress after each successful todo change and reconcile it again when a turn ends. Progress notification failures do not undo saved todos. The objective remains independent of the plan: checking every item does not by itself prove completion.

The agent must check current evidence against every requirement before calling `update_goal(status="complete")`. The runtime rejects completion while associated todos remain unfinished. This is a structural check; it is not independent semantic verification. A simple objective does not require an artificial todo list.

## Control execution

The Goal details retain the objective, status, usage and progress after page reload. When there are no todos, the badge and details omit todo progress without a placeholder; the Goal status remains visible. Use the existing chat input to add instructions, following its normal queue or steering mode.

- `/goal`: read the current state.
- `/goal pause`: save a pause and request cancellation of the current execution.
- `/goal resume`: continue a paused Goal with cumulative usage.
- `/goal edit <objective>`: save a new revision and pause; resume explicitly when ready.
- `/goal clear`: cancel the Goal.
- `/goal budget max_turns=10 max_tokens=10000`: change limits; zero removes a limit.

Goals have no round limit by default. Only an explicit positive `goal.max_turns` or start-time round budget sets a cap; reaching it is not completion. The progress badge shows todo completion, not execution rounds. Existing Goals retain their saved budgets: use `/goal budget max_turns=0` to remove an old round cap without resetting work or usage. Explicit token, active-time and cost limits use cumulative usage. A depleted budget must be increased or removed before resuming. Waiting time is excluded from active time. Automatic continuation does not expand tool permissions.

A failed or cancelled execution stops automatic continuation. Worker restart does not itself pause a chat Goal: compatible checkpoints resume under the automatic restart policy, and a successful turn completed during shutdown keeps a durable continuation notification. User pause, cancellation, exhausted budgets and explicit restart limits still prevent automatic work. Legacy recoverable pauses require explicit Resume. Unknown external effects and general external-event wakeups remain recovery limitations. A wait or unresolved execution is not evidence of Goal completion.

The state tools are short operations: `create_goal`, `get_goal`, and `update_goal`. They do not perform the task. The agent may mark `blocked` only after the same verified blocker recurs for at least three consecutive Goal turns with no independent work remaining. The runtime enforces the minimum turn count; the agent is responsible for verifying that it is the same blocker.

## Recovery and metering

Goal distinguishes a terminal execution from permission to start a new chat turn. An abandoned model-only response with no active descendants, pending waits or non-cancel commands can allow Resume without rewriting the old execution as completed. Unconfirmed external effects still block Resume; open Activity to inspect the execution and use its existing controls. Todo completion is not objective verification.

Provider usage receipts refresh active Goal totals; turn exit reconciles them again. Repeated notifications do not add the same usage twice. Metering read failures preserve the cursor and display unknown rather than zero. Older interrupted Goals whose usage was never settled are explicitly labelled pending accounting; their whole-session costs are not guessed into Goal totals.

## Python Workflow compatibility

Direct Python and composed Workflow calls to `goal()` retain their existing work/refinement/judge contract. This compatibility path is distinct from chat Goals. It accepts `context_mode`, work/judge model settings and execution limits. Chat mode uses the conversation's work model and does not use those separate role settings.

The chat form preserves explicit round, token, active-time and cost limits. It rejects separate Workflow role options and isolated context; change the conversation's settings for chat work instead. In the Rich REPL, `/goal` starts a canonical chat execution and prints its execution ID.

See the [engineering design](../reference/design/runtime/goal.md) for the migration and implementation evidence.
