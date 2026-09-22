<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-lockup.gif">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-lockup-light.gif">
    <img src="docs/images/logo-lockup.gif" alt="OpenProgram" width="440">
  </picture>
</p>


# OpenProgram

<!-- Compatibility anchors for existing incoming links. -->
<a id="1-agentic-function-the-primitive-everything-else-is-built-on"></a>
<a id="2-dag-context-for-native-multi-agent-systems"></a>
<a id="3-agentic-workflow-for-trustworthy-self-evolving-agents"></a>
<a id="4-event-infrastructure-for-proactive-agents"></a>

<a id="integrated-projects"></a>
<a id="why-openprogram"></a>
<a id="1-agentic-function--the-primitive-everything-else-is-built-on"></a>
<a id="2-dag-context--for-native-multi-agent-systems"></a>
<a id="3-agentic-workflow--for-trustworthy--self-evolving-agents"></a>
<a id="4-event-infrastructure--for-proactive-agents"></a>
<a id="also-in-the-product"></a>


<b>Self-Programming AI Assistant. Capture, automate, and refine all your workflows.</b>

<p align="center">
  <a href="https://arxiv.org/abs/2606.15874"><img alt="arXiv" src="https://img.shields.io/badge/arXiv-2606.15874-b31b1b?style=flat-square"></a>
  <a href="https://github.com/fzkuji-neo/OpenProgram"><img alt="Version" src="https://img.shields.io/badge/version-0.9.8-blue?style=flat-square"></a>
  <a href="https://github.com/fzkuji-neo/OpenProgram/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square"></a>
  <a href="https://www.python.org/"><img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-blue?style=flat-square"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square">
  <a href="https://github.com/fzkuji-neo/OpenProgram/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/fzkuji-neo/OpenProgram/ci.yml?branch=main&style=flat-square&label=build"></a>
</p>


[English](README.md) · [Chinese](README.zh.md) · [Documentation](docs/README.md) · [API](docs/reference/API.md)

Python controls execution, validation and recovery; model calls provide decisions and generated content. Agentic functions, execution records and workflows make those operations inspectable and reusable. The [programming guide](docs/capabilities/agentic-programming/README.md) explains the model and APIs.

## Install

macOS and Linux:

```bash
curl -fsSL https://openprogram.io/install | sh
```

Windows x86_64 or arm64 CLI/server, when the selected release includes its runtime assets:

```powershell
irm https://openprogram.io/install.ps1 | iex
```

macOS desktop releases use a signed, notarized DMG. Windows desktop installers are available when a signed `win-x64.exe` or `win-arm64.exe` is attached to the [release](https://github.com/fzkuji-neo/OpenProgram/releases). See [installation](docs/install/install.md) for platform requirements, source installation and troubleshooting.

## Quick start

Start the setup wizard and terminal chat:

```bash
openprogram
```

Open the browser interface at http://localhost:18100:

```bash
openprogram web
```

Verify the configured provider with one reply:

```bash
openprogram --print "Introduce yourself in one sentence"
```

Use `openprogram setup` to change provider settings. Continue with [getting started](docs/start/GETTING_STARTED.md), [model configuration](docs/models/README.md), or the [documentation overview](docs/README.md).

## Core concepts

### Agentic functions

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/00-agentic-function.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/00-agentic-function-light.png">
    <img src="docs/images/highlights/00-agentic-function.png" alt="Agentic functions: Python control flow and explicit model calls" width="900">
  </picture>
</p>

An agent can be a Python function decorated with `@agentic_function`. Its docstring describes the function, arguments supply inputs, and `llm()` requests model output. Ordinary Python handles branching and validation.

This excerpt assumes a `search_logs` helper and an active runtime:

```python
from openprogram import agentic_function
from openprogram.agentic_programming import llm

@agentic_function
def triage(ticket: str, runtime=None) -> str:
    """Classify the ticket, then draft a reply."""
    kind = llm(ticket, choices=["bug", "feature", "question"])
    if kind == "bug":
        logs = search_logs(ticket)
        return llm(f"Reply using:\n{logs}")
    return llm("Draft a short reply.")
```

See [function reference](docs/reference/api/agentic-function.md) for parameters and behavior.

### DAG context

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/01-dag-context.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/01-dag-context-light.png">
    <img src="docs/images/highlights/01-dag-context.png" alt="Execution DAG: calls, context selection and branch collaboration" width="900">
  </picture>
</p>

User turns, model calls and function calls are recorded as DAG nodes. Context selection determines which recorded outputs a call reads. Branches support isolated sub-agents, cross-branch messages and alternative execution histories; file-changing agents can use Git worktrees. See [context](docs/reference/design/context/README.md) and [collaboration](docs/reference/design/runtime/agent-collaboration.md).

### Workflows

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/02-agentic-workflow.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/02-agentic-workflow-light.png">
    <img src="docs/images/highlights/02-agentic-workflow.png" alt="Workflows: reusable Python functions and validated model decisions" width="900">
  </picture>
</p>

Python defines required steps and checks model decisions before execution continues. Agents can create and revise their `@agentic_function` files using file tools; the watcher loads eligible changes for later calls. See [workflows](docs/capabilities/agentic-workflow.md) for authoring, reuse and validation.

### Events

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/03-event-infrastructure.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/03-event-infrastructure-light.png">
    <img src="docs/images/highlights/03-event-infrastructure.png" alt="Events: subscriptions to agent, context, channel and memory activity" width="900">
  </picture>
</p>

The process event bus publishes typed events from agent execution, authentication, context, channels and memory. Subscribers can respond to selected event types. For example:

```python
from openprogram.events import get_event_bus

unsubscribe = get_event_bus().subscribe(
    lambda event: print(event.payload),
    types={"context.compacted", "file.changed"},
)
# Call unsubscribe() when the subscriber is no longer needed.
```

Event delivery and autonomous policy execution have separate implementation boundaries. See [events](docs/reference/design/proactive/event-layer.md) and [feature status](docs/reference/design/feature-matrix.html).

## Features

- [Memory](docs/capabilities/memory.md): stored evidence, retrieval and background writing.
- [Interfaces](docs/interfaces/README.md): desktop, browser and terminal access.
- [Goals](docs/capabilities/goal.md): persistent objectives in ordinary conversations.
- [Providers](docs/models/providers.md): model services, credentials and accounts.
- [Updates](docs/install/upgrade.md): installation updates and recovery boundaries.

## Related projects

| Project | Purpose |
|---|---|
| [GUI Agent Harness](https://github.com/Fzkuji/GUI-Agent-Harness) | Desktop automation through screenshots and actions. |
| [Research Agent Harness](https://github.com/Fzkuji/Research-Agent-Harness) | Literature review, experiments and paper preparation. |
| [Scriptorium](https://github.com/Fzkuji/Scriptorium) | Source-cited Markdown memory through MCP. |

Install programs with `openprogram programs install <owner>/<repo>`. See [program installation](docs/capabilities/installing-harnesses.md).

## News

- 2026-08-17: built-in browser with panes, bookmarks, history and agent interaction.
- 2026-07-21: sub-agents, cross-session messaging and Git worktree isolation.
- 2026-06-22: paper accepted at the KDD 2026 Workshop on Agentic Software Engineering.
- 2026-06-07: installable programs and multiple provider accounts with key rotation.
- 2026-05-28: Web UI design system.
- 2026-04-04: built-in Anthropic, OpenAI and Gemini providers.
- 2026-04-03: initial release with agentic functions and an execution DAG.

## Citation

LLM-as-Code: Agentic Programming for Agent Harness. KDD 2026 Workshop on Agentic Software Engineering (AgenticSE). [arXiv:2606.15874](https://arxiv.org/abs/2606.15874).

```bibtex
@inproceedings{qi2026llmascode,
  title     = {LLM-as-Code: Agentic Programming for Agent Harness},
  author    = {Qi, Junjia and Fu, Zichuan and Gao, Jingtong and Zhang, Wenlin and Yan, Hanyu and Wu, Xian and Zhao, Xiangyu},
  booktitle = {KDD 2026 Workshop on Agentic Software Engineering (AgenticSE)},
  year      = {2026},
  eprint    = {2606.15874},
  archivePrefix = {arXiv},
  url       = {https://arxiv.org/abs/2606.15874},
}
```

## License

[AGPL-3.0](LICENSE) © 2026 Fzkuji. See the license for use, modification, distribution and network-service obligations.

## Acknowledgements

Thanks to contributors who provide code, reports, reproductions, tests, documentation and reviews.

<!-- contributors-avatars -->
<p>
<a href="https://github.com/fzkuji-neo"><img src="https://avatars.githubusercontent.com/u/331005172?v=4&amp;s=48" width="24" height="24" alt="Maintainer" /></a>
<a href="https://github.com/Qi202"><img src="https://github.com/Qi202.png?size=48" width="24" height="24" alt="Qi202" /></a>
<a href="https://github.com/GithungDang"><img src="https://github.com/GithungDang.png?size=48" width="24" height="24" alt="GithungDang" /></a>
<a href="https://github.com/basil-k-aji-dev"><img src="https://github.com/basil-k-aji-dev.png?size=48" width="24" height="24" alt="basil-k-aji-dev" /></a>
<a href="https://github.com/binyangzhu000-sudo"><img src="https://github.com/binyangzhu000-sudo.png?size=48" width="24" height="24" alt="binyangzhu000-sudo" /></a>
</p>
<!-- /contributors-avatars -->

[Issues](https://github.com/fzkuji-neo/OpenProgram/issues) · [Pull requests](https://github.com/fzkuji-neo/OpenProgram/pulls)
