"""Synchronous memory-writer adapter over OpenProgram's normal Agent."""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any

from openprogram.agent.session import AgentSession
from openprogram.agent.types import AgentTool, AgentToolResult
from openprogram.providers.types import (
    AssistantMessage,
    Model,
    TextContent,
    ToolCall,
    ToolResultMessage,
)

from .claude_code import AgentExecutionError, AgentResult


def _default_model(override: str | None) -> Model:
    from openprogram.agent.internals._model_tools import (
        load_agent_profile,
        resolve_model,
    )
    from openprogram.agent.management import manager
    from openprogram.providers.background_llm import background_model

    spec = manager.get_default()
    profile = load_agent_profile(spec.id if spec is not None else "main")
    own = profile.get("model")
    if isinstance(own, dict):
        own = own.get("id") or own.get("model")
    if not override and not own:
        # No model of the Agent's own: write on the last used model.
        pair = background_model()
        override = f"{pair[0]}/{pair[1]}" if pair else None
    return resolve_model(profile, override)


_JSON_TYPES = {
    "string": str,
    "boolean": bool,
    "array": list,
    "object": dict,
    "integer": int,
    "number": (int, float),
}
_FENCED = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


def _schema_instruction(schema: dict[str, Any]) -> str:
    return (
        "Reply with exactly one JSON object and nothing else: no prose, "
        "no code fence. It must match this JSON Schema:\n"
        + json.dumps(schema, ensure_ascii=False)
    )


def _structured(text: str, schema: dict[str, Any]) -> dict[str, Any] | None:
    """The JSON object a reply carries, if it matches the schema's shape.

    The model is asked for bare JSON, but a fenced block or a sentence
    around the object is common enough to accept. A reply that does not
    parse, or misses a required field, is None; the caller asks again.
    """
    candidates = [text.strip()]
    candidates += _FENCED.findall(text)
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        candidates.append(text[start:end + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, dict) and _matches(value, schema):
            return value
    return None


def _matches(value: dict[str, Any], schema: dict[str, Any]) -> bool:
    properties = schema.get("properties") or {}
    for key in schema.get("required") or ():
        if key not in value:
            return False
    for key, spec in properties.items():
        if key not in value or not isinstance(spec, dict):
            continue
        expected = _JSON_TYPES.get(str(spec.get("type")))
        if expected is None:
            continue
        item = value[key]
        if expected is not bool and isinstance(item, bool):
            return False
        if not isinstance(item, expected):
            return False
    return True


def _native_tool(definition: Any) -> AgentTool:
    """Adapt the existing managed MCP tool without duplicating its policy."""

    async def execute(call_id, arguments, cancel, on_update):
        result = await definition.handler(arguments)
        blocks = result.get("content") or []
        text = "\n".join(
            str(block.get("text") or "")
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
        if result.get("is_error"):
            raise RuntimeError(text or f"{definition.name} failed")
        return AgentToolResult(content=[TextContent(text=text or "(no output)")])

    return AgentTool(
        name=definition.name,
        description=definition.description,
        parameters=definition.input_schema,
        label=definition.name,
        execute=execute,
    )


def _turn_records(messages: list[Any]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for message in messages:
        if isinstance(message, AssistantMessage):
            records.extend({
                "tool": block.name,
                "arguments": {
                    key: str(value)[:200]
                    for key, value in block.arguments.items()
                },
            } for block in message.content if isinstance(block, ToolCall))
        elif isinstance(message, ToolResultMessage):
            text = "\n".join(
                block.text for block in message.content
                if isinstance(block, TextContent)
            )
            records.append({"result": text[:300], "is_error": message.is_error})
    return records


class OpenProgramAgent:
    """Run a detached AgentSession on the default Agent's model, else the last used one."""

    def __init__(
        self,
        model: str | None = None,
        *,
        stream_fn: Any | None = None,
    ) -> None:
        self.model = _default_model(model)
        self._stream_fn = stream_fn

    def run(
        self,
        *,
        prompt: str,
        system_prompt: str,
        cwd: str | Path,
        tools: list[Any] | None = None,
        max_turns: int = 20,
        max_budget_usd: float | None = None,
        output_schema: dict[str, Any] | None = None,
    ) -> AgentResult:
        if max_turns < 1:
            raise ValueError("max_turns must be positive")
        if max_budget_usd is not None:
            raise ValueError(
                "max_budget_usd is not supported by the OpenProgram writer"
            )
        if output_schema is not None:
            system_prompt = f"{system_prompt}\n\n{_schema_instruction(output_schema)}"
        resolved_cwd = Path(cwd).resolve()
        if not resolved_cwd.is_dir():
            raise ValueError(f"agent working directory does not exist: {resolved_cwd}")

        started = time.monotonic()
        session = AgentSession(
            self.model,
            tools=[_native_tool(tool) for tool in tools or []],
            system_prompt=system_prompt,
            thinking_level="off",
            max_iterations=max_turns,
            stream_fn=self._stream_fn,
        )
        try:
            final = asyncio.run(session.run(prompt))
            messages = session.messages
        finally:
            session.close()

        turns = _turn_records(messages)
        if final is None:
            raise AgentExecutionError(
                "OpenProgram Agent ended without an assistant result",
                turns, system_prompt=system_prompt, prompt=prompt,
            )
        if final.stop_reason == "error":
            raise AgentExecutionError(
                final.error_message or "OpenProgram Agent failed",
                turns,
                system_prompt=system_prompt,
                prompt=prompt,
                retryable=final.error_retryable,
                reason=final.error_reason,
            )

        assistants = [
            message for message in messages
            if isinstance(message, AssistantMessage)
        ]
        text = "\n".join(
            block.text for block in final.content
            if isinstance(block, TextContent)
        ).strip()
        input_tokens = sum(message.usage.input for message in assistants)
        output_tokens = sum(message.usage.output for message in assistants)
        cache_creation = sum(message.usage.cache_write for message in assistants)
        cache_read = sum(message.usage.cache_read for message in assistants)
        cost = sum(message.usage.cost.total for message in assistants)
        duration_ms = int((time.monotonic() - started) * 1000)
        return AgentResult(
            text=text,
            structured_output=(
                _structured(text, output_schema)
                if output_schema is not None else None
            ),
            num_turns=len(assistants),
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_creation_input_tokens=cache_creation,
            cache_read_input_tokens=cache_read,
            anthropic_equivalent_cost_usd=cost or None,
            duration_ms=duration_ms,
            duration_api_ms=duration_ms,
            stop_reason=final.stop_reason,
            session_id="memory-writer",
            turns=turns,
            system_prompt=system_prompt,
            prompt=prompt,
            reply=text,
        )
