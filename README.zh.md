<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-lockup.gif">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-lockup-light.gif">
    <img src="docs/images/logo-lockup.gif" alt="OpenProgram" width="440">
  </picture>
</p>


# OpenProgram

用于构建、运行和改进 Agent 工作流的 AI 助手与 Python 框架。

<p align="center">
  <a href="https://arxiv.org/abs/2606.15874"><img alt="arXiv" src="https://img.shields.io/badge/arXiv-2606.15874-b31b1b?style=flat-square"></a>
  <a href="https://github.com/fzkuji-neo/OpenProgram"><img alt="版本" src="https://img.shields.io/badge/version-0.9.8-blue?style=flat-square"></a>
  <a href="https://github.com/fzkuji-neo/OpenProgram/blob/main/LICENSE"><img alt="许可证" src="https://img.shields.io/badge/license-AGPL--3.0-green?style=flat-square"></a>
  <a href="https://www.python.org/"><img alt="Python" src="https://img.shields.io/badge/python-3.11%2B-blue?style=flat-square"></a>
  <img alt="平台" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square">
  <a href="https://github.com/fzkuji-neo/OpenProgram/actions/workflows/ci.yml"><img alt="构建状态" src="https://img.shields.io/github/actions/workflow/status/fzkuji-neo/OpenProgram/ci.yml?branch=main&style=flat-square&label=build"></a>
</p>


[English](README.md) · [简体中文](README.zh.md) · [文档](docs/README.zh.md) · [API](docs/reference/API.zh.md)

Python 控制执行、验证和恢复，模型调用负责判断及内容生成。Agentic 函数、执行记录和工作流使这些操作可以检查和复用。[编程指南](docs/capabilities/agentic-programming/README.zh.md)介绍其概念与 API。

## 安装

macOS 和 Linux：

```bash
curl -fsSL https://openprogram.io/install | sh
```

Windows x86_64 或 arm64 CLI／服务端需要所选发行版包含对应运行时：

```powershell
irm https://openprogram.io/install.ps1 | iex
```

macOS 桌面发行版使用经过签名和公证的 DMG。Windows 桌面安装包在[发行页](https://github.com/fzkuji-neo/OpenProgram/releases)包含已签名的 `win-x64.exe` 或 `win-arm64.exe` 时可用。平台要求、源码安装和故障排查见[安装说明](docs/install/install.zh.md)。

## 快速开始

启动配置向导和终端聊天：

```bash
openprogram
```

打开浏览器界面，地址为 http://localhost:18100：

```bash
openprogram web
```

通过一次回复检查模型服务配置：

```bash
openprogram --print "请用一句话介绍你自己"
```

使用 `openprogram setup` 修改模型服务设置。继续阅读[快速上手](docs/start/GETTING_STARTED.zh.md)、[模型配置](docs/models/README.zh.md)或[文档总览](docs/README.zh.md)。

## 核心概念

### Agentic 函数

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/00-agentic-function.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/00-agentic-function-light.png">
    <img src="docs/images/highlights/00-agentic-function.png" alt="Agentic 函数：Python 控制流程与显式模型调用" width="900">
  </picture>
</p>

Agent 可以是使用 `@agentic_function` 装饰的 Python 函数。文档字符串描述函数，参数提供输入，`llm()` 请求模型输出。分支和验证由普通 Python 代码处理。

以下片段假设已经提供 `search_logs` 辅助函数和可用的运行时：

```python
from openprogram import agentic_function
from openprogram.agentic_programming import llm

@agentic_function
def triage(ticket: str, runtime=None) -> str:
    """对工单分类，然后起草回复。"""
    kind = llm(ticket, choices=["bug", "feature", "question"])
    if kind == "bug":
        logs = search_logs(ticket)
        return llm(f"根据以下日志回复：\n{logs}")
    return llm("起草简短回复。")
```

参数和行为见[函数参考](docs/reference/api/agentic-function.zh.md)。

### DAG 上下文

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/01-dag-context.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/01-dag-context-light.png">
    <img src="docs/images/highlights/01-dag-context.png" alt="执行 DAG：调用、上下文选择和分支协作" width="900">
  </picture>
</p>

用户轮次、模型调用和函数调用都记录为 DAG 节点。上下文选择决定一次调用读取哪些已记录输出。分支支持隔离的子 Agent、跨分支消息和不同执行历史；修改文件的 Agent 可以使用 Git 工作树。详见[上下文](docs/reference/design/context/README.zh.md)和[协作](docs/reference/design/runtime/agent-collaboration.zh.md)。

### 工作流

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/02-agentic-workflow.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/02-agentic-workflow-light.png">
    <img src="docs/images/highlights/02-agentic-workflow.png" alt="工作流：可复用的 Python 函数与模型决策验证" width="900">
  </picture>
</p>

Python 定义必需步骤，并在继续执行前检查模型决策。Agent 可以通过文件工具创建和修改自己的 `@agentic_function` 文件；监听器加载符合条件的修改，供后续调用使用。编写、复用和验证方法见[工作流](docs/capabilities/agentic-workflow.zh.md)。

### 事件

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/highlights/03-event-infrastructure.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/highlights/03-event-infrastructure-light.png">
    <img src="docs/images/highlights/03-event-infrastructure.png" alt="事件：订阅 Agent、上下文、渠道和记忆活动" width="900">
  </picture>
</p>

进程事件总线发布 Agent 执行、认证、上下文、渠道和记忆中的类型化事件。订阅者可以响应选定的事件类型。例如：

```python
from openprogram.events import get_event_bus

unsubscribe = get_event_bus().subscribe(
    lambda event: print(event.payload),
    types={"context.compacted", "file.changed"},
)
# 不再需要订阅时调用 unsubscribe()。
```

事件投递和自主策略执行具有不同的实现边界。详见[事件](docs/reference/design/proactive/event-layer.zh.md)和[功能状态](docs/reference/design/feature-matrix.zh.html)。

## 功能

- [记忆](docs/capabilities/memory.zh.md)：证据存储、检索和后台写入。
- [界面](docs/interfaces/README.zh.md)：桌面、浏览器和终端访问。
- [目标](docs/capabilities/goal.zh.md)：普通会话中的持久目标。
- [模型服务](docs/models/providers.zh.md)：模型服务、凭据和账号。
- [更新](docs/install/upgrade.zh.md)：安装更新与恢复边界。

## 相关项目

| 项目 | 用途 |
|---|---|
| [GUI Agent Harness](https://github.com/Fzkuji/GUI-Agent-Harness) | 使用截图和操作进行桌面自动化。 |
| [Research Agent Harness](https://github.com/Fzkuji/Research-Agent-Harness) | 文献综述、实验与论文准备。 |
| [Scriptorium](https://github.com/Fzkuji/Scriptorium) | 通过 MCP 提供带来源引用的 Markdown 记忆。 |

使用 `openprogram programs install <owner>/<repo>` 安装程序。详见[程序安装](docs/capabilities/installing-harnesses.zh.md)。

## 动态

- 2026-08-17：内置浏览器，支持分栏、书签、历史记录和 Agent 操作。
- 2026-07-21：子 Agent、跨会话消息和 Git 工作树隔离。
- 2026-06-22：论文被 KDD 2026 Agentic Software Engineering 研讨会接收。
- 2026-06-07：可安装程序、模型服务多账号及密钥轮换。
- 2026-05-28：网页界面设计系统。
- 2026-04-04：内置 Anthropic、OpenAI 和 Gemini 模型服务。
- 2026-04-03：首次发布，包含 Agentic 函数和执行 DAG。

## 引用

LLM-as-Code: Agentic Programming for Agent Harness。KDD 2026 Workshop on Agentic Software Engineering (AgenticSE)。[arXiv:2606.15874](https://arxiv.org/abs/2606.15874)。

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

## 许可证

[AGPL-3.0](LICENSE) © 2026 Fzkuji。使用、修改、分发和网络服务的义务以许可证全文为准。

## 致谢

感谢提供代码、问题报告、复现、测试、文档和审查的贡献者。

<!-- contributors-avatars -->
<p>
<a href="https://github.com/fzkuji-neo"><img src="https://avatars.githubusercontent.com/u/331005172?v=4&amp;s=48" width="24" height="24" alt="维护者" /></a>
<a href="https://github.com/Qi202"><img src="https://github.com/Qi202.png?size=48" width="24" height="24" alt="Qi202" /></a>
<a href="https://github.com/GithungDang"><img src="https://github.com/GithungDang.png?size=48" width="24" height="24" alt="GithungDang" /></a>
<a href="https://github.com/basil-k-aji-dev"><img src="https://github.com/basil-k-aji-dev.png?size=48" width="24" height="24" alt="basil-k-aji-dev" /></a>
<a href="https://github.com/binyangzhu000-sudo"><img src="https://github.com/binyangzhu000-sudo.png?size=48" width="24" height="24" alt="binyangzhu000-sudo" /></a>
</p>
<!-- /contributors-avatars -->

[问题反馈](https://github.com/fzkuji-neo/OpenProgram/issues) · [拉取请求](https://github.com/fzkuji-neo/OpenProgram/pulls)
