# Workflows

A workflow is a small Python package. Agent instances define the roles. Context objects define what each model call sees. Plain functions decide the order of the calls. The chat agent writes and changes workflows directly; there are no separate tools for searching, creating or revising them. To run a workflow, the agent calls it as an ordinary tool.

This document is the only design record for workflows. Product usage lives in [Self-programming Workflows](../../../capabilities/agentic-workflow.md) and [Write, test, and publish a Workflow](../../../capabilities/workflows/authoring.md).

## Workflow form

A workflow package has three kinds of top-level objects:

- **Roles** are `Agent` instances created at module top level. A role holds configuration only: `model`, `instructions`, `tools`, `effort`. A role without a model uses the caller's runtime.
- **Context** objects are built inside functions and passed to role calls explicitly.
- **Functions** are plain Python functions. They call roles, transform values, branch, loop and call other functions.

```python
from openprogram import Agent, Context

writer = Agent(instructions="You write weekly reports.")
reviewer = Agent(instructions="You check facts.", tools=[])

def weekly_report(notes: str) -> str:
    """Turn this week's notes into a weekly report."""
    ctx = Context({"notes": notes})
    draft = write_draft(ctx)
    return check(draft, ctx)

def write_draft(ctx: Context) -> str:
    """Write three sections: progress, problems, plans. At most three items each."""
    return writer("Write this week's report", context=ctx)

def check(draft: str, ctx: Context) -> str:
    """Only check that the draft matches the notes. Do not change the style."""
    return reviewer("Fix any mismatch and return the final text",
                    context=ctx.derive({"draft": draft}))

PROGRAM_ENTRIES = [weekly_report]
```

Rules:

- Model calls go through roles only: `role(prompt, context=...)` runs a tool loop, `role.choose(prompt, {id: label})` picks one option. Workflow code does not call the free `llm()` or `agent()` primitives.
- `PROGRAM_ENTRIES` lists the functions exposed as tools. An entry's type annotations become the tool parameters and its docstring becomes the tool description.
- No decorators, base classes, DSL or string dispatch. One workflow uses another through a normal Python import.

## What one model call sees

A call `role(prompt, context=ctx)` sends exactly five parts, in this order:

| Order | Part | Defined by |
|---|---|---|
| 1 | The role's `instructions` (system prompt) | The `Agent(...)` instance |
| 2 | The docstring of the function that made the call, for this call only | The function |
| 3 | The named blocks of `ctx` | The code that builds or derives `ctx` |
| 4 | History, empty by default | The history setting of `ctx` |
| 5 | `prompt` | The call |

Nothing else enters the request. Chat history, the outputs of other roles and the steps of earlier functions reach the model only when the code puts them into `ctx` or `prompt`. `ctx` never changes tools or permissions; tools belong to the role.

### Context

Workflows use the existing `openprogram.context.Context`:

- **Static blocks:** `Context({"notes": notes})` or `ctx["notes"] = notes`.
- **Computed blocks:** `Context(providers={"today": lambda c: ...})`. A provider is a synchronous callable that runs at each call.
- **Derivation:** `ctx.derive({...})` returns an independent copy. A function adds blocks, or removes them with `DELETE`, without affecting the caller's `ctx`.
- **History:**
  - nothing (the default in a workflow);
  - the earlier calls made with the same `ctx`, for multi-turn revision by one role;
  - the chat that invoked the workflow;
  - a callable that selects history items.

  These four values replace the graph-shaped `history_filter` values `"dag"` and `"current_call"`.

### Function docstrings

When a role is called, the runtime walks the Python call stack to the nearest function defined in the workflow package and puts that function's docstring, verbatim, into this one request. The docstring is not stored in `ctx` or in history, so the next call does not carry it. A function without a docstring adds nothing. There is no wrapper tag, function name, call path or recursion notice.

The lookup reads the stack at call time, so it works without a session store and without recording any function.

### Call logic

A workflow can also tell the model where a call sits in the program. This is opt-in and uses ordinary context blocks:

- **Call path:** the built-in provider `call_path` lists the workflow functions on the stack, for example `weekly_report → check`. `call_path(docs=True)` adds each function's docstring.
- **Whole program:** the built-in provider `workflow_source` returns the source of the entry function, so the model sees the steps before and after its own.
- **Handwritten:** a plain block such as `{"flow": "Draft first, then review. You are the second step."}`.

A block placed in the top-level `ctx` reaches every role call; a block placed in a derived `ctx` reaches only that function's calls.

Both the docstring lookup and `call_path` read `sys._getframe` and `co_qualname` (Python 3.11+). Limits:

- **Threads and concurrent tasks:** the stack breaks at a thread pool, `create_task` or `gather`. The entry function is held in a contextvar, which propagates into asyncio tasks and `asyncio.to_thread`. With it the entry level comes back; the levels between the entry and the break do not.
- **Nested functions:** a function defined inside another function shows its name but not its docstring. Workflow steps are written as module-level functions.

## Recording

The session graph records two kinds of nodes:

- one node for the workflow entry call, holding its arguments, result or error;
- one child node per role call, holding the exact request sent to the model, the reply and the role's tool loop.

Plain functions are not recorded and do not appear in any call path stored in the graph. The request stored on a role node is for inspection only; later calls never read it back into context.

## Authoring

- The chat agent writes workflow packages with its normal file tools, guided by a workflow-authoring skill.
- `openprogram.testing` provides a helper that replaces role calls with scripted replies and captures each request. Tests can then assert exactly what a role saw.
- `openprogram workflows check <dir>` imports the package, validates `PROGRAM_ENTRIES` and the entry signatures, and runs the package tests.

## Storage and loading

- User workflows live in `~/.openprogram/workflows/<name>/`. Each workflow is its own Git repository.
- A passing `check` commits the change. History and rollback use Git.
- The watcher reloads a workflow when its files change. Load and check errors appear on the Programs page next to the workflow.
- Workflows ship as source and run in process. Imports are unrestricted, as with any other Python code the user installs.

## Running

- The chat agent calls a workflow entry as a tool. The call runs in the worker process and records the nodes described above.
- `openprogram programs run <name> -p <provider> -m <model>` runs an entry from the command line.
- Agent-method tools without a timeout run on the event-loop thread. Whether a long workflow blocks the worker this way is measured before the run path is finalized.
- Resume across restarts uses `openprogram.agentic_programming.continuation.step` and is not part of the first version.

## Removed

- The tools `search_workflows`, `create_workflow`, `revise_workflow`, `auto_workflow` and `resume_workflow`.
- `programs/workflow/_generation`, the top-level whitelist in `_project/validation.py`, and the package snapshot checkpoints in `_runtime/state.py`.
- Legacy single-file workflow formats and workflow trust records in `program-sources.json`.
- The `auto_workflow` UI.
- The `<situation>` prefix built by `_situational_prefix`.

The following stay: the forced token refresh on a Codex 401, `programs run -p/-m`, and tool-name resolution for string tool entries.

## Migration

- The user's `weekly_report` family and `llm_knowledge_research` move to `~/.openprogram/workflows/` in the new form.
- Built-in workflows keep their current form until a later pass.
- Product docs and the README describe the new form once it ships.

## Phases

1. Role calls: docstring injection, the four history settings, `call_path` and `workflow_source`, role nodes under the entry node, and removal of `<situation>`.
2. Loading and storage: `~/.openprogram/workflows`, Git commits on check, the watcher and the Programs page errors.
3. Authoring: the skill, the test helper and `workflows check`, then removal of the old tools and code.
4. Migration of the user's workflows, plus product docs.

## Open questions

| Question | Proposed answer |
|---|---|
| Import boundary for workflow code | No restriction |
| How a workflow becomes callable | Automatically after `check` passes |
| Resume in the first version | No |
| Which workflows migrate now | Only the user's own workflows |

## Implementation status

| Item | Status |
|---|---|
| Codex 401 refresh, `programs run -p/-m`, tool-name resolution | Implemented |
| Everything else in this document | Designed, not implemented |
