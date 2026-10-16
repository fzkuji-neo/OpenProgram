# Activity panel

The right sidebar's **Activity** answers three questions about one
conversation: what needs you, what is running, and which sub-agents ran
before. It lists the agent branches a conversation starts, never its
messages; those stay in the chat.

Related: [`indicator-dots.md`](indicator-dots.md) (status dots),
[`sub-agents-card.md`](sub-agents-card.md) (a sub-agent's own conversation).
Code: `apps/web/components/right-sidebar/running-panel.tsx`,
`apps/web/lib/execution/activity-model.ts`,
`openprogram/execution/activity_calls.py`.

## Agents, runs and issues

A listed row is a **sub-agent**: an execution whose display kind is
`job_agent`. Underneath, executions form **runs**: one top-level execution,
normally one message and everything done for it. Child executions,
function calls that have not returned, and managed programs belong to the
run whose execution tree holds them. A run has a page (reached from a
sub-agent's **From**, or from a message waiting on a question) but no row
of its own.

An **issue** is a concrete thing waiting on the reader:

- a stopped call: the run stopped before it returned;
- an execution paused on a question or approval, or stopped during an
  action that no stopped call already names;
- a program whose state is unknown or lost.

An execution whose only missing records are model responses
(`provider_response_incomplete`) is not an issue; it reads as ended.

## Overview

Three groups in a fixed order; an empty group is not shown, and no group
folds.

1. **Needs you**: issues, newest first. The row is the issue itself
   ("Fix page close · Sub-agent stopped"), not the conversation.
   A stopped `agent` call whose sub-agent is listed shows as that
   sub-agent, and the sub-agent is not listed again below.
2. **Running**: live sub-agents, with the call they are on and the time so
   far, plus calls and programs in flight outside a sub-agent.
3. **Sub-agents**: finished sub-agents newest first, under day headings,
   20 at a time with **Show earlier**.

Calls and programs are placed only after the executions are read, so they
never flash as unowned.

## Pages

Every row opens a page; a stack of pages backs the panel, and the back
arrow names the page it returns to. Nothing expands in place.

- **Sub-agent / run**: kind, start and duration, the name or message, its
  state. Its issues come first, each with its actions as raised pills:
  **Mark as ended** (cancel) when the execution allows it, **Answer** /
  **See details** for a pause. A sub-agent adds **Open its conversation**,
  **From** (the run that started it) and, while its `agent` call is open,
  **Task given to it**. Then what it did: open calls (an `agent` call is
  reached through the sub-agent it started), child executions, programs.
  **Technical details** opens the execution inspector, which alone loads
  events and debugger data.
- **Call**: titled by its description, with its kind, start and state, the
  run it came from, and the task (`prompt`) or the command. Tasks read as
  prose, commands as monospace; both show a few lines until **Show all**.
- **Program**: state, the run it came from, folder, environment, exit,
  command and output, with **Stop program** while it runs.

## Look

Rows have no frame at rest: a bare glyph in its kind's colour, the name
over a status line led by the shared indicator dot, a chevron. Hover lifts
the row into the raised card the file cards use. An issue on a page is a
soft amber tint with no border.
