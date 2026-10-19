# Agentic workflows

This page covers the ready-made agents included in every supported OpenProgram release and how to use them. If you want to use agents directly instead of writing your own functions, start here.

## What they are

An agentic workflow is a finished workflow built with [Agentic Programming](../agentic-programming/README.md) — called a **harness** or **agentic program** in the code: a self-contained git repository holding a set of `Agent` methods. The fixed release versions register into OpenProgram and appear like built-in functions in chat, on the Web UI Programs page, and in `openprogram programs run`.

Two first-party workflows:

| Workflow | Release status | In one line |
|---|---|---|
| [Research Agent](research-agent.md) | Included | From research topic to submission-ready paper, with a deterministic verification layer |
| [Wiki Agent](wiki-agent.md) | Included | Distills sessions and notes into a templated HTML knowledge base |

## Management commands

```bash
openprogram programs list          # all registered functions and programs
openprogram programs available     # first-party status + installed third-party harnesses
openprogram programs install <owner>/<repo>   # any third-party harness (git URL also works)
openprogram programs install <ref> --upgrade  # reinstall / upgrade
openprogram programs uninstall <Harness-Name> # remove a third-party harness
openprogram programs run <name> -a key=value  # run a program directly
```

`programs run` also accepts `--provider` (openai-codex / gemini-cli / anthropic / openai / gemini, auto-detected by default) and `--model` to override the model.

First-party Programs are immutable product components. In a mutable extension or development environment, `programs install` clones an additional third-party harness, installs its declared dependencies, and records the approved source.

`openprogram programs list` includes the entries of the Workflows loaded from `~/.openprogram/workflows`. `openprogram workflows list` shows each of those Workflows with its load state.

## How to trigger them

- **Web parameter form**: click **Use** in Programs or a sidebar favorite. A new-tab page becomes a draft chat; an existing chat keeps its draft and running task. Fill in the task requirements and send explicitly. Opening or closing the form does not run the Workflow.
- **In chat**: entry functions register as tools (`as_tool=True`). Describe the task in natural language and the model calls them (e.g. `research_agent`, `wiki_agent`). Operating apps, built-in browser Pages and a VM is the [`computer_use_agent`](../computer-use.md) tool, not a workflow.
- **From the command line**: `openprogram programs run wiki_agent -a task="Ingest the notes above into the wiki"`.
- **From Python**: harness functions are ordinary importable Python functions.

## Model selection

Programs whose bodies do not call a model can execute without a configured model. An unavailable model or credential fails when the body calls the Runtime; it does not prevent model-free steps from running and does not select another provider automatically.

Direct tool runs also need an explicit provider and model for internal model calls. An omitted or incomplete selection does not use global provider detection or a provider's default model.

When run from a chat, internal Workflow model calls inherit the turn's provider and model selection. A per-turn override takes priority over the session selection, followed by the agent profile. The selected provider and model also apply to tool subprocesses. Provider authentication must still be valid for that selected model; setup failures retain the selected model's error instead of silently using another provider.

Browser workflows retain an explicit initial URL when a backend is selected. Official MCP backends support guarded waits and propagate snapshot failures. Page recovery stays within the current window scope and does not replay the failed action. A verified result retains its actual evidence and observed target.

## Writing your own

Any repository that follows the directory contract (`<package>/agentics/__init__.py` exposing `PROGRAM_ENTRIES`) can be installed with the same `programs install` command. See [Installing and writing harnesses](../installing-harnesses.md) for the contract, a minimal template, and the publishing flow.

That harness contract is different from a single Workflow package in `~/.openprogram/workflows`. For the package form, a complete tested example and the `workflows check` command, see [Write and check a Workflow](authoring.md). Workflows the chat agent writes go through the same check. To show the agent a task instead of describing it, [record a workflow](recording.md).

Workflow forms ask for task information, not execution settings. Text polishing infers its style from the text in the same model request; it does not require a style selection. Browser backend and session handles remain internal. Document page ranges and output destinations are optional task requirements. Explicit Python callers retain supported overrides.

## Weekly reports

If `weekly_report` is installed in your Workflow catalog, call it with the report text or the change you want. For example, ask it to submit this week's report, update only next week's plan, inspect the existing record, or prepare a local draft at a named path.

It reads the configured Feishu form and matches the name and year/week before writing. A missing record is submitted once; an existing editable record is opened from the submission history and saved. Partial updates preserve untouched fields. Explicit draft and read-only requests do not submit. Unknown inspection results, login failures and ambiguous records stop the operation. A submission cap does not by itself rule out editing an existing record.

Success requires a fresh page confirmation and persisted values. If a write result is uncertain, the Workflow reports it without automatically retrying. Ordinary browser authorization remains required. It uses bounded browser steps rather than a `goal()` loop, and does not invent progress, metrics or paper titles.

### Group weekly report drafts

`group_weekly_report(task)` autonomously retrieves group scope, report material and author evidence from memory, relevant local files and WeChat, then prepares an unsent draft. Missing fields do not trigger questions. Unknown authors and unavailable sources are listed as limitations. Explicit `source: "supplied"` restricts collection to supplied materials. See [weekly reports](reports.md) for source options.

Inspection of complete structured supplied-only inputs uses code without model calls. Summaries use bounded per-member model contexts, checked source references and explicit uncertainty. Local files are saved under `reports/group-weekly/<week>/<unique-run>/` (or `output_dir`). Missing material is not proof of non-submission. Review the draft and send it yourself.
