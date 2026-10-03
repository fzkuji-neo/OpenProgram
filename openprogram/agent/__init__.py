"""
openprogram.agent — Agent algorithms (originally ported from pi-agent and
the algorithmic core of pi-coding-agent).

Organized by concern:

* ``types``        — Agent event/state/tool type definitions
* ``agent_loop``   — Stateless agent loop function
* ``agent``        — Stateful ``Agent`` wrapping ``agent_loop``
* ``session``      — Lightweight ``AgentSession`` with auto-retry
* ``retry``        — Standalone retry-classification and backoff helpers
* ``messages``     — Custom message types (branch/compaction summaries, etc.)
* ``exec``         — Subprocess execution utility with timeout/cancellation
* ``compaction/``  — Token estimation, cut-point detection, LLM summarization

The Runtime layer composes these to build whatever agent behavior is needed.
"""

from .agent import Agent, AgentOptions
from .agent_loop import agent_loop, agent_loop_continue, agent_loop_resume
from .exec import ExecOptions, ExecResult, exec_command
from .messages import (
    BRANCH_SUMMARY_PREFIX,
    BRANCH_SUMMARY_SUFFIX,
    BashExecutionMessage,
    BranchSummaryMessage,
    COMPACTION_SUMMARY_PREFIX,
    COMPACTION_SUMMARY_SUFFIX,
    CompactionSummaryMessage,
    CustomMessage,
    bash_execution_to_text,
    convert_to_llm,
    create_branch_summary_message,
    create_compaction_summary_message,
    create_custom_message,
    wrap_convert_to_llm,
)
from .retry import (
    DEFAULT_RETRY_SETTINGS,
    RetrySettings,
    compute_backoff_ms,
    is_retryable_error,
)
from .session import AgentSession
from .types import (
    AgentContext,
    AgentEvent,
    AgentEventAgentEnd,
    AgentEventAgentStart,
    AgentEventMessageEnd,
    AgentEventMessageStart,
    AgentEventMessageUpdate,
    AgentEventToolEnd,
    AgentEventToolStart,
    AgentEventToolUpdate,
    AgentEventTurnEnd,
    AgentEventTurnStart,
    AgentLoopConfig,
    AgentMessage,
    AgentState,
    AgentTool,
    AgentToolResult,
    AgentToolUpdateCallback,
    CustomAgentMessages,
    StreamFn,
    ThinkingLevel,
)

__all__ = [
    # Agent class
    "Agent",
    "AgentOptions",
    # Loop functions
    "agent_loop",
    "agent_loop_continue",
    "agent_loop_resume",
    # Session
    "AgentSession",
    # Retry
    "DEFAULT_RETRY_SETTINGS",
    "RetrySettings",
    "compute_backoff_ms",
    "is_retryable_error",
    # Event bus
    # Exec
    "ExecOptions",
    "ExecResult",
    "exec_command",
    # Message types
    "BashExecutionMessage",
    "BranchSummaryMessage",
    "CompactionSummaryMessage",
    "CustomMessage",
    "BRANCH_SUMMARY_PREFIX",
    "BRANCH_SUMMARY_SUFFIX",
    "COMPACTION_SUMMARY_PREFIX",
    "COMPACTION_SUMMARY_SUFFIX",
    "bash_execution_to_text",
    "convert_to_llm",
    "create_branch_summary_message",
    "create_compaction_summary_message",
    "create_custom_message",
    "wrap_convert_to_llm",
    # Types
    "AgentContext",
    "AgentEvent",
    "AgentEventAgentEnd",
    "AgentEventAgentStart",
    "AgentEventMessageEnd",
    "AgentEventMessageStart",
    "AgentEventMessageUpdate",
    "AgentEventToolEnd",
    "AgentEventToolStart",
    "AgentEventToolUpdate",
    "AgentEventTurnEnd",
    "AgentEventTurnStart",
    "AgentLoopConfig",
    "AgentMessage",
    "AgentState",
    "AgentTool",
    "AgentToolResult",
    "AgentToolUpdateCallback",
    "CustomAgentMessages",
    "StreamFn",
    "ThinkingLevel",
]


# The public entry and this existing package have the same import name. Keep
# the package object so imports such as openprogram.agent.types retain Python
# package semantics, and forward calls to the agent programming entry.
import sys as _sys
from types import ModuleType as _ModuleType


class _CallableAgentPackage(_ModuleType):
    def __call__(self, prompt, **options):
        from openprogram.agentic_programming.agent import agent
        return agent(prompt, **options)

    @property
    def __signature__(self):
        import inspect
        from openprogram.agentic_programming.agent import agent
        return inspect.signature(agent)


_sys.modules[__name__].__class__ = _CallableAgentPackage
