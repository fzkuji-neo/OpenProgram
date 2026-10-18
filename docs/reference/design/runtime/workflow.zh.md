# Workflow

Workflow 是一个小型 Python 包：Agent 实例定义角色，Context 对象定义每次模型调用能看到什么，普通函数决定调用顺序。Workflow 由聊天 agent 直接编写和修改，不另设搜索、创建、修订 workflow 的工具。运行时，agent 把 workflow 当作普通工具调用。

本文是 workflow 唯一的设计记录。产品用法见 [自编程 Workflow](../../../capabilities/agentic-workflow.zh.md) 和 [编写和检查 Workflow](../../../capabilities/workflows/authoring.zh.md)。

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
- 可选的 `ENTRY_OPTIONS` 字典把入口名映射到工具选项，例如 `input` 下每个参数的表单说明，或 `run_in_worker`（见「运行」）。
- 没有装饰器、基类、DSL，也没有按字符串分发。一个 workflow 用另一个 workflow 时，直接 Python import。

## 一次模型调用能看到什么

`role(prompt, context=ctx)` 发出的请求只包含下面五部分，按此顺序：

| 顺序 | 内容 | 由谁定义 |
|---|---|---|
| 1 | 角色的 `instructions`（系统提示） | `Agent(...)` 实例 |
| 2 | 历史，默认为空，作为之前的消息 | `ctx` 的历史设置 |
| 3 | 发起调用的函数的 docstring，只在这一次调用里有 | 函数 |
| 4 | `ctx` 里的命名内容块 | 构造或派生 `ctx` 的代码 |
| 5 | `prompt` | 调用处 |

第 3 到 5 部分组成当前的用户消息，历史作为更早的轮次排在它前面。

请求里不会出现其他内容。聊天记录、其他角色的输出、前面函数的执行过程，只有代码放进 `ctx` 或 `prompt` 时模型才能看到。`ctx` 不改变工具和权限，工具属于角色。

### Context

Workflow 使用现有的 `openprogram.context.Context`：

- **固定内容块**：`Context({"笔记": notes})`，或 `ctx["笔记"] = notes`。
- **调用时计算的块**：`Context(providers={"今日日期": lambda c: ...})`。provider 是同步函数，每次调用时运行。
- **派生**：`ctx.derive({...})` 返回一份独立副本。函数可以在副本里加块，或用 `DELETE` 删块，不影响调用方的 `ctx`。
- **历史**：用 `Context(..., history=...)` 或 `ctx.derive(history=...)` 设置：
  - `None`：不带（workflow 里的默认值）；
  - `"thread"`：用同一个 `ctx` 对象做过的前几次调用，包括它们的 prompt 和回复，适合同一个角色多轮工作；
  - `"chat"`：触发这个 workflow 的那段聊天；
  - 一个筛选历史条目的函数。

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

- 聊天 agent 用普通文件工具编写 workflow 包，由产品文档页[编写和检查 Workflow](../../../capabilities/workflows/authoring.zh.md)提供指导。OpenProgram 不内置第一方 skill，所以没有单独的编写 skill。
- `openprogram.testing.script_roles` 用预设回复替换角色调用，并记录每次请求。记录下的请求提供 `text`（instructions、docstring、内容块和 prompt）和 `history_text`，测试可以断言角色到底看到了什么。
- `openprogram workflows check <dir> [-m MESSAGE] [--json]` 在子进程中导入包，检查 `PROGRAM_ENTRIES` 和入口签名，并在操作系统沙箱中运行包内测试：无网络、包目录只读、`HOME` 为空。
- `openprogram workflows list [--json]` 列出用户 workflow 及其加载状态。

## 存储与加载

- 用户的 workflow 放在 `~/.openprogram/workflows/<name>/`，每个 workflow 是一个独立的 Git 仓库，以自己的顶层名字导入。
- 内置 workflow 放在 `openprogram/programs/workflow/<name>/`，以 `openprogram.programs.workflow.<name>` 导入，使用同样的形式。
- `check` 通过后自动提交，workflow 随即可以调用，不需要单独的启用步骤。只有干净、已提交的包才会加载；有未提交改动的包继续提供上次加载的版本。历史和回滚都用 Git。
- 文件变化时 watcher 重新加载 workflow。加载和检查错误显示在 Programs 页面对应 workflow 旁边。
- Workflow 以源码形式存在，在进程内运行。import 不受限制，和用户安装的其他 Python 代码一样。

## 运行

- 聊天 agent 把 workflow 入口当作工具调用。调用在 fork 出的子进程中执行，并按上文记录节点。设置了 `run_in_worker` 的入口改在 worker 进程内执行，用于使用 worker 持有状态（如浏览器会话）的工具。
- `openprogram programs run <name> -p <provider> -m <model>` 从命令行运行入口。
- 重启后恢复执行使用 `openprogram.agentic_programming.continuation.step`。

## 示例：`llm_knowledge_research`

你的论文调研 workflow，压缩成一个文件，完整展示这种形式。

```
~/.openprogram/workflows/llm_knowledge_research/
├── .git/
├── workflow.py          角色、步骤和入口
├── report.py            渲染并保存 Markdown，不调用模型
└── tests/
    └── test_workflow.py
```

### `workflow.py`

```python
"""Research recent LLM papers on arXiv and save a Markdown report."""

from datetime import datetime
from zoneinfo import ZoneInfo

from openprogram import Agent, Context
from openprogram.context import call_path
from openprogram.programs.tools.web.web_search.providers.arxiv import ArxivProvider

from .report import render_report, save_report

THEMES = ("Memory architecture", "Memory lifecycle", "Modular experts", "Knowledge adaptation")

# 角色：只有配置。没有指定 model，使用调用方的模型。
planner = Agent(
    instructions="You plan arXiv searches for LLM research. You never state paper facts.",
    tools=[],
)
selector = Agent(
    instructions="You choose papers by reading their titles and abstracts. "
                 "You never invent or rewrite papers.",
    tools=[],
    effort="high",
)


def llm_knowledge_research(task: str, max_queries: int = 4) -> str:
    """Find 2025-2026 LLM papers on arXiv for a research task and save a Markdown report."""
    ctx = Context({"task": task, "themes": THEMES}, providers={"call path": call_path})
    plan_ctx = ctx.derive(history="thread")      # planner 能看到自己之前的规划

    plan = plan_queries(plan_ctx, max_queries)
    papers = search_arxiv(plan)
    chosen = select_papers(ctx.derive({"candidates": papers}))

    if not chosen and decide_to_broaden(plan_ctx) == "broaden":
        plan = plan_queries(plan_ctx, max_queries, broaden=True)
        papers = search_arxiv(plan)
        chosen = select_papers(ctx.derive({"candidates": papers}))

    path = save_report(render_report(task, plan, chosen, today()))
    return f"Saved {len(chosen)} papers to {path}."


def plan_queries(ctx: Context, max_queries: int, broaden: bool = False) -> list[dict]:
    """Write arXiv queries for the task. Each query belongs to one of the themes.
    Respect the task's limits and exclusions; a narrow task does not need every theme.
    Queries are at most 256 characters. Return queries only, no paper facts."""
    prompt = f"Plan at most {max_queries} queries."
    if broaden:
        prompt += " The last plan found nothing relevant. Make the queries broader."
    reply = planner(prompt, context=ctx, response_format=PLAN_SCHEMA)
    return check_plan(reply["queries"], max_queries)


def decide_to_broaden(ctx: Context) -> str:
    """No selected paper matched the task. Decide whether broader queries could help
    or whether the task is outside what arXiv covers."""
    return planner.choose("What next?", {
        "broaden": "Search again with broader queries",
        "stop": "Report that nothing relevant was found",
    }, context=ctx)


def select_papers(ctx: Context) -> list[dict]:
    """Compare the actual titles and abstracts with the task. A keyword match or a
    recent date is not relevance. At most five papers per theme and twenty in total.
    Select none if nothing fits."""
    if not ctx["candidates"]:
        return []
    reply = selector("Return the IDs of relevant candidates, most relevant first.",
                     context=ctx, response_format=SELECTION_SCHEMA)
    return pick(ctx["candidates"], reply["ids"])


# 以下是普通代码：不调用模型，不做记录。

def search_arxiv(plan: list[dict]) -> list[dict]:
    """Run each query on the official arXiv API and keep unique 2025-2026 papers."""
    arxiv, papers, seen = ArxivProvider(), [], set()
    for item in plan:
        for hit in arxiv.search(item["query"], num_results=25):
            year = str(hit.extras.get("published") or "")[:4]
            if year in {"2025", "2026"} and hit.url not in seen:
                seen.add(hit.url)
                papers.append({"id": f"p{len(papers) + 1}", "theme": item["theme"],
                               "title": hit.title, "url": hit.url, "abstract": hit.snippet,
                               "published": hit.extras.get("published")})
    return papers


def today() -> str:
    return datetime.now(ZoneInfo("Asia/Shanghai")).date().isoformat()


# check_plan、pick、PLAN_SCHEMA、SELECTION_SCHEMA：约 40 行校验代码，
# 从现有 steps 原样搬过来。

PROGRAM_ENTRIES = [llm_knowledge_research]
```

### 每次模型调用看到什么

以任务"LLM 里的 memory layers，不要 RAG"为例，`select_papers` 那次调用：

| 部分 | 内容 |
|---|---|
| Instructions | "You choose papers by reading their titles and abstracts. …" |
| Docstring | "Compare the actual titles and abstracts with the task. …" |
| 内容块 | `task`、`themes`、`call path: llm_knowledge_research → select_papers`、`candidates` |
| 历史 | 无 |
| Prompt | "Return the IDs of relevant candidates, most relevant first." |

selector 看不到 planner 的 prompt 和回复。第二次 `plan_queries` 用的是 `history="thread"` 的 `plan_ctx`，所以能看到第一次的规划和 `decide_to_broaden` 的选择。它自己的 docstring 也会再次带上，因为每次调用都会带上发起调用的那个函数的 docstring。

### `tests/test_workflow.py`

```python
from openprogram.testing import script_roles

from llm_knowledge_research import workflow as wf

PAPER = {"id": "p1", "theme": "Memory architecture", "title": "Memory Layers at Scale",
         "url": "https://arxiv.org/abs/2412.09764", "abstract": "...", "published": "2025-01-02"}


def test_selector_sees_rules_and_candidates_only(monkeypatch, tmp_path):
    monkeypatch.setattr(wf, "search_arxiv", lambda plan: [PAPER])
    monkeypatch.setattr(wf, "save_report", lambda text: tmp_path / "report.md")
    with script_roles({
        wf.planner: [{"queries": [{"theme": "Memory architecture", "query": "memory layers"}]}],
        wf.selector: [{"ids": ["p1"]}],
    }) as calls:
        result = wf.llm_knowledge_research("memory layers in LLMs, no RAG")

    request = calls[wf.selector][0]
    assert "A keyword match or" in request.text           # select_papers 的 docstring
    assert "Memory Layers at Scale" in request.text       # candidates 内容块
    assert "Plan at most" not in request.text             # planner 的 prompt 不会出现
    assert result.startswith("Saved 1 papers")


def test_empty_selection_broadens_once(monkeypatch, tmp_path):
    monkeypatch.setattr(wf, "search_arxiv", lambda plan: [PAPER])
    monkeypatch.setattr(wf, "save_report", lambda text: tmp_path / "report.md")
    plan = {"queries": [{"theme": "Memory architecture", "query": "memory"}]}
    with script_roles({
        wf.planner: [plan, "broaden", plan],
        wf.selector: [{"ids": []}, {"ids": ["p1"]}],
    }) as calls:
        wf.llm_knowledge_research("memory layers")

    second_plan = calls[wf.planner][2]
    assert "Make the queries broader" in second_plan.text
    assert "broaden" in second_plan.history_text          # thread 历史里带着上一次的选择
```

### 预计规模和表现

| 项目 | 预计 |
|---|---|
| 代码量 | `workflow.py` 约 150 行，`report.py` 约 80 行（现有渲染代码），测试约 60 行；现在是五个文件 399 行，外加 Agent 子类 |
| 每次运行的模型调用 | 正常 2 次（规划、筛选）；第一次筛选为空时最多 5 次（规划、筛选、选择、规划、筛选） |
| 会话图 | 一个 `llm_knowledge_research` 节点，下面 2 到 5 个角色调用子节点；`search_arxiv`、`check_plan`、`pick` 不出现 |
| 聊天里 | agent 调用工具 `llm_knowledge_research(task, max_queries)`；工具卡片展开后是各次角色调用，每次都能看到实际发出的请求 |
| 修改行为 | 在 `workflow.py` 里改 docstring、角色 instructions 或内容块；`check` 跑测试并提交 |

## 删除的内容

- 工具 `search_workflows`、`create_workflow`、`revise_workflow`、`auto_workflow`、`resume_workflow`。
- `programs/workflow/_generation`、`_project/validation.py` 里的顶层白名单、`_runtime/state.py` 里的包快照 checkpoint。
- 旧的单文件 workflow 格式，以及 `program-sources.json` 里的 workflow 信任记录。
- `auto_workflow` 的界面。
- `_situational_prefix` 生成的 `<situation>` 前缀。

保留的内容：Codex 401 时强制刷新 token、`programs run -p/-m`、字符串工具名的解析。

## 迁移

- 用户的 `weekly_report` 系列和 `llm_knowledge_research` 以这种形式放在 `~/.openprogram/workflows/`；共享的周报辅助代码留在 `openprogram.programs.workflow._reports`。
- 所有内置 workflow 都使用这种形式：模块顶层角色、显式 `Context`、普通函数和 `PROGRAM_ENTRIES`。
- 产品文档描述这种形式。

## 阶段

1. 角色调用：docstring 注入、四种历史设置、`call_path` 和 `workflow_source`、角色节点挂在入口节点下、删除 `<situation>`。
2. 加载与存储：`~/.openprogram/workflows`、check 通过后 Git 提交、watcher、Programs 页面显示错误。
3. 编写：编写文档、测试辅助函数、`workflows check`，然后删除旧工具和旧代码。
4. 迁移用户的 workflow 和内置 workflow，更新产品文档。

## 实现状态

| 项目 | 状态 |
|---|---|
| 角色调用：请求组成、docstring 查找、四种历史设置、`call_path`、`workflow_source`、去掉 `<situation>` | 已实现 |
| 记录：入口节点加角色调用子节点；普通函数不记录 | 已实现 |
| `~/.openprogram/workflows` 加载、只加载干净提交、watcher 重载、Programs 页面显示加载状态 | 已实现 |
| `script_roles`、`workflows check`、`workflows list` | 已实现 |
| 删除旧的编写工具、代码和界面 | 已实现 |
| 用户 workflow 和内置 workflow 改为这种形式 | 已实现 |
| Codex 401 刷新、`programs run -p/-m`、工具名解析 | 已实现 |
| 示例的单文件布局和「放宽一次」步骤 | 已设计，未实现：迁移后的 `llm_knowledge_research` 保留 `steps/` 模块，角色同为 `planner` 和 `selector`，不做放宽 |
| workflow 入口重启后恢复执行 | 已设计，未实现 |
