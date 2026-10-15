# Always-on Agents

An always-on Agent keeps working while you are away. It wakes on a schedule, works on a standing goal in its own conversation, checks for news with read-only tools when it has nothing to do, and notifies you when it finds something worth your attention.

Any saved [Agent](agents.md) can be always on. It uses that Agent's model, instructions, capabilities and memory, so you set it up the same way as any other Agent.

## Turn it on

1. Open **Agents** in the sidebar and select the Agent.
2. Open the **Always-on** tab and check **Keep this Agent always on**.
3. Optionally enter a **Standing goal**, for example "Keep the docs site free of broken links and tell me when a fix needs review."
4. Choose how often it wakes (**Wake every**, 5 to 10080 minutes; 60 by default).
5. Choose **Save changes**.

The Agent wakes within a minute of saving, then on its interval.

## What a wake does

Each wake does at most one thing:

| Situation | What happens |
| --- | --- |
| A turn is already running in its conversation | Nothing; it tries again next time |
| You set a standing goal it has not started | It starts the goal as a [Goal](goal.md) in its conversation |
| A Goal is in progress or paused | Nothing; the Goal continues on its own, and a pause you made stays in place |
| No Goal to work on, and check-ins are on | It checks in (below) |
| Otherwise | Nothing |

A goal you change while another Goal is unfinished starts once that Goal ends. To switch right away, open the conversation and enter `/goal clear`.

## Check-ins

When it has no Goal to work on, the Agent checks in. It reviews its memory and its conversation for open threads and looks for anything new, using only read-only tools: file reading and search, web search and fetch, conversation and memory reading, and the todo and Goal readers. It cannot run commands, edit files or call MCP servers during a check-in.

If it finds something worth your attention, it sends a report. Otherwise it says so in one line. Under **What a check-in may do**:

- **Report findings** (default): it proposes work in its report, and you decide what to start.
- **Start goals on its own**: it may turn a finding into a Goal, which then runs with the conversation's normal tools and permissions.

Turn off **Check in when there is no goal to work on** to have it wake only for its standing goal.

## Its conversation

Each always-on Agent has one home conversation, named "*Agent name* · Always-on". Goal work, check-ins and reports all happen there, so you can see everything it did. Talk to it there like in any chat. Its permission mode and rules are that conversation's settings, and any approval it needs waits there and notifies you.

If you delete the conversation, the next wake starts a new one.

## Reports and notifications

A report has a title, a short body and optional links. In the desktop App, each report shows a system notification while no App window has focus. Clicking it opens the Agent's conversation. The **Always-on** tab lists recent reports.

## Send reports to channels

Reports can also reach you on a [chat channel](../integrations/channels.md) (Telegram, Slack, Discord or WeChat). Under **Also send reports to**, check the conversations that should get each report as a message. Up to 10 can be picked.

The list shows the channel conversations this Agent already has, plus the people and groups it is bound to with a peer binding (`openprogram channels bindings add <agent> --channel telegram --account <id> --peer <id>`). An Agent bound to a whole channel or account only lists the people who have talked to it.

Each report is sent once to each picked conversation, after it is saved in the App. Under each report, the Always-on tab shows whether it was sent to each conversation. A failed send (for example, the account is signed out) is shown there. The report itself is kept.

## Status and Wake now

The **Status** section of the Always-on tab shows:

- what the conversation is doing (working, the current Goal, or no goal);
- the last wake and its result;
- when the next wake is due.

**Open** opens the conversation. **Wake now** runs a wake immediately. Status and **Wake now** use the saved settings, so save your changes first.

## Learning from feedback

The Agent improves through its memory. Set Memory to **Read and write** in the Agent's **Memory** tab: corrections and preferences from its conversation are then saved to its memory and used in later turns. The Always-on tab reminds you when memory is not read-write.

## Limits

- Work runs on this computer, in the conversation's working folder and sandbox. The worker must be running for the Agent to wake.
- There are no quiet hours; it wakes on its interval around the clock.
- A duplicated Agent starts with always-on turned off.

The [engineering design](../reference/design/runtime/always-on-agents.md) describes how wakes, check-ins and reports work.
