# Activity panel

The right sidebar's **Activity** lists one conversation's main agent
(the sub-agents it starts are on its page) and, separately, the programs and
commands they run in a shell. What needs the reader is never a group of
its own: it is the row it concerns, with a warning status.
Messages are never rows; they stay in the chat.

Related: [`indicator-dots.md`](indicator-dots.md) (status dots),
[`sub-agents-card.md`](sub-agents-card.md) (a sub-agent's own conversation).
Code: `apps/web/components/right-sidebar/running-panel.tsx`,
`apps/web/components/right-sidebar/agents-view-menu.tsx`,
`apps/web/lib/execution/activity-model.ts`, `apps/web/lib/prefs/activity-view.ts`,
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

Two groups in a fixed order; an empty group is not shown, no group folds
and neither header carries a count.

1. **Agents**: the main agent alone (the conversation's own agent, named
   and drawn like the sub-agents). It reads as running (with the call it
   is on, or "Waiting for a sub-agent", and the time so far), waiting on
   the reader (paused, or holding issues of its own), idle since its last
   run, or that its last run failed. Under its status, one line sums up
   the sub-agents the model started: how many, how many run (running
   tone) and how many need the reader (warning tone), as in "5 sub-agents
   · 1 running · 1 needs you". The sub-agents themselves are listed on the
   main agent's page, so the overview stays one row however many the
   model starts. Calls and programs whose execution is not listed count as
   the main agent's.

   When the conversation has more than one branch (forks and edits the
   reader made in the DAG), each branch is a main agent of its own, one
   row each, all equal: the branch's name, a ghost in its lane colour, a
   **Current** tag on the checked-out one, and the same status and
   sub-agent line computed from the runs on that branch (the server's
   `branches[].execution_ids`; a sub-agent belongs to the branch of its
   top-level run). Unlisted calls and programs, and calls that started no
   sub-agent, count as the checked-out branch's. A branch's page is the
   main agent's page for that branch, titled **Branch**, with **Switch to
   this branch** (the Branches panel's checkout) when it is not the
   current one. Sub-agents' own conversations are not branches here.
2. **Programs and commands**: shell calls still running, shell calls still
   out when their run stopped (warning tone), and every background
   program. Running rows first, then rows that need the reader, then the
   rest, newest first within each, 20 at a time. A command's status names
   its kind ("Command · Running · 12 s"). A program is titled by what it
   does (the bash call's `description`, else the script or module it runs,
   past setup steps such as `cd` and `mkdir`), with its command in
   monospace under the title. While it runs, the status line is its
   progress ("45 / 100 samples · 3.4/s") over a thin bar with the time
   left at its end ("16s left"), or, with no amount known, how long it has run and its last output
   line over a sweeping bar. Once it ends the status says how ("Completed ·
   10 / 10 epochs · 4 min 5 s", "Failed at 62 / 200 · exit 1").
   `agent` calls never appear here; they are reached through the agents.

Calls and programs are placed only after the executions are read, so they
never flash as unowned.

## Pages

Every row opens a page; a stack of pages backs the panel, and the back
arrow names the page it returns to. Nothing expands in place.

- **Main agent**: the conversation title and its state. Its own issues
  come first, each naming its run, then what it is running now, its
  **Latest run** (the row opens that run's page), and **Sub-agents it
  started**: every sub-agent, depth first and newest first. The first
  level is the page's own list; a deeper sub-agent is indented under the
  one that started it, a hairline elbow runs from under that agent's
  glyph into its own, the line carries on to its later siblings, and the
  lines of rows above with siblings still to come run past it. A
  sub-agent reads as running with its call, stopped (a stopped `agent`
  call shows as the sub-agent it started), or its final state with the
  time; one that needs the reader is listed once, in place, with the
  warning tone. An `agent` call that started no sub-agent sits in the
  tree where that sub-agent would, as **Failed to start** or **Not
  started**. The list shows 20 rows at a time with **Show earlier**.

  The section heading's button opens the view menu, built from the
  composer options menu's pieces: the same radix wrapper and
  `MENU_PANEL` frame, a value row per setting that opens a submenu, and
  check rows in it. **Show** is All, Needs you (rows in the warning tone)
  or Running (rows in the running tone). By structure, a filter keeps
  each match and the agents above it (`pruneBranches`) and redraws the
  lines for what is left. **Arrange** is By structure (the tree) or By
  time: one flat list, live rows first, then by the time each row shows,
  every sub-agent's status ending with who started it ("· by Research").
  A filter that leaves nothing says so under the heading, so the menu
  stays reachable. The button stays lit while the view differs from the
  default; the view is a per-browser preference in local storage.
- **Sub-agent / run**: kind, start and duration, the name or message, its
  state. Its issues come first, each with its actions as raised pills:
  **Mark as ended** (cancel) when the execution allows it. A pause with a
  queued decision (`pendingDecisions`, matched by execution) shows its
  prompt and choices, and **Answer in chat** / **Review in chat** scrolls
  to the composer's decision card (`data-decision-output`) and focuses its
  first control; the choice is made there, not in Activity. A pause with
  no queued decision is answered in the run page's own record (below);
  from the main page, **Answer** / **See the run** opens that page. A
  single such pause reads as "Waiting for your answer" or "Needs your
  approval" in the list and on the page. A sub-agent adds **Open its conversation**,
  **Started by** (the main agent or the sub-agent above it),
  **From** (the run of the message that started it) and **Task given to
  it**, from its `agent` call. Then what it did: open calls (an `agent`
  call is reached through the sub-agent it started), child executions,
  the sub-agents it started and the ones that failed to start, programs.
  Last, under **Progress**, the run's own record: the `DebuggerPanel` in
  its `embedded` layout (no header or scroller of its own), which lists
  the progress rows first, then the reason and controls the execution
  allows (pause, continue, step, retry, add instruction, create branch),
  its open waits, and the raw ids, revisions, checkpoints and events
  folded under **Technical details**. Opening a run page selects that
  execution in the inspector hook, which reads events and debugger data
  only while a run page is open. There is no separate inspector page:
  a run is one page, and the main agent's page has no inspector of its
  own.
- **Failed start**: the call's description, when it was made and that it
  failed to start, a note that it has no conversation, **Started by**, the
  error line and the task.
- **Call**: titled by its description, with its kind, start and state, the
  run it came from, and the task (`prompt`) or the command. Tasks read as
  prose, commands as monospace; both show a few lines until **Show all**.
- **Program**: titled like its row. A progress card comes first: the
  count and percent, the bar, then elapsed time, speed and time left while
  it runs, or how long it took, when it ended and its exit code. Then
  **Stop program** while it runs, the command, and the output as a
  terminal shows it: a line redrawn with carriage returns keeps its last
  frame, colours stay, and the view follows new lines while the reader is
  at the end (marked **Live**). Last come the run it came from, the
  program name when a description titles it, folder and environment. An
  open program page is read every second.

### Program progress

The server reads progress out of a program's output
(`openprogram/processes/progress.py`), most trusted source first:
`##progress 45/100 samples` lines the program prints on purpose (the bash
tool asks the model to print them for long loops), the OSC 9;4 terminal
progress sequence, tqdm and pip bars, and counters such as `Epoch 3/10`,
`step 120 of 1000` or `[45/100]`. Once a more trusted source has spoken,
less trusted ones are ignored, so an inner per-batch bar never overwrites
an explicit sample count. Speed and time left are the bar's own, or
measured since the count began. Output is stored as a terminal shows it,
so a redrawn bar takes one line of the 2,000-line limit, and the agent
reading a background command gets each redraw once.

## Look

Rows have no frame at rest: a bare glyph in its kind's colour, the name
over a status line led by the shared indicator dot, a chevron. Hover lifts
the row into a raised card: the file cards' shadow over a solid fill a
step toward the text colour (4%), since the panel is the input surface
itself and a card of the same colour would show no edge. Rows stack above the
tree lines, so a lifted card and its shadow cover the line instead of
being crossed by it. The line is one solid colour, the muted text mixed
into the panel's own background rather than a translucent stroke, so
where its pieces overlap at a joint it never darkens. An issue on a page is a
soft amber tint with no border.
