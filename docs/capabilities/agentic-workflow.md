# Self-programming Workflows

OpenProgram's chat agent can write reusable Workflows for you. A Workflow is worth writing when a task needs a stable multi-stage structure, repeated use, or reviewable version history. A one-off task that the agent can finish directly does not need one.

## How the agent writes one

There are no special authoring tools. The agent uses its ordinary file tools and the command line:

1. It creates `~/.openprogram/workflows/<name>/` as a Git repository and writes the package: roles, functions, `PROGRAM_ENTRIES`, a `README.md` and behavior tests.
2. It runs `openprogram workflows check ~/.openprogram/workflows/<name>`. The check imports the package, runs its tests in the OS sandbox and commits when they pass.
3. On a failure it reads the report, fixes the package and checks again.

The running worker loads the committed Workflow within a few seconds. Its entries then appear as tools in every chat and on the Programs page, without a restart. Changing a Workflow works the same way: edit the files, check again. Earlier versions stay in the Workflow's Git history.

## Finding and running Workflows

```bash
openprogram workflows list
```

lists every Workflow with its state: loaded, failed to load, or not callable yet (for example, because it has uncommitted edits). In chat, each entry is a tool the agent calls like any other. The Programs page shows the same Workflows and opens a parameter form for each entry.

## Writing one yourself

The package form, the rules for roles and Context, the test helper and the check command are documented in [Write and check a Workflow](workflows/authoring.md).

For installable repositories that expose a set of agentic functions rather than one Workflow package, use the separate [harness installation contract](installing-harnesses.md).
