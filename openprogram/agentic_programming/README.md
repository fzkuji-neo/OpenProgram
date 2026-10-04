# Agent execution

`Agent` configures model calls and automatically records ordinary subclass methods. `Context` controls named content, dynamic providers, session references, and DAG history selection.

```python
from openprogram import Agent, Context

class Researcher(Agent):
    def analyze(self, task):
        return self(task)

researcher = Researcher(context=Context({"topic": "agent memory"}))
researcher.analyze("Compare the methods.")
```

`llm` makes one model request. `agent` runs a tool loop. `decision.make` selects a callable or value. `Runtime` handles providers, tool authorization, request budgets, usage, and model records.

Execution uses the existing Session DAG. Explicit resumable Agent methods use `continuation.step`, `workflow`, and `parallel` with JSON state. Configure them through `method_options`; application methods require no decorator.

`agent_class.py` defines Agent configuration. `agent_method.py` implements method options and tool registration. `call_scope.py` manages call lifetime. `call_state.py` stores task-local call state. `tool_format.py` converts method tool specifications to external formats.
