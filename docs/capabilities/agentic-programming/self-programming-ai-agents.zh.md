<div id="self-programming-ai-agents"></div>

# 自编程 AI Agent

自编程 AI agent 可以在工作过程中创建或修改可执行工作流。在 OpenProgram 中，
这些工作流使用 `@agentic_function` 装饰器：agent 用常规工具编辑源文件，
runtime 验证并加载函数，后续轮次可通过与现有工具相同的注册表调用它。

这项能力的范围小于不受限制的自我修改。OpenProgram 不允许模型静默替换 runtime
或绕过验证。可编辑单元是能够审查的函数，具有声明的接口、显式工具访问、
执行记录和常规源码版本控制。

<div id="what-the-agent-programs"></div>

## Agent 编写什么

Agentic function 将确定性控制流与模型决策结合：

```python
from openprogram import agentic_function


@agentic_function
def review_then_revise(draft: str, runtime=None) -> str:
    """Review a draft, then revise it against the review."""
    review = runtime.exec(
        content=f"Identify concrete defects in this draft:\n\n{draft}",
        toolset="none",
    )
    return runtime.exec(
        content=f"Revise the draft using this review:\n\n{review}\n\n{draft}",
        toolset="none",
    )
```

Python 函数体固定所需的执行顺序，模型处理两个语义步骤。每次调用都可在
OpenProgram 的执行上下文中查看。

<div id="how-an-agent-creates-one"></div>

## Agent 如何创建函数

安装并启动 OpenProgram：

```bash
curl -fsSL https://openprogram.io/install | sh
openprogram
```

然后向 agent 请求一个范围明确的工作流，例如：

```text
创建一个名为 review_then_revise 的 agentic function。它必须审查草稿，
根据审查意见修订，仅暴露最终输出，并包含冒烟测试。提交前向我展示 diff。
```

随附的 [Agentic function API](../../reference/api/agentic-function.zh.md)
定义文件布局、装饰器合同、验证步骤和冒烟测试。
Watcher 可以加载已批准的函数，无需重启 worker。

<div id="runtime-controls-that-still-apply"></div>

## 仍然适用的 Runtime 控制

- 工具访问由函数的显式 runtime 调用和配置的审批策略决定。
- 函数调用、模型调用及其上下文关系记录在会话 DAG 中。
- 资源限制、取消、结构化输出验证和提供商用量核算仍由 runtime 负责。
- 源码修改仍是普通文件：可以在发布前检查、测试、回退和审查。

<div id="when-to-use-it"></div>

## 何时使用

当重复任务需要可复用、可检查的流程，而语义步骤仍需要模型判断时，使用自编程。
当整个操作都是确定性操作时，使用普通函数。
当操作已有稳定实现时，使用现有工具。

完整执行合同见 [Agentic Programming 指南](README.zh.md)、
[`@agentic_function` 参考](../../reference/api/agentic-function.zh.md)和
[设计理由](philosophy.zh.md)。
