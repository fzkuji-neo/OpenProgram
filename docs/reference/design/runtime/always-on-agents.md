# Always-on Agents

An always-on Agent keeps working without the user present: it holds a standing goal, wakes on a schedule, does read-only research while it has nothing assigned, and reports what it found. The reference products are OpenAI's dots and xAI's Grok Bot. Both give one agent a persistent goal, its own place to work, memory that improves with feedback, and rules for what it may do alone.

OpenProgram builds this from parts that already exist. An always-on Agent is an ordinary saved Agent (`AgentSpec`) with its `always_on` section enabled. It runs with that Agent's model, instructions, tools, memory space and permission rules. Its work happens in one ordinary conversation, and its goal is an ordinary chat Goal. The new code only decides when to wake, what each wake does, and where reports go.

## Pieces

| Piece | Where it lives | Reused from |
| --- | --- | --- |
| Configuration | `AgentSpec.always_on` in `agent.json` | Agent management, revisioned saves |
| Home conversation | One session with `source="always_on"` | Session store, chat UI |
| Standing goal | A chat Goal in the home conversation | Goal continuation, verification, budgets |
| Wake schedule | `openprogram/agent/always_on/ticker.py`, a worker thread | Worker service startup |
| Check-in turn | An ordinary turn with a read-only tool list | `CanonicalAgentAdapter`, `TurnRequest.tools_override` |
| Reports | `always_on_report` tool, `reports.jsonl`, `always_on_report` frame | Desktop notification bridge |
| Channel delivery | `openprogram/agent/always_on/delivery.py` | `channels.outbound.send_full`, bindings, channel sessions |
| Learning | The Agent's own memory space | Memory policy and session-end extraction |
| Rules | The home conversation's permission mode and rules | Permission rules, approval cards |

## Configuration

`always_on` is part of the Agent configuration, so it saves through the Agent editor's single draft and revision check:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enabled` | bool | `false` | Wake on schedule |
| `goal` | string, at most 4000 characters | `""` | Standing objective; empty means research only |
| `wake_minutes` | int, 5–10080 | `60` | Interval between scheduled wakes |
| `research` | bool | `true` | Run a check-in when no Goal is unfinished |
| `autonomy` | `"report"` or `"act"` | `"report"` | Whether a check-in may start a Goal itself |
| `channels` | list of `{channel, account_id, peer_id, label}`, at most 10 | `[]` | Channel conversations that also get each report |

`validate_always_on()` in `agent/management/manager.py` normalizes the section the same way `validate_memory_config()` normalizes memory. Older `agent.json` files without the section load as disabled. Duplicating an Agent copies the section with `enabled` forced off, so a copy never starts waking unasked.

## Runtime state

Runtime state is kept apart from configuration so that wakes never bump the configuration revision or conflict with an open editor draft. It lives in `<agent dir>/always_on/`:

- `state.json`: `home_session_id`, `applied_goal` (the objective text and Goal id last started from configuration), `last_wake` (`at`, `reason`, `outcome`, `detail`) and `next_wake_at`.
- `reports.jsonl`: one report per line (`id`, `at`, `title`, `body`, `links`, `session_id`, and `deliveries` when channels were picked), trimmed to the newest 200.

Both files are written atomically under a per-Agent lock.

## Home conversation

Each always-on Agent has exactly one home conversation. `home_session()` creates it the first time it is needed, titled `<Agent name> · Always-on`. If the user deletes it, the next wake creates a new one. The user talks to the Agent there like in any chat. Goal turns, check-ins and reports appear in that transcript, so nothing the Agent does happens out of sight.

## Wake

`wake(agent_id, reason)` runs on every scheduled tick and on **Wake now**. It always records `last_wake` and schedules `next_wake_at = now + wake_minutes`. One wake does at most one thing, decided in this order:

1. **disabled**: `always_on.enabled` is off. A scheduled wake stops here; **Wake now** is refused.
2. **busy**: a turn is already running in the home conversation. Nothing starts.
3. **goal started**: the standing `goal` is non-empty and differs from `applied_goal`, and no Goal in the home conversation is unfinished. The runtime creates a chat Goal with that objective and starts it with `goal.chat.start_from_controls()`. From then on the ordinary Goal continuation drives the work turn after turn, and verification decides completion.
4. **goal in progress** or **goal paused**: a Goal is unfinished. The wake leaves it alone. Automatic continuation belongs to the Goal runtime, and a user's pause is never overridden.
5. **check-in**: `research` is on. The runtime starts one check-in turn (below).
6. **idle**: nothing to do.

A changed standing goal therefore takes effect once the current Goal ends. The user can end it from the conversation (`/goal clear`) to switch immediately.

## Check-in turn

A check-in is an ordinary owner chat turn in the home conversation (source `web`), with the conversation's own permission mode and rules. Goal continuation, verification and approval cards therefore treat it exactly like a chat the owner started. Its prompt names the time of the previous check-in, the standing goal and the autonomy setting, and asks the Agent to:

- review its memory and the conversation for open threads;
- look for anything new that matters to the goal, using only read-only tools;
- call `always_on_report` when it found something the user should see, and stay silent otherwise.

`tools_override` limits the turn to read-only tools: `read`, `grep`, `glob`, `list`, `web_search`, `web_fetch`, `read_conversation`, `memory_search`, `memory_get`, `todo_list`, `get_goal` and `always_on_report`. With `autonomy="act"`, `create_goal`, `todo_create` and `todo_update` are added, so the Agent can turn a finding into its own Goal, which then runs under normal tools and permissions. MCP tools are not included, because a server's tool cannot be classified as read-only from its name.

## Reports

`always_on_report(title, body, links)` is a tool in its own `always_on` toolset, outside the default set. `loop_runner` offers it only in a home conversation (checked with `agent_for_session()`) and removes it everywhere else; called outside one, it refuses. A report is appended to `reports.jsonl` and broadcast as an `always_on_report` frame. The desktop shell turns that frame into a system notification through the existing attention bridge (kind `report`, keyed by report id, shown only while no App window has focus). Clicking the notification opens the home conversation. The report also stays in the transcript as the tool call that produced it.

## Channel delivery

`always_on.channels` lists the channel conversations that also get each report. `channel` is one of `telegram`, `slack`, `discord` or `wechat`. `peer_id` is the target the channel transport expects: the same id channel sessions store, so a Slack or Discord target is the scoped `<channel>_<user>` id. `validate_always_on()` rejects unknown channels and empty ids and drops duplicates of one (channel, account, peer).

The Always-on tab offers targets from `delivery.channel_targets()`, which the status route returns as `channel_targets`:

- the Agent's channel conversations (session rows with `channel`, `account_id` and `peer_id`), labelled with the peer's display name;
- the Agent's peer bindings. A binding without an account expands to every account of that channel.

A binding to a whole channel or account names no peer, so it contributes nothing until someone talks to the Agent there.

When the Agent has targets, `runtime.report()` saves the report with one `deliveries` row per target in status `sending` and broadcasts it as before. It then calls `delivery.deliver()`, which sends from a daemon thread so the tool returns at once. Retries and rate limits can take tens of seconds. The thread sends one Markdown message per target through `channels.outbound.send_full()`: the bold `<Agent name> · <title>`, the body, then the links as a list. The channel transport renders it per platform and splits long text. Each row becomes `sent`, or `failed` with the transport's `error_kind` and a one-line `detail`. An exception counts as `unknown`. The thread then writes the rows back with `store.update_report()` and broadcasts `always_on_update`, so an open Always-on tab refreshes. A failed send never removes the report or fails the tool.

## Learning from feedback

The always-on Agent learns through its configured memory. With Memory set to **Read and write** on **This Agent**, the session-end writer extracts preferences and corrections from the home conversation into the Agent's own space, and every later turn reads them back. The Always-on tab says so when memory is not read-write; it never changes the memory setting itself.

## Rules

What the Agent may do alone is the home conversation's permission mode plus the saved permission rules, the same controls every conversation has. Approvals a turn needs wait in the conversation as approval cards and raise a needs-input notification. Check-ins add no permissions; they only narrow the tool list.

## Schedule

`ticker.py` starts with the worker's other services. Every 30 seconds it lists Agents with `always_on.enabled` and wakes each one whose `next_wake_at` has passed or was never set. A freshly enabled Agent therefore wakes within half a minute of saving, and a worker restart keeps the saved schedule instead of waking everything at once. The ticker never runs two wakes for one Agent at the same time.

## Surfaces

- **Agents → Always-on tab**: the configuration fields, plus a status block with the home conversation, last and next wake, **Wake now**, **Open conversation** and recent reports.
- **HTTP**: `GET /api/agents/{id}/always-on` returns configuration, state, recent reports and `channel_targets`; `POST /api/agents/{id}/always-on/wake` wakes the Agent now; `POST /api/agents/{id}/always-on/home` returns the home conversation, creating it if needed. `PATCH /api/agents/{id}` accepts `always_on` like any other section.
- **Python**: `openprogram.agent.always_on` exposes `wake()`, `status()`, `reports()`, `home_session()` and `channel_targets()`.

## Implementation status

Implemented: configuration, home conversation, wake decision, check-in, reports with desktop notifications, channel delivery, ticker, HTTP, Python API and the Always-on tab.

Not implemented:

- A dedicated cloud computer per Agent. Work runs on this machine with the conversation's working folder and sandbox.
- Quiet hours and per-day wake windows.
- Several always-on Agents coordinating as a team.
