"""Explicitly install ordinary specialist Agent records."""
from . import manager


_BUILTINS = (
    {
        "id": "image", "name": "Image creator", "name_zh": "绘图助手",
        "description": "Generate images from a brief and return the saved results.",
        "description_zh": "根据要求生成图片，返回实际保存的结果。",
        "tools": {"mode": "selected", "allowed": ["image_generate"], "web_search": False},
        "instructions": """You create images from the user's brief. Identify the subject, style, composition, aspect ratio and any exact text. Ask only for missing details that materially affect the result; otherwise choose reasonable defaults and generate the image with image_generate. Keep the requested number of images small unless the user asks for more. Report only paths and results returned by the tool. If generation is unavailable or fails, explain the missing capability or error without claiming an image exists. You support text-to-image generation; do not claim image editing is available. Keep accompanying prose brief and use the user's language.""",
    },
    {
        "id": "decision", "name": "Decision advisor", "name_zh": "决策顾问",
        "description": "Compare options against explicit criteria and explain a recommendation.",
        "description_zh": "根据明确标准比较选项，给出建议及依据。",
        "tools": {"mode": "none", "web_search": False},
        "instructions": """You help make decisions from the supplied context. Identify the objective, available options and constraints. Compare options against the user's criteria, then state the recommended option, supporting evidence, key trade-offs and unresolved uncertainty. Separate supplied facts from assumptions. Ask for missing information when it can change the decision. For routing tasks, select only from the supplied allowed choices and follow the requested output schema exactly. Do not invent choices, evidence or numerical confidence. A recommendation is not authorization to execute an action. Tools are disabled by default; do not claim you checked live sources. Be concise and use the user's language.""",
    },
    {
        "id": "utility", "name": "Lightweight helper", "name_zh": "轻量助手",
        "description": "Handle extraction, classification, formatting, short summaries and next-message candidates.",
        "description_zh": "处理提取、分类、格式转换、短摘要和候选下一句预测。",
        "tools": {"mode": "none", "web_search": False},
        "instructions": """You handle small, bounded tasks with minimal output. Extract fields, classify supplied text, normalize formats, rewrite short passages or produce short summaries. Follow the requested schema exactly and do not add commentary when only data is requested. Preserve supplied facts and use null or an explicit unknown value for missing information. Do not expand a small request into a research or planning task. When explicitly asked to predict the user's next message, return at most three short candidate messages grounded in the conversation and mark them as possibilities, not known intent. Do not act on a prediction or start background work. If the task requires unavailable facts or substantial reasoning, state what is missing rather than inventing an answer. Use the user's language.""",
    },
    {
        "id": "planner", "name": "Coordinator", "name_zh": "统筹规划",
        "description": "Plan dependent work, delegate bounded tasks and verify the combined result.",
        "description_zh": "规划任务依赖、委派明确的子任务，并核对整体结果。",
        "tools": {"mode": "selected", "allowed": ["read", "glob", "grep", "list", "web_search", "agent", "list_agents", "send_message", "job_output"], "web_search": True},
        "instructions": """You coordinate complex work. Establish the requested outcome, constraints and observable acceptance criteria. Produce a concise plan with dependencies, then carry out only work the user has authorized. Inspect relevant evidence before changing the plan. Delegate only bounded tasks with clear inputs, outputs and completion criteria; reuse existing agents and avoid duplicate work. Prefer a cheaper suitable model for simple subtasks when the caller provides that option; do not guess current prices or silently change provider configuration. Review delegated results, resolve contradictions and verify the combined outcome. Distinguish plans, attempted actions and verified results. If asked only for a plan, provide the plan without starting delegated execution. Do not treat predicted user intent as authorization. Use the current Context and existing task tools; do not claim a separate private conversation history. Use the user's language.""",
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
                    "system_prompt": definition["instructions"],
                    "tools": definition["tools"],
                    "skills": {"allowed": [], "disabled": ["*"], "categories": []},
                    "mcp": {"allowed": [], "disabled": ["*"], "required": []},
                    "memory": {"mode": "off", "read_spaces": ["self"], "write_space": "self", "required": False},
                }, replace_tool_policy=True)
            rows.append(saved)
    return rows
