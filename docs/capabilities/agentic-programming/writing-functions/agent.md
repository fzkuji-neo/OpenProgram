# Agent calls and ordinary methods

Use `agent()` for a direct model request. Use an `Agent` subclass when several methods share model settings and instructions. The framework creates call scopes and Context automatically.


Each Agent execution owns its DAG. Chat records user messages, model requests and directly dispatched tools; ordinary helpers create no durable nodes. Calling another Agent creates an independent DAG; the parent stores the invocation result and a child_session_id reference. Permission, cancellation and file-checkpoint ownership remain with the originating execution, independent of graph ownership.

## Ordinary methods

```python
from openprogram import Agent

class ReviewAgent(Agent):
    tools = []
    instructions = "Preserve facts. Return concise text."

    def classify(self, review: str) -> str:
        """Classify review sentiment."""
        return self(f"Classify as positive, negative, or neutral:\n{review}")

    def summarize(self, review: str) -> str:
        """Summarize a review with its sentiment."""
        sentiment = self.classify(review)
        return self(f"Summarize this {sentiment} review in one sentence:\n{review}")

reviewer = ReviewAgent(model="configured-model")
summary = reviewer.summarize("The service was fast.")
```

`classify` and `summarize` are ordinary Python methods. Internal helper calls do not create DAG nodes. `self(...)` makes a model request through the existing Runtime. The docstring describes the function call. The prompt provides the model instruction and data.

An Agent instance stores configuration. It does not implicitly retain a conversation between independent top-level calls. Nested calls on the same Agent use the active execution; another Agent gets a separate graph. Context selects permitted history and resolves configured content for each request.

## Direct calls and asynchronous code

```python
from openprogram import agent, agent_async

answer = agent("Summarize this text", tools=[])
# In an async function:
# answer = await agent_async("Summarize this text", tools=[])
# answer = await reviewer.arun("Summarize this text")
```

Use `tools=[]` for a request without model tools. With `tools=None`, the runtime resolves available tools and applies the current authorization rules.

## Method metadata and explicit tools

Declare `method_options` when a public method needs input form metadata, visibility rules, or explicit tool registration:

```python
class TextAgent(Agent):
    tools = []
    method_options = {
        "summarize": {
            "tool": True,
            "name": "summarize_text",
            "input": {"text": {"description": "Text to summarize"}},
            "expose": "io",
        },
    }

    def summarize(self, text: str) -> str:
        """Summarize text."""
        return self(f"Summarize:\n{text}")
```

Recording a method does not make it a tool. `tool=True` explicitly registers the method. Function names and signatures supply the tool schema. Visibility controls history rendering and does not grant tool permissions.

## Ordinary Program functions

The managed loader captures ordinary source-defined functions in authorized Program packages. List public entry functions in `PROGRAM_ENTRIES`. Private helpers retain runtime access without producing DAG nodes or becoming tools. This capture does not extend to arbitrary host files or dependencies.

For deterministic composition, call methods or functions in Python. For model-selected calls, supply explicitly registered tools. See [tool calling](../choosing-the-next-step/tool-calling.md).

## Method behavior

Agent methods retain explicit metadata, tool registration, authorization, and durable steps through `method_options`. The [API reference](../../../reference/api/agent.md) documents Context, method options, and method configuration. Existing [function metadata](function-metadata.md) describes the method fields.
