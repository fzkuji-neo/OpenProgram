# Agent 调用与普通方法

单次模型请求使用 `agent()`。多个方法共用模型设置和指令时，定义 `Agent` 子类。框架自动建立调用作用域并管理 Context。


每个 Agent 执行分别管理自己的 DAG。聊天只记录用户消息、模型请求和直接工具调用；普通辅助函数不产生持久化节点。调用另一个 Agent 时创建独立 DAG，父图只保存调用结果和 child_session_id 引用。权限、取消与文件修改备份仍由原执行负责，不依赖图所有权。

## 普通方法

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

`classify` 和 `summarize` 是普通 Python 方法，作用域记录父子关系。`self(...)` 通过现有 Runtime 请求模型。docstring 描述函数调用，prompt 提供模型指令与数据。

Agent 实例保存配置，不默认在独立顶层调用之间保存会话。嵌套调用使用当前执行。Context 为每次请求选择允许读取的历史，并求值已配置内容。

## 直接调用与异步代码

```python
from openprogram import agent, agent_async

answer = agent("Summarize this text", tools=[])
# 在异步函数内：
# answer = await agent_async("Summarize this text", tools=[])
# answer = await reviewer.arun("Summarize this text")
```

`tools=[]` 禁用模型工具。`tools=None` 由 Runtime 选择可用工具，并执行当前授权规则。

## 方法元数据与显式工具

公开方法需要表单元数据、可见性规则或工具登记时，声明 `method_options`：

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

方法记录不会自动注册工具。`tool=True` 显式登记该方法。函数名称与签名提供工具 schema。可见性控制历史呈现，不授予工具权限。

## 普通 Program 函数

受管加载器采集授权 Program 包中的普通源码函数。通过 `PROGRAM_ENTRIES` 列出公开入口。私有帮助函数保留调用作用域，不自动成为工具。该采集不作用于任意宿主文件或依赖。

确定性编排直接调用 Python 方法或函数。模型选择调用时，提供显式登记的工具，见 [工具调用](../choosing-the-next-step/tool-calling.zh.md)。

## 方法功能

Agent 方法通过 `method_options` 承担输入元数据、工具登记、权限与持久步骤。[API 参考](../../../reference/api/agent.zh.md) 说明 Context、方法选项和方法配置。各字段见 [函数元数据](function-metadata.zh.md)。
