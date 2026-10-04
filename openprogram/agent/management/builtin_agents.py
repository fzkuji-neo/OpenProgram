"""Explicitly install fixed-parameter Agent class configurations."""
from . import manager


_BUILTINS = (
    {
        "id": "decision", "name": "Decision", "name_zh": "决策",
        "description": "Select one option from the supplied choices in a single model call.",
        "description_zh": "一次调用模型，从给定选项中选择一项。",
        "tools": {"mode": "none", "web_search": False},
    },
    {
        "id": "utility", "name": "Lightweight helper", "name_zh": "轻量助手",
        "description": "Handle extraction, classification, formatting, short summaries and next-message candidates.",
        "description_zh": "处理提取、分类、格式转换、短摘要和候选下一句预测。",
        "tools": {"mode": "none", "web_search": False},
    },
    {
        "id": "planner", "name": "Coordinator", "name_zh": "统筹规划",
        "description": "Plan dependent work, delegate bounded tasks and verify the combined result.",
        "description_zh": "规划任务依赖、委派明确的子任务，并核对整体结果。",
        "tools": {"mode": "selected", "allowed": ["read", "glob", "grep", "list", "web_search", "agent", "list_agents", "send_message", "job_output"], "web_search": True},
    },
)



def create_builtin_agents(*, model_refs: dict[str, manager.AgentModelRef] | None = None,
                          language: str = "en") -> list[manager.AgentSpec]:
    """Create missing specialist Agents; preserve existing records and defaults.

    This is an explicit installation operation. Registry reads never call it.
    Model references are caller choices, not automatic price-based routing.
    """
    if language not in {"en", "zh"}:
        raise ValueError("language must be en or zh")
    refs = model_refs or {}
    rows = []
    with manager.configuration_lock():
        for definition in _BUILTINS:
            agent_id = definition["id"]
            saved = manager.get(agent_id)
            if saved is None:
                model = refs.get(agent_id, manager.AgentModelRef())
                manager.create(agent_id, name=definition["name_zh" if language == "zh" else "name"],
                               provider=model.provider, model_id=model.id, thinking_effort="")
                saved = manager.update(agent_id, {
                    "description": definition["description_zh" if language == "zh" else "description"],
                    "tools": definition["tools"],
                    "skills": {"allowed": [], "disabled": ["*"], "categories": []},
                    "mcp": {"allowed": [], "disabled": ["*"], "required": []},
                    "memory": {"mode": "off", "read_spaces": ["self"], "write_space": "self", "required": False},
                }, replace_tool_policy=True)
            rows.append(saved)
    return rows
