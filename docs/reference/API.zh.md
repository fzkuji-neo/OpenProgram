<div id="api-reference"></div>

# API 参考

> Source: [`openprogram/`](https://github.com/fzkuji-neo/OpenProgram/tree/main/openprogram/)

## 核心组件

| 组件 | 源文件 | 说明 |
|------|--------|------|
| [`Agent`、`Context`、`agent`、`agent_async`](api/agentic-function.zh.md) | `agentic_programming/`、`context/model.py` | 直接调用、配置化 Agent 方法与自动执行上下文 |
| [`agentic_function`](api/agentic-function.zh.md) | `agentic_programming/function.py` | 装饰器。把普通函数变成 Agentic Function,每次调用记录为 session DAG 的一个节点 |
| [`Runtime`](api/runtime.zh.md) | `agentic_programming/runtime.py` | LLM 运行时。从 DAG 算上下文、调用 LLM、把回复写回 DAG |
| [`create_runtime` 与内置 providers](api/providers.zh.md) | `providers/` | 自动检测或显式创建 Runtime,支持 Anthropic / OpenAI / Gemini / CLI providers |

会话上下文是一张扁平 DAG(节点 = 用户消息 / LLM 调用 / 函数调用),架构见 [`openprogram/context/README.md`](https://github.com/fzkuji-neo/OpenProgram/blob/main/openprogram/context/README.md)。

## 编写函数

没有 `create()` / `fix()` 这类 meta 函数——编写、修改、校验 Agent 方法或普通 Program 函数 直接用普通文件编辑工具完成。[Agent 与 Context API](api/agentic-function.zh.md) 定义普通方法、自动上下文和旧接口兼容。

## 导入

```python
from openprogram import Agent, Context, agent, agent_async, agentic_function, Runtime, Session, decision
from openprogram.providers.registry import create_runtime
```

`Agent`、`Context`、`agent`、`agent_async`、`agentic_function`、`Runtime`、`Session` 和 `decision` 都从 `openprogram`
顶层导出。`create_runtime` 这类 provider helper 仍需从完整路径导入。

## 快速示例

```python
from openprogram import Agent

class Observer(Agent):
    tools = []

    def observe(self, task: str) -> str:
        """Identify the requested UI element."""
        return self(f"Find the UI element for: {task}. Reply with its label only.")

print(Observer().observe("login button"))
```
