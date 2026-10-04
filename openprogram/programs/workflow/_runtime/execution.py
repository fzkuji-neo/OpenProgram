"""Execute legacy single-file and package workflows, including resume."""

from __future__ import annotations

import importlib
import inspect
import json
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Callable, Optional

from openprogram.agentic_programming.call_state import CancelledError
from openprogram.agentic_programming.continuation import FunctionSuspended
from openprogram.store.session.git_session import atomic_write_text

from ..errors import InvalidWorkflow, WorkflowExecutionCapped
from .._generation import planner
from .._generation import prompts
from .._project import catalog
from .._project import repository
from .._project import validation
from . import bindings
from . import state as run_state

# ponytail: one process-wide lock; replace with per-run file locks if parallel
# workflow execution becomes a measured requirement.
_WORKFLOW_LOCK = threading.RLock()


def _completed_result(result):
    if inspect.isawaitable(result):
        from openprogram.agentic_programming.runtime.shared import _run_async
        return _run_async(result)
    return result


def _execute_source(
    source: str,
    state: dict,
    state_path: Path,
    *,
    session_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> object:
    checkpoints = run_state._Checkpoints(state, state_path)
    checkpoints.begin_pass()

    safe_builtins = {
        "ArithmeticError": ArithmeticError,
        "AssertionError": AssertionError,
        "Exception": Exception,
        "KeyboardInterrupt": KeyboardInterrupt,
        "NameError": NameError,
        "RuntimeError": RuntimeError,
        "TypeError": TypeError,
        "ValueError": ValueError,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "range": range,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
    }
    namespace = {
        "__builtins__": safe_builtins,
        "llm": checkpoints.wrap("llm", bindings._llm_function()),
        "agent": checkpoints.wrap(
            "agent", bindings._agent_function(session_id, spawn_caller)
        ),
        "goal": checkpoints.wrap("goal", bindings._goal_function()),
        "validate_and_retry": bindings._validate_and_retry_function(),
        "route": checkpoints.wrap("route", bindings._route_function()),
        "conditional": bindings._conditional_function(),
        **{name: checkpoints.wrap(name, fn) for name, fn in functions.items()},
    }
    from openprogram.programs._source_loader import compile_managed_source, _CAPTURE_NAME
    from openprogram.agentic_programming.call_scope import managed_function
    namespace.update({_CAPTURE_NAME: managed_function, "__name__": "workflow_source"})
    exec(compile_managed_source(source, "code.py"), namespace, namespace)
    return _completed_result(namespace["workflow"]())


def _execute_legacy_snapshot(
    snapshot: Path,
    state: dict,
    state_path: Path,
    *,
    session_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> object:
    candidate = repository._read_candidate_directory(
        snapshot,
        state["project_metadata"],
    )
    manifest = repository._project_manifest(candidate)
    checkpoints = run_state._Checkpoints(state, state_path)
    checkpoints.begin_pass()
    safe_builtins = {
        "ArithmeticError": ArithmeticError,
        "AssertionError": AssertionError,
        "Exception": Exception,
        "KeyboardInterrupt": KeyboardInterrupt,
        "NameError": NameError,
        "RuntimeError": RuntimeError,
        "TypeError": TypeError,
        "ValueError": ValueError,
        "bool": bool,
        "dict": dict,
        "enumerate": enumerate,
        "float": float,
        "int": int,
        "len": len,
        "list": list,
        "max": max,
        "min": min,
        "range": range,
        "set": set,
        "sorted": sorted,
        "str": str,
        "sum": sum,
        "tuple": tuple,
        "zip": zip,
    }
    namespace = {
        "__builtins__": safe_builtins,
        "llm": checkpoints.wrap("llm", bindings._llm_function()),
        "agent": checkpoints.wrap(
            "agent", bindings._agent_function(session_id, spawn_caller)
        ),
        "goal": checkpoints.wrap("goal", bindings._goal_function()),
        "validate_and_retry": bindings._validate_and_retry_function(),
        "route": checkpoints.wrap("route", bindings._route_function()),
        "conditional": bindings._conditional_function(),
        **{name: checkpoints.wrap(name, fn) for name, fn in functions.items()},
    }
    from openprogram.programs._source_loader import compile_managed_source, _CAPTURE_NAME
    from openprogram.agentic_programming.call_scope import managed_function
    namespace.update({_CAPTURE_NAME: managed_function, "__name__": "workflow_snapshot"})
    for relative in manifest["files"]:
        source = candidate["files"][relative]
        exec(compile_managed_source(source, relative), namespace, namespace)
    workflow = namespace["workflow"]
    if not inspect.signature(workflow).parameters:
        return _completed_result(workflow())
    return _completed_result(workflow(state["task"]))


def _snapshot_packages(snapshot: Path) -> dict[str, dict]:
    root = snapshot / "workflows"
    packages = {}
    for path in sorted(root.iterdir()):
        if not path.is_dir() or path.is_symlink():
            continue
        name = catalog._safe_project_id(path.name)
        candidate = repository._read_repository_candidate(
            path,
            expected_project_id=name,
        )
        if candidate["project_metadata"].get("entrypoint") != name:
            raise InvalidWorkflow(f"workflow snapshot package does not expose {name}")
        packages[name] = candidate
    return packages


def _execute_package_snapshot(
    snapshot: Path,
    candidate: dict,
    state: dict,
    state_path: Path,
    *,
    functions: dict[str, Callable],
) -> object:
    entrypoint = candidate["project_metadata"]["entrypoint"]
    module_prefix = f"workflows.{entrypoint}"
    packages = _snapshot_packages(snapshot)
    if entrypoint not in packages:
        raise InvalidWorkflow(f"workflow snapshot is missing {entrypoint}")
    module_prefixes = tuple(f"workflows.{name}" for name in packages)

    def is_snapshot_module(name: str) -> bool:
        return any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in module_prefixes
        )

    checkpoints = run_state._Checkpoints(state, state_path)
    checkpoints.begin_pass()
    managed = {
        "llm": bindings._llm_function(),
        "agent": bindings._agent_loop_function(),
        "goal": bindings._goal_function(),
        "validate_and_retry": bindings._validate_and_retry_function(),
        "route": bindings._route_function(),
        "conditional": bindings._conditional_function(),
        **functions,
    }
    # Control-flow callbacks are Python functions, not checkpoint JSON values.
    # Their actual capability calls carry checkpoints independently.
    wrapped = {
        name: (function if name in {"validate_and_retry", "conditional"}
               else checkpoints.wrap(name, function))
        for name, function in managed.items()
    }
    replacements = {id(managed[name]): function for name, function in wrapped.items()}
    from openprogram.agentic_programming.agent import agent as package_agent
    from openprogram.agentic_programming.control_flow import (
        conditional as package_conditional,
        route as package_route,
        validate_and_retry as package_validate_and_retry,
    )
    from openprogram.programs.workflow.goal import goal as package_goal
    from openprogram.agentic_programming.llm import llm as package_llm

    replacements.update(
        {
            id(package_llm): wrapped["llm"],
            id(package_agent): wrapped["agent"],
            id(package_goal): wrapped["goal"],
            id(package_validate_and_retry): wrapped["validate_and_retry"],
            id(package_route): wrapped["route"],
            id(package_conditional): wrapped["conditional"],
        }
    )

    from openprogram.programs import _runtime as tool_runtime

    missing = object()
    prior_tools = dict(tool_runtime._registry)
    prior_toolsets = {name: set(groups) for name, groups in tool_runtime._toolset_membership.items()}
    prior_unsafe = {name: set(channels) for name, channels in tool_runtime._unsafe_in_channel.items()}
    prior_unexposed = set(tool_runtime._unexposed)
    prior_modules = {
        name: module for name, module in sys.modules.items() if is_snapshot_module(name)
    }
    prior_workflows = sys.modules.pop("workflows", missing)
    namespace_spec = importlib.machinery.ModuleSpec("workflows", loader=None, is_package=True)
    namespace_spec.submodule_search_locations = [str(snapshot / "workflows")]
    sys.modules["workflows"] = importlib.util.module_from_spec(namespace_spec)
    for name in prior_modules:
        sys.modules.pop(name, None)
    sys.path.insert(0, str(snapshot))
    previous_dont_write_bytecode = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    importlib.invalidate_caches()
    from openprogram.programs._source_loader import ManagedSourceFinder, register_public_entries
    source_finder = ManagedSourceFinder()
    for name in packages:
        source_finder.add(f"workflows.{name}", snapshot / "workflows" / name)
    sys.meta_path.insert(0, source_finder)
    try:
        package = importlib.import_module(module_prefix)
        loaded = [
            module for name, module in sys.modules.items() if is_snapshot_module(name)
        ]
        for module in loaded:
            for name, value in list(vars(module).items()):
                replacement = replacements.get(id(value))
                if replacement is not None:
                    setattr(module, name, replacement)
            for name, function in wrapped.items():
                vars(module).setdefault(name, function)
        register_public_entries(package, entrypoint)
        workflow = getattr(package, entrypoint, None)
        if not callable(workflow):
            raise InvalidWorkflow(f"workflow package must export callable {entrypoint}")
        return _completed_result(workflow(state["task"]))
    finally:
        sys.meta_path.remove(source_finder)
        sys.dont_write_bytecode = previous_dont_write_bytecode
        sys.path.remove(str(snapshot))
        for name in list(sys.modules):
            if is_snapshot_module(name):
                sys.modules.pop(name, None)
        sys.modules.update(prior_modules)
        sys.modules.pop("workflows", None)
        if prior_workflows is not missing:
            sys.modules["workflows"] = prior_workflows
        # Restore registrations created by these pinned package bytes only.
        # Dependencies outside the snapshot keep their own registry state.
        changed = {
            name for name, tool in tool_runtime._registry.items()
            if is_snapshot_module(getattr(tool, "_source_module", ""))
        } | set(packages)
        for name in changed:
            if name in prior_tools:
                tool_runtime._registry[name] = prior_tools[name]
            else:
                tool_runtime._registry.pop(name, None)
            for live, prior in ((tool_runtime._toolset_membership, prior_toolsets),
                                (tool_runtime._unsafe_in_channel, prior_unsafe)):
                if name in prior:
                    live[name] = prior[name]
                else:
                    live.pop(name, None)
            if name in prior_unexposed:
                tool_runtime._unexposed.add(name)
            else:
                tool_runtime._unexposed.discard(name)
        importlib.invalidate_caches()


def _execute_snapshot(
    snapshot: Path,
    state: dict,
    state_path: Path,
    *,
    session_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> object:
    candidate = repository._read_candidate_directory(
        snapshot,
        state["project_metadata"],
    )
    if candidate["project_metadata"].get("entrypoint"):
        return _execute_package_snapshot(
            snapshot,
            candidate,
            state,
            state_path,
            functions=functions,
        )
    return _execute_legacy_snapshot(
        snapshot,
        state,
        state_path,
        session_id=session_id,
        spawn_caller=spawn_caller,
        functions=functions,
    )


def _persist_revision(
    instance: Path, state: dict, old: str, new: str, error: str
) -> None:
    disk_versions = [
        int(path.stem.split(".")[1])
        for path in instance.glob("code.*.py")
        if path.stem.split(".")[-1].isdigit()
    ]
    version = max([len(state["revisions"]), *disk_versions], default=0) + 1
    atomic_write_text(instance / f"code.{version}.py", old)
    atomic_write_text(instance / "code.py", new)
    state["revisions"].append(
        {
            "version": version,
            "at": time.time(),
            "error": error,
        }
    )


def _run_instance(
    instance: Path,
    state: dict,
    source: str,
    *,
    run_id: str,
    session_id: str,
    agent_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> dict:
    with _WORKFLOW_LOCK:
        state = run_state._load_state(instance / "state.json")
        source = (instance / "code.py").read_text(encoding="utf-8")
        return _run_instance_locked(
            instance,
            state,
            source,
            run_id=run_id,
            session_id=session_id,
            agent_id=agent_id,
            spawn_caller=spawn_caller,
            functions=functions,
        )


def _run_legacy_instance_locked(
    instance: Path,
    state: dict,
    source: str,
    *,
    run_id: str,
    session_id: str,
    agent_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> dict:
    state_path = instance / "state.json"
    try:
        result = _execute_source(
            source,
            state,
            state_path,
            functions=functions,
            session_id=session_id,
            spawn_caller=spawn_caller,
        )
    except WorkflowExecutionCapped:
        state["status"] = "capped"
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    except (KeyboardInterrupt, CancelledError, FunctionSuspended):
        raise
    except BaseException:
        state["last_error"] = traceback.format_exc()
        state["status"] = "failed"
        run_state._save_outcome(state_path, state)
        state["handoff"] = run_state._summarize_workflow(state)
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    if state.get("capped"):
        state["status"] = "capped"
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    state.update(
        status="completed", result=run_state._json_value(result), last_error=""
    )
    run_state._save_outcome(state_path, state)
    state["handoff"] = run_state._summarize_workflow(state)
    run_state._save_state(state_path, state)
    return run_state._result(state, run_id)


def _run_instance_locked(
    instance: Path,
    state: dict,
    source: str,
    *,
    run_id: str,
    session_id: str,
    agent_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> dict:
    state_path = instance / "state.json"
    while True:
        try:
            result = _execute_source(
                source,
                state,
                state_path,
                functions=functions,
                session_id=session_id,
                spawn_caller=spawn_caller,
            )
        except WorkflowExecutionCapped:
            state["status"] = "capped"
            run_state._save_state(state_path, state)
            return run_state._result(state, run_id)
        except (KeyboardInterrupt, CancelledError, FunctionSuspended):
            raise
        except BaseException:  # generated verification/errors all revise
            error = traceback.format_exc()
            state["last_error"] = error
            run_state._save_state(state_path, state)
            revised = planner._request_valid_source(
                state["task"],
                source,
                state,
                session_id=session_id,
                agent_id=agent_id,
                spawn_caller=spawn_caller,
                functions=functions,
            )
            _persist_revision(instance, state, source, revised, error)
            run_state._save_state(state_path, state)
            source = revised
            continue
        if state.get("capped"):
            state["status"] = "capped"
            run_state._save_state(state_path, state)
            return run_state._result(state, run_id)
        state.update(
            status="completed", result=run_state._json_value(result), last_error=""
        )
        run_state._save_outcome(state_path, state)
        state["handoff"] = run_state._summarize_workflow(state)
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)


def _save_project_ref(instance: Path, state: dict) -> None:
    atomic_write_text(
        instance / "project_ref.json",
        json.dumps(
            {
                "project_id": state.get("project_id", ""),
                "project_revision": state.get("project_revision", ""),
                "project_action": state.get("project_action", ""),
                "workflow_dependencies": state.get("workflow_dependencies", {}),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
    )


def _run_project_instance_locked(
    instance: Path,
    state: dict,
    *,
    run_id: str,
    session_id: str,
    agent_id: str,
    spawn_caller: Optional[str],
    functions: dict[str, Callable],
) -> dict:
    state_path = instance / "state.json"
    try:
        result = _execute_snapshot(
            instance / "snapshot",
            state,
            state_path,
            functions=functions,
            session_id=session_id,
            spawn_caller=spawn_caller,
        )
    except WorkflowExecutionCapped:
        state["status"] = "capped"
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    except (KeyboardInterrupt, CancelledError, FunctionSuspended) as exc:
        run_state._mark_run_exception(instance, state, exc)
        raise
    except BaseException:
        # A failed run keeps its original error and checkpoints; it never
        # re-authors the candidate or rewrites a published workflow.
        # Published changes go through the explicit revise entry.
        state["last_error"] = traceback.format_exc()
        state["status"] = "failed"
        run_state._save_outcome(state_path, state)
        state["handoff"] = run_state._summarize_workflow(state)
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    if state.get("capped"):
        state["status"] = "capped"
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)
    state.update(
        status="completed", result=run_state._json_value(result), last_error=""
    )
    run_state._save_outcome(state_path, state)
    state["handoff"] = run_state._summarize_workflow(state)
    run_state._save_state(state_path, state)
    return run_state._result(state, run_id)


def _run_single(
    instance: Path,
    *,
    run_id: str,
    session_id: str,
    agent_id: str,
    spawn_caller: Optional[str],
) -> dict:
    with _WORKFLOW_LOCK:
        state_path = instance / "state.json"
        state = run_state._load_state(state_path)
        state["status"] = "running"
        run_state._save_state(state_path, state)
        checkpoints = run_state._Checkpoints(state, state_path)
        checkpoints.begin_pass()

        task = state["task"] + "\n\n" + prompts.DELIVERY_INSTRUCTIONS
        result = checkpoints.wrap(
            "agent", bindings._agent_function(session_id, spawn_caller)
        )(task)
        state.update(status="completed", result=str(result), last_error="")
        run_state._save_outcome(state_path, state)
        state["handoff"] = run_state._summarize_workflow(state)
        run_state._save_state(state_path, state)
        return run_state._result(state, run_id)


def _execute_workflow(
    task: str,
    *,
    session_id: str,
    agent_id: str = "main",
    spawn_caller: Optional[str] = None,
    run_id: str,
) -> dict:
    """Resume one existing run from its original snapshot or legacy code."""
    instance = run_state._instance_dir(session_id, run_id)
    with _WORKFLOW_LOCK:
        state = run_state._load_state(instance / "state.json")
        if state.get("status") in {"completed", "cancelled", "capped"}:
            return run_state._result(state, run_id)
        functions = bindings._registered_program_entries()
        try:
            if (instance / "snapshot").exists():
                state["status"] = "running"
                run_state._save_state(instance / "state.json", state)
                return _run_project_instance_locked(
                    instance,
                    state,
                    run_id=run_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    spawn_caller=spawn_caller,
                    functions=functions,
                )
            code_path = instance / "code.py"
            if code_path.exists():
                source = code_path.read_text(encoding="utf-8")
                if source.strip() == "SINGLE":
                    return _run_single(
                        instance,
                        run_id=run_id,
                        session_id=session_id,
                        agent_id=agent_id,
                        spawn_caller=spawn_caller,
                    )
                planner._validate_source(source)
                state["status"] = "running"
                run_state._save_state(instance / "state.json", state)
                return _run_legacy_instance_locked(
                    instance,
                    state,
                    source,
                    run_id=run_id,
                    session_id=session_id,
                    agent_id=agent_id,
                    spawn_caller=spawn_caller,
                    functions=functions,
                )
            raise InvalidWorkflow(
                f"workflow run {run_id} has no snapshot or legacy code to resume"
            )
        except (KeyboardInterrupt, CancelledError, FunctionSuspended) as exc:
            run_state._mark_run_exception(instance, state, exc)
            raise
        except Exception as exc:
            run_state._mark_run_exception(instance, state, exc)
            raise


def _run_published_workflow(
    task: str,
    workflow_id: str,
    revision: str,
    *,
    session_id: str,
    spawn_caller: Optional[str],
    run_id: Optional[str] = None,
    project_action: str = "reuse",
) -> dict:
    """Execute one published workflow at a pinned revision. Never publishes."""
    functions = bindings._registered_program_entries()
    if run_id is None:
        run_id = run_state._new_run_id()
        instance = run_state._instance_dir(session_id, run_id)
        instance.mkdir(parents=True, exist_ok=False)
        state = {
            "run_id": run_id,
            "task": task,
            "status": "running",
            "executions": 0,
            "items": [],
            "revisions": [],
            "result": "",
            "last_error": "",
        }
        run_state._save_state(instance / "state.json", state)
    else:
        instance = run_state._instance_dir(session_id, run_id)
        state = run_state._load_state(instance / "state.json")
        state["status"] = "running"
        run_state._save_state(instance / "state.json", state)
    try:
        index, candidate = repository._copy_pinned_snapshot(
            instance, workflow_id, revision
        )
        state.update(
            project_id=workflow_id,
            project_revision=revision,
            workflow_dependencies=index["workflow_dependencies"],
            project_action=project_action,
            project_metadata=candidate["project_metadata"],
            publish_required=False,
        )
        _save_project_ref(instance, state)
        run_state._save_state(instance / "state.json", state)
    except BaseException as exc:
        run_state._mark_run_exception(instance, state, exc)
        raise
    with _WORKFLOW_LOCK:
        state = run_state._load_state(instance / "state.json")
        return _run_project_instance_locked(
            instance,
            state,
            run_id=run_id,
            session_id=session_id,
            agent_id="main",
            spawn_caller=spawn_caller,
            functions=functions,
        )
