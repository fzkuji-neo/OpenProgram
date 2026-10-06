"""Compatibility imports for the shared Agent turn runtime.

Each legacy module name refers to the same module object as the canonical
runtime, preserving existing integrations without duplicate state or logic.
"""
from importlib import import_module
import sys

_runtime = import_module("openprogram.agent.turn_runtime")
for _name in ('error_path', 'finalize', 'forced_tool', 'loop_runner', 'persistence', 'prep', 'runtime_attach', 'stop_hook', 'stream_tap', 'titles', 'turn_context', 'turn_writer', 'types'):
    sys.modules[f"{__name__}.{_name}"] = import_module(f"openprogram.agent.turn_runtime.{_name}")
sys.modules[__name__] = _runtime
