# Activity panel

The right sidebar's **Activity** lists one conversation's agent branches:
the main agent first, then the sub-agents it started as a tree.
What needs the reader is listed above them and background programs below.
Messages are never rows; they stay in the chat.

Related: [`indicator-dots.md`](indicator-dots.md) (status dots),
[`sub-agents-card.md`](sub-agents-card.md) (a sub-agent's own conversation).
Code: `apps/web/components/right-sidebar/running-panel.tsx`,
`apps/web/lib/execution/activity-model.ts`,
`openprogram/execution/activity_calls.py`.

## Branches, runs and issues

A **sub-agent** is an execution whose display kind is `job_agent`. Every
execution belongs to one **branch**: a sub-agent runs its own branch and
every execution under it that no deeper sub-agent owns; everything else is
the **main agent**. A sub-agent hangs under the nearest sub-agent
above it, or under the main agent.

Underneath, executions form **runs**: one top-level execution, normally one
message and everything done for it. Child executions, function calls that
have not returned, and managed programs belong to the run whose execution
tree holds them. A run has a page (reached from the main agent's
latest run, a sub-agent's **From**, or a message waiting on a question) but
no row of its own.

An `agent` call that has returned is paired with the sub-agent it started.
The server reads these calls from the transcripts: a Job records the reply
that spawned it (`spawn_caller`) and its prompt, and the call with the same
caller and prompt started it; calls that did not fail pair first, since a
failed call may share its prompt with the retry. When the prompts do not
line up, a caller left with one Job and one call that did not fail pairs
those. A call paired with no Job **failed to start** (its result is
`[agent error] …` or its outcome is `failed`) or did not start. The
transcript row's caller names the branch that made the call: a `j_…` reply
is a sub-agent's, anything else the main agent's. Effects are not
read for this: their metadata carries whole provider payloads.

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
   ("Fix page close · Sub-agent stopped"), not the conversation. A stopped
   `agent` call whose sub-agent is listed shows as that sub-agent.
2. **Agent branches**: the main agent (the conversation's own agent,
   named like the sub-agents and drawn with the same glyph), then every
   sub-agent under it, depth first and newest first. Each is indented under
   the branch that started it; a hairline elbow runs from under that
   branch's glyph into its own, the line carries on to its later siblings,
   and the lines of rows above with siblings still to come run past it.
   The main agent reads as running (with the call it is on, or "Waiting for
   a sub-agent", and the time so far), waiting on the reader (paused, or
   holding issues of its own), idle since its last run, or that its last
   run failed. A sub-agent reads as running
   with its call, stopped, or its final state with the time. An `agent`
   call that started no sub-agent sits in the tree where that sub-agent
   would, as **Failed to start** or **Not started**. The tree shows 20
   rows at a time with **Show earlier**. Calls and programs whose
   execution is not listed count as the main agent's.
3. **Background programs**: every program, live ones first, then newest,
   20 at a time.

Calls and programs are placed only after the executions are read, so they
never flash as unowned.

## Pages

Every row opens a page; a stack of pages backs the panel, and the back
arrow names the page it returns to. Nothing expands in place.

- **Main agent**: the conversation title and its state. Its own issues
  come first, then what it is running now, its **Latest run**, and **Sub-agents it started**, including the calls that
  failed to start one. **Technical details** opens the latest run.
- **Sub-agent / run**: kind, start and duration, the name or message, its
  state. Its issues come first, each with its actions as raised pills:
  **Mark as ended** (cancel) when the execution allows it, **Answer** /
  **See details** for a pause. A sub-agent adds **Open its conversation**,
  **Started by** (the main agent or the sub-agent above it),
  **From** (the run of the message that started it) and **Task given to
  it**, from its `agent` call. Then what it did: open calls (an `agent`
  call is reached through the sub-agent it started), child executions,
  the sub-agents it started and the ones that failed to start, programs.
  **Technical details** opens the execution inspector, which alone loads
  events and debugger data.
- **Failed start**: the call's description, when it was made and that it
  failed to start, a note that it has no conversation, **Started by**, the
  error line and the task.
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
