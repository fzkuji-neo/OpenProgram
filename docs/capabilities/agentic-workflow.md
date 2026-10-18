# Self-programming Workflows

OpenProgram can create, version, find, and run reusable Python Workflow packages. A Workflow is appropriate when a task needs a stable multi-stage structure, explicit recovery, repeated use, or reviewable version history. A one-off task that one Agent can finish directly does not need a new Workflow.

## The four current entries

| Entry | Responsibility |
|---|---|
| `search_workflows(task)` | Search the local catalog without calling a model, writing files, or running a candidate. |
| `create_workflow(task)` | Author one new package, validate it, run its behavior tests in the OS sandbox, then publish its first Git revision. It does not execute the user's task. |
| `revise_workflow(workflow_id, request)` | Author, validate and test a new revision of one named package, then publish it. Previous revisions remain available. |
| `auto_workflow(task)` | User-only orchestration: search, choose reuse or justified creation, then run the selected fixed revision. |

A Chat Agent can call search, create, revise, or a concrete Workflow directly. It cannot call `auto_workflow`; that complete orchestration entry is available from the Programs UI.

A validation error or failing test goes back to the author with its rejected package, up to four attempts; nothing is published until one passes. A newly published Workflow, or a new revision, is picked up by the running worker within a few seconds, so chats can call it without a restart. Its project summary is the description the model sees when the entry function has no docstring.

## Published packages and runs are different

A published Workflow is a multi-file Python package with its own Git history. Every execution copies one immutable revision into the session repository and creates a separate `run_id` with `state.json`, checkpoints, results, and a `project_ref.json` record.

Running a published package never edits or republishes it. If execution fails, the run becomes `failed` and preserves the original error and checkpoints. Changing the package requires an explicit `revise_workflow` call.

An explicit user cancellation stores `cancelled` as a terminal run state. Resuming that `run_id` returns the saved cancelled result without executing it again. A process-level `KeyboardInterrupt` stores `interrupted` instead; a later call can reuse that run's saved artifact and checkpoints. This status is the Workflow run projection, not the canonical Execution record. Assigning a new canonical `execution_id` to a resumed attempt remains part of the incomplete unified Execution integration.

Legacy `code.py` runs can still be resumed for compatibility, but the legacy single-module format is not accepted for new authoring and is excluded from Workflow search.

## Writing a package yourself

The current authoring contract is documented in [Write a Workflow package](workflows/authoring.md). It includes the required files, metadata, entry-point signature, allowed imports, validation command, and current integration limits.

```bash
openprogram workflows validate ./my_workflow
openprogram workflows validate ./my_workflow --json
```

Static validation does not import the package or execute `tests/test_workflow.py`. `openprogram workflows test` runs the behavior tests in the OS sandbox, and `openprogram workflows publish` tests and publishes the exact snapshot; see [Write a Workflow package](workflows/authoring.md).

For installable repositories that expose a set of agentic functions rather than one generated Workflow package, use the separate [harness installation contract](installing-harnesses.md).
