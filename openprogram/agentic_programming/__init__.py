"""Agent configuration, task-local Context, and shared execution primitives.

Agent methods create call scopes automatically. Context supplies named content
and history visibility. Runtime uses the existing providers and Session DAG.
"""

from openprogram.agentic_programming.call_state import (
    traced, auto_trace_module, auto_trace_package,
)
from openprogram.agentic_programming.runtime import Runtime
from openprogram.agentic_programming.llm import llm
from openprogram.agentic_programming.agent import agent, agent_async
from openprogram.agentic_programming.agent_class import Agent
from openprogram.context import Context
from openprogram.agentic_programming import decision
from openprogram.agentic_programming.session import Session
from openprogram.agentic_programming.control_flow import (
    validate_and_retry, route, conditional
)

__all__ = [
    "traced",
    "auto_trace_module",
    "auto_trace_package",
    "Runtime",
    "LLMError",
    "StructuredOutputError",
    "llm",
    "agent",
    "agent_async",
    "Agent",
    "Context",
    "decision",
    "Session",
    "validate_and_retry",
    "route",
    "conditional",
]


def __getattr__(name):
    # Keep provider initialization out of the core module import cycle.
    if name == "LLMError":
        from openprogram.providers.utils.errors import LLMError
        return LLMError
    if name == "StructuredOutputError":
        from openprogram.providers.structured_output import StructuredOutputError
        return StructuredOutputError
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
