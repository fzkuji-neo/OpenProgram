# API Reference

> Source: [`openprogram/`](https://github.com/fzkuji-neo/OpenProgram/tree/main/openprogram/)

## Core Components

| Component | Source File | Description |
|------|--------|------|
| [`Agent`, `Context`, `agent`, `agent_async`](api/agentic-function.md) | `agentic_programming/`, `context/model.py` | Direct calls, configured Agent methods, and automatic execution context |
| [`agentic_function`](api/agentic-function.md) | `agentic_programming/function.py` | A decorator. Turns a plain function into an Agentic Function; each call is recorded as a node in the session DAG |
| [`Runtime`](api/runtime.md) | `agentic_programming/runtime.py` | The LLM runtime. Computes context from the DAG, calls the LLM, and writes the response back to the DAG |
| [`create_runtime` and the built-in providers](api/providers.md) | `providers/` | Automatically detect or explicitly create a Runtime; supports Anthropic / OpenAI / Gemini / CLI providers |

The session context is a flat DAG (nodes = user messages / LLM calls / function calls); for the architecture see [`openprogram/context/README.md`](https://github.com/fzkuji-neo/OpenProgram/blob/main/openprogram/context/README.md).

## Writing Functions

There are no meta functions like `create()` / `fix()` — writing, modifying, and validating Agent methods or ordinary Program functions is done directly with ordinary file-editing tools. The [Agent and Context API](api/agentic-function.md) defines ordinary methods, automatic context, and legacy compatibility.

## Imports

```python
from openprogram import Agent, Context, agent, agent_async, agentic_function, Runtime, Session, decision
from openprogram.providers.registry import create_runtime
```

`Agent`, `Context`, `agent`, `agent_async`, `agentic_function`, `Runtime`, `Session`, and `decision` are re-exported from
the top-level `openprogram` package. Provider helpers such as `create_runtime`
are imported from their full paths.

## Quick Example

```python
from openprogram import Agent

class Observer(Agent):
    tools = []

    def observe(self, task: str) -> str:
        """Identify the requested UI element."""
        return self(f"Find the UI element for: {task}. Reply with its label only.")

print(Observer().observe("login button"))
```
