"""Explicitly install fixed-parameter Agent class configurations."""
from . import manager


_BUILTINS = (
    {
        "id": "image", "name": "Image creator", "name_zh": "绘图助手",
        "description": "Generate images from a brief and return the saved results.",
        "description_zh": "根据要求生成图片，返回实际保存的结果。",
        "tools": {"mode": "selected", "allowed": ["image_generate"], "web_search": False},
    },
    {
        "id": "decision", "name": "Decision advisor", "name_zh": "决策顾问",
        "description": "Compare options against explicit criteria and explain a recommendation.",
        "description_zh": "根据明确标准比较选项，给出建议及依据。",
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
