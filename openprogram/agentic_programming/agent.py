"""Agent: tool loop = repeatedly call llm + execute tools until done."""
from __future__ import annotations

from typing import Any
from contextlib import ExitStack, contextmanager

from openprogram.providers.structured_output import JsonSchemaOutput


def agent(
    prompt: str | list[dict],
    *,
    model: str | None = None,
    effort: str | None = None,
    tools: list[Any] | None = None,
    tools_deny: list[str] | None = None,
    response_format: dict[str, Any] | JsonSchemaOutput | None = None,
    max_iterations: int | None = None,
    timeout_s: float | None = None,
    tool_choice: Any = None,
    parallel_tool_calls: bool | None = None,
    execution_kind: str = "agent",
    runtime=None,
    return_raw: bool = False,
    toolset: str | None = None,
    tools_allow: list[str] | None = None,
    instructions: str | None = None,
    context=None,
    tools_source: str | None = None,
    on_retry=None,
    web_search: bool | None = None,
    stream_fn=None,
) -> Any:
    """Run a tool loop: model calls tools, sees results, continues until done.

    Args:
        prompt: Initial prompt (string or content blocks)
        model: Model override (empty = use session default)
        effort: Reasoning effort override
        tools: Tool names to provide (None = all available tools)
        response_format: JSON Schema or JsonSchemaOutput contract (None = return text)
        tools_deny: Tool names that must remain unavailable for this turn
        execution_kind: Runtime execution label for this tool loop
        max_iterations: Max tool loop rounds
        timeout_s: Timeout in seconds

    Returns:
        Final text, or the validated JSON value when response_format is set
    """
    from openprogram.agentic_programming.runtime_scope import execution_scope

    with _entry_context(instructions, context), execution_scope(runtime=runtime) as active:
        return _execute_agent(active, prompt, model=model, effort=effort, tools=tools,
            tools_deny=tools_deny, response_format=response_format,
            max_iterations=max_iterations, timeout_s=timeout_s,
            tool_choice=tool_choice, parallel_tool_calls=parallel_tool_calls,
            execution_kind=execution_kind, return_raw=return_raw, toolset=toolset, tools_allow=tools_allow,
            tools_source=tools_source, on_retry=on_retry, web_search=web_search, stream_fn=stream_fn)


def _execute_agent(runtime, prompt, **options):
    model = options.pop("model")
    effort = options.pop("effort")
    from openprogram.agentic_programming.runtime.shared import _current_agent_options
    response_format = options.pop("response_format")
    if response_format is None:
        response_format = _current_agent_options.get().get("response_format")
    return_raw = options.pop("return_raw")
    if isinstance(prompt, str):
        content = [{"type": "text", "text": prompt}]
    elif isinstance(prompt, list):
        content = prompt
    else:
        raise TypeError("agent() prompt must be a string or a list of content blocks")

    exec_options = dict(options, content=content, model=model, effort=effort)
    if response_format is not None:
        exec_options["response_format"] = response_format
    required = {"content", "model", "tools", "max_iterations", "timeout_s", "effort", "execution_kind"}
    defaults = _current_agent_options.get()
    for key in ("model", "tools", "max_iterations", "effort"):
        if exec_options.get(key) is None:
            exec_options[key] = defaults.get(key)
    if exec_options.get("max_iterations") is None:
        exec_options["max_iterations"] = 20
    exec_options = {key: value for key, value in exec_options.items() if value is not None or key in required}
    result = runtime.exec(**exec_options)

    if response_format is not None:
        return result
    if return_raw:
        return result

    # Preserve the legacy text result contract for unstructured calls.
    if isinstance(result, dict) and "text" in result:
        return result["text"]
    return str(result)


async def agent_async(prompt: str | list[dict], **options) -> Any:
    """Run the agent tool loop asynchronously with the same options as agent()."""
    from openprogram.agentic_programming.runtime_scope import execution_scope
    runtime = options.pop("runtime", None)
    instructions = options.pop("instructions", None)
    context = options.pop("context", None)
    from openprogram.agentic_programming.runtime.shared import _current_agent_options
    response_format = options.get("response_format")
    if response_format is None:
        response_format = _current_agent_options.get().get("response_format")
    return_raw = options.pop("return_raw", False)
    content = [{"type": "text", "text": prompt}] if isinstance(prompt, str) else prompt
    if not isinstance(content, list):
        raise TypeError("agent_async() prompt must be a string or a list of content blocks")
    with _entry_context(instructions, context), execution_scope(runtime=runtime) as active:
        result = await active.async_exec(content=content, **options)
    if response_format is not None or return_raw:
        return result
    return result["text"] if isinstance(result, dict) and "text" in result else str(result)


@contextmanager
def _entry_context(instructions, context):
    from openprogram.context import Context
    from openprogram.agentic_programming.runtime.shared import _current_instructions
    with ExitStack() as stack:
        if context is not None:
            if not isinstance(context, Context):
                raise TypeError("Agent context must be a Context or None.")
            ambient = Context.current()
            stack.enter_context((ambient.merge(context) if ambient is not None else context.derive()).bind())
        if instructions is not None:
            token = _current_instructions.set(instructions)
            stack.callback(_current_instructions.reset, token)
        yield


__all__ = ["agent", "agent_async"]
