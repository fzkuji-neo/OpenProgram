# Workflow

Workflow 是一个小型 Python 包：Agent 实例定义角色，Context 对象定义每次模型调用能看到什么，普通函数决定调用顺序。Workflow 由聊天 agent 直接编写和修改，不另设搜索、创建、修订 workflow 的工具。运行时，agent 把 workflow 当作普通工具调用。

本文是 workflow 唯一的设计记录。产品用法见 [自编程 Workflow](../../../capabilities/agentic-workflow.zh.md) 和 [编写、测试和发布 Workflow](../../../capabilities/workflows/authoring.zh.md)。

## Workflow 的形式

Workflow 包的顶层只有三类东西：

- **角色**：在模块顶层创建的 `Agent` 实例，只保存配置：`model`、`instructions`、`tools`、`effort`。不指定 model 的角色使用调用方的 runtime。
- **Context**：在函数里构造，显式传给角色调用。
- **函数**：普通 Python 函数，负责调用角色、处理数据、分支、循环和调用其他函数。

```python
from openprogram import Agent, Context

writer = Agent(instructions="你负责写周报。")
reviewer = Agent(instructions="你负责核对事实。", tools=[])

def weekly_report(notes: str) -> str:
    """把本周笔记整理成周报。"""
    ctx = Context({"笔记": notes})
    draft = write_draft(ctx)
    return check(draft, ctx)

def write_draft(ctx: Context) -> str:
    """按 进展 / 问题 / 计划 三段写，每段最多三条。"""
    return writer("写本周周报", context=ctx)

def check(draft: str, ctx: Context) -> str:
    """只核对草稿与笔记是否一致，不改文风。"""
    return reviewer("指出并修正不一致之处，输出终稿",
                    context=ctx.derive({"草稿": draft}))

PROGRAM_ENTRIES = [weekly_report]
```

规则：

- 模型调用只通过角色进行：`role(prompt, context=...)` 运行一次工具循环，`role.choose(prompt, {id: label})` 从选项中选一个。Workflow 代码不直接调用 `llm()`、`agent()` 这两个底层函数。
- `PROGRAM_ENTRIES` 列出对外暴露为工具的函数。入口的类型标注就是工具参数，docstring 就是工具描述。
- 没有装饰器、基类、DSL，也没有按字符串分发。一个 workflow 用另一个 workflow 时，直接 Python import。

## 一次模型调用能看到什么

`role(prompt, context=ctx)` 发出的请求只包含下面五部分，按此顺序：

| 顺序 | 内容 | 由谁定义 |
|---|---|---|
| 1 | 角色的 `instructions`（系统提示） | `Agent(...)` 实例 |
| 2 | 发起调用的函数的 docstring，只在这一次调用里有 | 函数 |
| 3 | `ctx` 里的命名内容块 | 构造或派生 `ctx` 的代码 |
| 4 | 历史，默认为空 | `ctx` 的历史设置 |
| 5 | `prompt` | 调用处 |

请求里不会出现其他内容。聊天记录、其他角色的输出、前面函数的执行过程，只有代码放进 `ctx` 或 `prompt` 时模型才能看到。`ctx` 不改变工具和权限，工具属于角色。

### Context

Workflow 使用现有的 `openprogram.context.Context`：

- **固定内容块**：`Context({"笔记": notes})`，或 `ctx["笔记"] = notes`。
- **调用时计算的块**：`Context(providers={"今日日期": lambda c: ...})`。provider 是同步函数，每次调用时运行。
- **派生**：`ctx.derive({...})` 返回一份独立副本。函数可以在副本里加块，或用 `DELETE` 删块，不影响调用方的 `ctx`。
- **历史**：
  - 不带（workflow 里的默认值）；
  - 用同一个 `ctx` 做过的前几次调用，适合同一个角色多轮修改；
  - 触发这个 workflow 的那段聊天；
  - 一个筛选历史条目的函数。

  这四种取值替换掉现在按图结构命名的 `history_filter` 取值 `"dag"` 和 `"current_call"`。

### 函数的 docstring

角色被调用时，runtime 沿 Python 调用栈往上，找到最近的、定义在这个 workflow 包里的函数，把它的 docstring 原样放进这一次请求。docstring 不存进 `ctx`，也不进历史，下一次调用不会带上。函数没有 docstring 就什么都不加。不加任何包裹标签、函数名、调用路径或防递归提示。

查找发生在调用时，读的是调用栈，因此不依赖会话存储，也不需要记录任何函数。

### 调用逻辑

如果想让模型知道这次调用处在程序的哪个位置，可以选择加入，方式是普通的内容块：

- **调用路径**：内置 provider `call_path` 列出调用栈上的 workflow 函数，例如 `weekly_report → check`。`call_path(docs=True)` 会附上每个函数的 docstring。
- **整个程序**：内置 provider `workflow_source` 返回入口函数的源码，模型能看到自己前后的步骤。
- **手写说明**：普通内容块，例如 `{"流程": "先写草稿，再由审稿人核对；你是第二步。"}`。

放在顶层 `ctx` 里的块，所有角色调用都能看到；放在派生出的 `ctx` 里的块，只有那个函数里的调用能看到。

docstring 查找和 `call_path` 都通过 `sys._getframe` 和 `co_qualname` 实现，需要 Python 3.11 及以上。限制：

- **线程和并发任务**：调用栈在线程池、`create_task`、`gather` 处断开。入口函数存放在一个 contextvar 里，它会传入 asyncio 任务和 `asyncio.to_thread`，所以入口这一层能补回来；入口和断点之间的层级补不回来。
- **嵌套函数**：定义在另一个函数内部的函数，只能拿到名字，拿不到 docstring。Workflow 的步骤写成模块顶层函数。

## 记录

会话图只记录两类节点：

- workflow 入口调用一个节点，保存参数、结果或错误；
- 每次角色调用一个子节点，保存实际发给模型的请求、回复和角色的工具循环。

普通函数不记录，也不出现在图里保存的任何调用路径中。角色节点上保存的请求只供查看，后续调用不会把它读回上下文。

## 编写

- 聊天 agent 用普通文件工具编写 workflow 包，由一个编写 workflow 的 skill 提供指导。
- `openprogram.testing` 提供一个测试辅助函数：用预设回复替换角色调用，并记录每次请求，测试可以断言角色到底看到了什么。
- `openprogram workflows check <dir>` 导入包，检查 `PROGRAM_ENTRIES` 和入口签名，并运行包内测试。

## 存储与加载

- 用户的 workflow 放在 `~/.openprogram/workflows/<name>/`，每个 workflow 是一个独立的 Git 仓库。
- `check` 通过后自动提交。历史和回滚都用 Git。
- 文件变化时 watcher 重新加载 workflow。加载和检查错误显示在 Programs 页面对应 workflow 旁边。
- Workflow 以源码形式存在，在进程内运行。import 不受限制，和用户安装的其他 Python 代码一样。

## 运行

- 聊天 agent 把 workflow 入口当作工具调用。调用在 worker 进程内执行，并按上文记录节点。
- `openprogram programs run <name> -p <provider> -m <model>` 从命令行运行入口。
- 没有设置超时的 Agent 方法工具运行在事件循环线程上。长时间运行的 workflow 会不会因此阻塞 worker，要先实测，再确定运行路径。
- 重启后恢复执行使用 `openprogram.agentic_programming.continuation.step`，不放进第一版。

## 删除的内容

- 工具 `search_workflows`、`create_workflow`、`revise_workflow`、`auto_workflow`、`resume_workflow`。
- `programs/workflow/_generation`、`_project/validation.py` 里的顶层白名单、`_runtime/state.py` 里的包快照 checkpoint。
- 旧的单文件 workflow 格式，以及 `program-sources.json` 里的 workflow 信任记录。
- `auto_workflow` 的界面。
- `_situational_prefix` 生成的 `<situation>` 前缀。

保留的内容：Codex 401 时强制刷新 token、`programs run -p/-m`、字符串工具名的解析。

## 迁移

- 用户的 `weekly_report` 系列和 `llm_knowledge_research` 按新形式迁到 `~/.openprogram/workflows/`。
- 内置 workflow 暂时保持现有形式，之后再统一迁移。
- 新形式上线后，产品文档和 README 改为描述新形式。

## 阶段

1. 角色调用：docstring 注入、四种历史设置、`call_path` 和 `workflow_source`、角色节点挂在入口节点下、删除 `<situation>`。
2. 加载与存储：`~/.openprogram/workflows`、check 通过后 Git 提交、watcher、Programs 页面显示错误。
3. 编写：skill、测试辅助函数、`workflows check`，然后删除旧工具和旧代码。
4. 迁移用户的 workflow，更新产品文档。

## 待定问题

| 问题 | 建议 |
|---|---|
| Workflow 代码的 import 边界 | 不限制 |
| Workflow 如何变为可调用 | `check` 通过后自动可用 |
| 第一版是否支持恢复执行 | 不支持 |
| 现在迁移哪些 workflow | 只迁用户自己的 |

## 实现状态

| 项目 | 状态 |
|---|---|
| Codex 401 刷新、`programs run -p/-m`、工具名解析 | 已实现 |
| 本文其余内容 | 已设计，未实现 |
