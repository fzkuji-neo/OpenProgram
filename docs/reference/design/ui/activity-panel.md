# Activity panel

The right sidebar's **Activity** answers three questions about one
conversation: what needs you, what is running, and what ran before.

Related: [`indicator-dots.md`](indicator-dots.md) (status dots),
[`sub-agents-card.md`](sub-agents-card.md) (a sub-agent's own conversation).
Code: `apps/web/components/right-sidebar/running-panel.tsx`,
`apps/web/lib/execution/activity-model.ts`,
`openprogram/execution/activity_calls.py`.

## The unit is a run

A row is a **run**: one top-level execution, normally one message and
everything the assistant did for it, titled by that message. Child
executions (sub-agents, spawned branches), function calls that have not
returned, and managed programs belong to the run whose execution tree
holds them. Conversation branches are not a level of the panel.

An **issue** is a concrete thing waiting on the reader:

- a call whose result is unconfirmed: the run stopped while it was out;
- an execution paused on a question or approval, or holding an unconfirmed
  action that no unconfirmed call already names;
- a program whose state is unknown or lost.

An execution whose only missing records are model responses
(`provider_response_incomplete`) is not an issue; it reads as ended.

## Overview

Three groups in a fixed order; an empty group is not shown, and no group
folds.

1. **Needs you**: issues, newest first. The row is the issue itself
   ("Fix page close · Sub-agent result unconfirmed"), not the conversation.
2. **Running**: live runs, with the call they are on and the time so far;
   calls and programs whose execution is not listed join here.
3. **Earlier**: finished runs newest first, under day headings, 20 at a
   time with **Show earlier**.

Calls and programs are placed only after the executions are read, so they
never flash as unowned.

## Pages

Every row opens a page; a stack of pages backs the panel, and the back
arrow names the page it returns to. Nothing expands in place.

- **Run**: kind, start and duration, the title, its state. Its issues come
  first, each with its actions as raised pills: **End this run** (cancel)
  when the execution allows it, **Answer** / **See details** for a pause,
  **Open its conversation** for a sub-agent. Then **What this run did**:
  open calls, child executions, programs. A sub-agent an `agent` call
  started is reached through that call, not listed twice. **Technical
  details** opens the execution inspector, which alone loads events and
  debugger data.
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
